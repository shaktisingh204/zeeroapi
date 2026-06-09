use crate::jobs::run_job;
use crate::state::AppState;
use std::time::Duration;

/// Spawn the background scrapers. Two independent loops:
///   * prematch (slow cadence) — refreshes sports/leagues/matches/odds
///   * live (fast cadence) — refreshes scores + live odds
///
/// Each loop checks the `scrape_enabled` setting before every pass so it can
/// be toggled at runtime from the admin dashboard without a restart.
pub fn spawn(state: AppState) {
    if !state.config.scrape_enabled {
        tracing::warn!("scraper disabled via SCRAPE_ENABLED=false; not spawning loops");
        return;
    }

    // Prematch loop
    {
        let state = state.clone();
        let interval = Duration::from_secs(state.config.scrape_prematch_interval_secs);
        tokio::spawn(async move {
            // Small startup delay so the server is up first.
            tokio::time::sleep(Duration::from_secs(3)).await;
            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                if !enabled(&state).await {
                    continue;
                }
                let s = state.clone();
                let _ = run_job(&state, "prematch", || async move {
                    s.scraper.scrape_prematch(&s.pool).await
                })
                .await;
            }
        });
    }

    // Live loop
    {
        let state = state.clone();
        let interval = Duration::from_secs(state.config.scrape_live_interval_secs);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                if !enabled(&state).await {
                    continue;
                }
                let s = state.clone();
                let _ = run_job(&state, "live", || async move {
                    s.scraper.scrape_live(&s.pool).await
                })
                .await;
            }
        });
    }

    tracing::info!("background scrapers started");
}

/// Periodically fold new `request_events` into the `usage_rollup` table and
/// trim raw events older than the retention window. Runs every 5 minutes and
/// once shortly after boot. Independent of the scrape loops (which are off).
pub fn spawn_rollup(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(300));
        loop {
            ticker.tick().await;
            if let Err(e) = roll_up(&state).await {
                tracing::warn!(error = %e, "usage rollup failed");
            }
        }
    });
    tracing::info!("usage rollup loop started");
}

async fn roll_up(state: &AppState) -> anyhow::Result<()> {
    let last: i64 = sqlx::query_scalar("SELECT last_event_id FROM rollup_state WHERE id = 1")
        .fetch_optional(&state.pool)
        .await?
        .unwrap_or(0);

    let max_id: Option<i64> =
        sqlx::query_scalar("SELECT MAX(id) FROM request_events WHERE id > $1")
            .bind(last)
            .fetch_one(&state.pool)
            .await?;

    let Some(max_id) = max_id else {
        return Ok(()); // nothing new
    };

    sqlx::query(
        "INSERT INTO usage_rollup (customer_id, day, provider, endpoint, status_class, count, latency_sum)
         SELECT customer_id,
                created_at::date AS day,
                COALESCE(provider, '') AS provider,
                endpoint,
                (status_code / 100)::smallint AS status_class,
                COUNT(*)::bigint AS count,
                SUM(latency_ms)::bigint AS latency_sum
         FROM request_events
         WHERE id > $1 AND id <= $2
         GROUP BY customer_id, created_at::date, COALESCE(provider, ''), endpoint, (status_code / 100)
         ON CONFLICT (customer_id, day, provider, endpoint, status_class)
         DO UPDATE SET count       = usage_rollup.count + EXCLUDED.count,
                       latency_sum = usage_rollup.latency_sum + EXCLUDED.latency_sum",
    )
    .bind(last)
    .bind(max_id)
    .execute(&state.pool)
    .await?;

    sqlx::query("UPDATE rollup_state SET last_event_id = $1 WHERE id = 1")
        .bind(max_id)
        .execute(&state.pool)
        .await?;

    // Retention: drop raw events older than 30 days (rollups are permanent).
    let _ = sqlx::query("DELETE FROM request_events WHERE created_at < now() - interval '30 days'")
        .execute(&state.pool)
        .await;

    Ok(())
}

/// Auto-result settler. A live match that stops updating has left the live feed
/// — i.e. it ended — so after `result_stale_minutes` of no updates we mark it
/// finished and derive the winner (W1/Draw/W2) from its last-known score.
/// Provider-agnostic: keyed purely on `updated_at` staleness.
pub fn spawn_results(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        loop {
            ticker.tick().await;
            if let Err(e) = settle_results(&state).await {
                tracing::warn!(error = %e, "result settler failed");
            }
        }
    });
    tracing::info!("auto-result settler started");
}

async fn setting_i64(state: &AppState, key: &str, default: i64) -> i64 {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = $1")
        .bind(key)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

async fn settle_results(state: &AppState) -> anyhow::Result<()> {
    let on: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'result_enabled'")
        .fetch_optional(&state.pool)
        .await?;
    if on.as_deref() == Some("false") {
        return Ok(());
    }
    let stale = setting_i64(state, "result_stale_minutes", 20).await.max(1) as i32;

    let n = sqlx::query(
        "UPDATE matches
         SET status = 'finished',
             finished_at = now(),
             result = CASE
                 WHEN home_score IS NOT NULL AND away_score IS NOT NULL AND home_score > away_score THEN 'W1'
                 WHEN home_score IS NOT NULL AND away_score IS NOT NULL AND home_score < away_score THEN 'W2'
                 WHEN home_score IS NOT NULL AND away_score IS NOT NULL THEN 'Draw'
                 ELSE result
             END
         WHERE status = 'live'
           AND updated_at < now() - make_interval(mins => $1)",
    )
    .bind(stale)
    .execute(&state.pool)
    .await?
    .rows_affected();

    if n > 0 {
        tracing::info!(settled = n, "auto-result: matches finished");
    }
    Ok(())
}

async fn enabled(state: &AppState) -> bool {
    let val: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'scrape_enabled'")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    val.map(|v| v == "true").unwrap_or(true)
}

/// Usage-alert emails. Every 10 minutes, any customer who has crossed their
/// `alert_threshold` percentage of the monthly quota gets one email — at most
/// once per calendar month (tracked by `customers.alerted_period`).
pub fn spawn_usage_alerts(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(600));
        loop {
            ticker.tick().await;
            if let Err(e) = run_usage_alerts(&state).await {
                tracing::warn!(error = %e, "usage-alert job failed");
            }
        }
    });
    tracing::info!("usage-alert email loop started");
}

async fn run_usage_alerts(state: &AppState) -> anyhow::Result<()> {
    let period = chrono::Utc::now().format("%Y-%m").to_string();
    // Customers whose plan has a finite quota and who opted into alerts.
    let rows: Vec<(uuid::Uuid, String, Option<String>, i32, i64, i64)> = sqlx::query_as(
        "SELECT c.id, c.email, c.alerted_period,
                c.alert_threshold::int AS threshold,
                p.monthly_quota::bigint AS quota,
                COALESCE((SELECT SUM(count) FROM usage_rollup u
                          WHERE u.customer_id = c.id
                            AND u.day >= date_trunc('month', current_date)::date), 0)::bigint AS used
         FROM customers c JOIN plans p ON p.slug = c.plan_slug
         WHERE c.is_active AND p.monthly_quota > 0 AND COALESCE(c.alert_threshold, 0) > 0",
    )
    .fetch_all(&state.pool)
    .await?;

    for (id, email, alerted_period, threshold, quota, used) in rows {
        if quota <= 0 || threshold <= 0 {
            continue;
        }
        let pct = used * 100 / quota;
        if pct >= threshold as i64 && alerted_period.as_deref() != Some(period.as_str()) {
            crate::email::send_usage_alert(&state.config, &email, pct, used, quota).await;
            let _ = sqlx::query("UPDATE customers SET alerted_period = $1 WHERE id = $2")
                .bind(&period)
                .bind(id)
                .execute(&state.pool)
                .await;
            tracing::info!(%email, pct, "usage-alert email sent");
        }
    }
    Ok(())
}

/// Stripe subscription reconciliation. Every 30 minutes, re-sync each customer's
/// local `subscription_status` with Stripe (covers webhooks we may have missed).
/// No-op when Stripe is not configured.
pub fn spawn_billing_sync(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(45)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(1800));
        loop {
            ticker.tick().await;
            if let Err(e) = reconcile_billing(&state).await {
                tracing::warn!(error = %e, "billing reconciliation failed");
            }
        }
    });
    tracing::info!("billing reconciliation loop started");
}

async fn reconcile_billing(state: &AppState) -> anyhow::Result<()> {
    let secret = state.config.stripe_secret_key.clone();
    if secret.is_empty() {
        return Ok(()); // Stripe not configured — nothing to reconcile.
    }
    let rows: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT id, stripe_subscription_id FROM customers
         WHERE stripe_subscription_id IS NOT NULL",
    )
    .fetch_all(&state.pool)
    .await?;

    let client = reqwest::Client::new();
    for (id, sub_id) in rows {
        let Ok(res) = client
            .get(format!("https://api.stripe.com/v1/subscriptions/{sub_id}"))
            .basic_auth(&secret, Some(""))
            .send()
            .await
        else {
            continue;
        };
        let Ok(body) = res.json::<serde_json::Value>().await else {
            continue;
        };
        if let Some(status) = body.get("status").and_then(|v| v.as_str()) {
            // On a hard cancel fall back to free; otherwise just write the status.
            let _ = if status == "canceled" {
                sqlx::query(
                    "UPDATE customers SET subscription_status = 'canceled', plan_slug = 'free',
                     stripe_subscription_id = NULL, updated_at = now()
                     WHERE id = $1 AND subscription_status IS DISTINCT FROM 'canceled'",
                )
                .bind(id)
                .execute(&state.pool)
                .await
            } else {
                sqlx::query(
                    "UPDATE customers SET subscription_status = $1, updated_at = now()
                     WHERE id = $2 AND subscription_status IS DISTINCT FROM $1",
                )
                .bind(status)
                .bind(id)
                .execute(&state.pool)
                .await
            };
        }
    }
    Ok(())
}

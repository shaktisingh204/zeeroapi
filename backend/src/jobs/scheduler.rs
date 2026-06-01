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

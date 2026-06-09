use crate::api_keys::generate_key;
use crate::auth::{self, AuthUser};
use crate::error::{AppError, AppResult};
use crate::jobs::run_job;
use crate::models::{
    ApiKey, CreateCustomerRequest, CreateUserRequest, Customer, DashboardStats, Page, Plan,
    Provider, ScrapeLog, Setting, SportCount, UpdateSettingRequest, User,
};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, patch, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/stats", get(stats))
        .route("/logs", get(logs))
        .route("/scrape/:job", post(trigger_scrape))
        .route("/inspect/:game_id", get(inspect_game))
        .route("/pages", get(list_pages))
        .route("/settings", get(list_settings))
        .route("/settings/:key", put(update_setting))
        .route("/users", get(list_users).post(create_user))
        .route("/users/:id", delete(delete_user))
        // SaaS: providers, plans, customers, API keys
        .route("/providers", get(list_providers))
        .route("/providers/:slug/toggle", patch(toggle_provider))
        .route("/plans", get(list_plans).post(create_plan))
        .route("/plans/:slug", put(update_plan).delete(delete_plan))
        .route("/customers", get(list_customers).post(create_customer))
        .route("/customers/:id", delete(delete_customer))
        .route("/customers/:id/keys", get(list_keys).post(issue_key))
        .route("/customers/:id/usage", get(customer_usage))
        .route("/keys/:id", delete(revoke_key))
        // Analytics
        .route("/health", get(health))
        .route("/coverage", get(coverage))
        .route("/freshness", get(freshness))
        .route("/business", get(business))
        // Changelog + incidents (admin authoring)
        .route("/changelog", post(create_changelog))
        .route("/changelog/:id", delete(delete_changelog))
        .route("/incidents", get(list_incidents).post(create_incident))
        .route("/incidents/:id/resolve", patch(resolve_incident))
}

// ---------------- Dashboard stats ----------------

#[derive(Debug, Deserialize)]
pub struct StatsQuery {
    pub provider: Option<String>,
}

async fn stats(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(q): Query<StatsQuery>,
) -> AppResult<Json<DashboardStats>> {
    let pool = &state.pool;
    let p = q.provider; // None = all providers

    let total_sports: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sports WHERE ($1::text IS NULL OR provider = $1)")
            .bind(&p).fetch_one(pool).await?;
    let total_leagues: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM leagues WHERE ($1::text IS NULL OR provider = $1)")
            .bind(&p).fetch_one(pool).await?;
    let total_matches: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM matches WHERE ($1::text IS NULL OR provider = $1)")
            .bind(&p).fetch_one(pool).await?;
    let live_matches: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM matches WHERE status = 'live' AND ($1::text IS NULL OR provider = $1)")
        .bind(&p).fetch_one(pool).await?;
    let prematch_matches: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM matches WHERE status = 'prematch' AND ($1::text IS NULL OR provider = $1)")
        .bind(&p).fetch_one(pool).await?;
    let total_odds: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM odds WHERE ($1::text IS NULL OR provider = $1)")
            .bind(&p).fetch_one(pool).await?;
    let scrapes_last_24h: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM scrape_logs WHERE started_at > now() - interval '24 hours'",
    )
    .fetch_one(pool)
    .await?;

    let last_scrape: Option<ScrapeLog> =
        sqlx::query_as("SELECT * FROM scrape_logs ORDER BY started_at DESC LIMIT 1")
            .fetch_optional(pool)
            .await?;

    let matches_by_sport: Vec<SportCount> = sqlx::query_as(
        "SELECT s.name AS sport_name, COUNT(m.id) AS count
         FROM sports s
         JOIN matches m ON m.sport_id = s.id
         WHERE ($1::text IS NULL OR m.provider = $1)
         GROUP BY s.name
         ORDER BY count DESC
         LIMIT 10",
    )
    .bind(&p)
    .fetch_all(pool)
    .await?;

    Ok(Json(DashboardStats {
        total_sports,
        total_leagues,
        total_matches,
        live_matches,
        prematch_matches,
        total_odds,
        last_scrape,
        matches_by_sport,
        scrapes_last_24h,
    }))
}

// ---------------- Scrape logs ----------------

#[derive(Debug, Deserialize)]
pub struct LogQuery {
    pub limit: Option<i64>,
}

async fn logs(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(q): Query<LogQuery>,
) -> AppResult<Json<Vec<ScrapeLog>>> {
    let limit = q.limit.unwrap_or(100).clamp(1, 1000);
    let logs: Vec<ScrapeLog> =
        sqlx::query_as("SELECT * FROM scrape_logs ORDER BY started_at DESC LIMIT $1")
            .bind(limit)
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(logs))
}

// ---------------- Manual scrape trigger ----------------

async fn trigger_scrape(
    State(state): State<AppState>,
    user: AuthUser,
    Path(job): Path<String>,
) -> AppResult<Json<Value>> {
    user.require_editor()?;

    let outcome = match job.as_str() {
        "sports" => {
            let s = state.clone();
            run_job(&state, "sports", || async move { s.scraper.scrape_sports(&s.pool).await }).await
        }
        "prematch" => {
            let s = state.clone();
            run_job(&state, "prematch", || async move { s.scraper.scrape_prematch(&s.pool).await }).await
        }
        "live" => {
            let s = state.clone();
            run_job(&state, "live", || async move { s.scraper.scrape_live(&s.pool).await }).await
        }
        "full" => {
            // Walk the top matches and pull their COMPLETE market tree.
            let s = state.clone();
            run_job(&state, "full", || async move {
                s.scraper.scrape_full_markets(&s.pool, 50).await
            })
            .await
        }
        "pages" => {
            // Crawl the sitemap tree, parse pages, resolve odds per page.
            let s = state.clone();
            run_job(&state, "pages", || async move {
                s.scraper.scrape_pages(&s.pool, 40).await
            })
            .await
        }
        _ => {
            return Err(AppError::BadRequest(
                "unknown job (use sports|prematch|live|full|pages)".into(),
            ))
        }
    }
    .map_err(AppError::Other)?;

    Ok(Json(json!({
        "job": job,
        "matches": outcome.matches,
        "odds": outcome.odds,
    })))
}

// ---------------- Debug: inspect raw full-game payload ----------------

async fn inspect_game(
    State(state): State<AppState>,
    _user: AuthUser,
    Path(game_id): Path<i64>,
) -> AppResult<Json<Value>> {
    let raw = state
        .scraper
        .fetch_game_raw(game_id)
        .await
        .map_err(AppError::Other)?;
    Ok(Json(raw))
}

// ---------------- Discovered pages ----------------

async fn list_pages(State(state): State<AppState>, _user: AuthUser) -> AppResult<Json<Vec<Page>>> {
    let pages: Vec<Page> = sqlx::query_as(
        "SELECT * FROM pages ORDER BY (status = 'resolved') DESC, odds_found DESC, url ASC LIMIT 500",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(pages))
}

// ---------------- Settings ----------------

async fn list_settings(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<Vec<Setting>>> {
    let settings: Vec<Setting> =
        sqlx::query_as("SELECT * FROM settings ORDER BY key").fetch_all(&state.pool).await?;
    Ok(Json(settings))
}

async fn update_setting(
    State(state): State<AppState>,
    user: AuthUser,
    Path(key): Path<String>,
    Json(req): Json<UpdateSettingRequest>,
) -> AppResult<Json<Setting>> {
    user.require_admin()?;
    let setting: Setting = sqlx::query_as(
        "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         RETURNING *",
    )
    .bind(&key)
    .bind(&req.value)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(setting))
}

// ---------------- Users ----------------

async fn list_users(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<User>>> {
    user.require_admin()?;
    let users: Vec<User> =
        sqlx::query_as("SELECT * FROM users ORDER BY created_at ASC").fetch_all(&state.pool).await?;
    Ok(Json(users))
}

async fn create_user(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<CreateUserRequest>,
) -> AppResult<Json<User>> {
    user.require_admin()?;

    if req.password.len() < 8 {
        return Err(AppError::BadRequest("password must be at least 8 characters".into()));
    }
    if !["admin", "editor", "viewer"].contains(&req.role.as_str()) {
        return Err(AppError::BadRequest("role must be admin|editor|viewer".into()));
    }

    let hash = auth::hash_password(&req.password).map_err(AppError::Other)?;
    let created: User = sqlx::query_as(
        "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(&req.email)
    .bind(&hash)
    .bind(&req.role)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(created))
}

async fn delete_user(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    if user.id == id {
        return Err(AppError::BadRequest("you cannot delete your own account".into()));
    }
    let res = sqlx::query("DELETE FROM users WHERE id = $1").bind(id).execute(&state.pool).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "deleted": id })))
}

// ---------------- Providers ----------------

async fn list_providers(State(state): State<AppState>, _u: AuthUser) -> AppResult<Json<Vec<Provider>>> {
    let rows: Vec<Provider> = sqlx::query_as("SELECT * FROM providers ORDER BY name")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

async fn toggle_provider(
    State(state): State<AppState>,
    user: AuthUser,
    Path(slug): Path<String>,
) -> AppResult<Json<Provider>> {
    user.require_admin()?;
    let p: Provider = sqlx::query_as(
        "UPDATE providers SET is_active = NOT is_active WHERE slug = $1 RETURNING *",
    )
    .bind(&slug)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(p))
}

// ---------------- Plans ----------------

async fn list_plans(State(state): State<AppState>, _u: AuthUser) -> AppResult<Json<Vec<Plan>>> {
    let rows: Vec<Plan> = sqlx::query_as("SELECT * FROM plans ORDER BY sort_order")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

/// Editable fields of a plan. `monthly_quota = -1` means unlimited; `features` is
/// a flat list of marketing bullet strings.
#[derive(Debug, Deserialize)]
pub struct PlanFields {
    pub name: String,
    #[serde(default)]
    pub price_cents: i32,
    #[serde(default)]
    pub rate_limit_per_min: i32,
    #[serde(default)]
    pub monthly_quota: i32,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub sort_order: i32,
    pub stripe_price_id: Option<String>,
    pub metered_price_id: Option<String>,
}

/// Create form = a slug (immutable identity) plus all the editable fields.
#[derive(Debug, Deserialize)]
pub struct CreatePlanRequest {
    pub slug: String,
    #[serde(flatten)]
    pub fields: PlanFields,
}

async fn create_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<CreatePlanRequest>,
) -> AppResult<Json<Plan>> {
    user.require_admin()?;
    let slug = req.slug.trim().to_lowercase();
    if slug.is_empty() {
        return Err(AppError::BadRequest("slug is required".into()));
    }
    let f = req.fields;
    if f.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    let p: Plan = sqlx::query_as(
        "INSERT INTO plans \
            (slug, name, price_cents, rate_limit_per_min, monthly_quota, features, sort_order, stripe_price_id, metered_price_id) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
    )
    .bind(&slug)
    .bind(f.name.trim())
    .bind(f.price_cents)
    .bind(f.rate_limit_per_min)
    .bind(f.monthly_quota)
    .bind(json!(f.features))
    .bind(f.sort_order)
    .bind(&f.stripe_price_id)
    .bind(&f.metered_price_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        // slug PK collision → a friendly 400 instead of a 500.
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::BadRequest(format!("a plan with slug '{slug}' already exists"))
        }
        other => other.into(),
    })?;
    Ok(Json(p))
}

/// Update every editable field of a plan. The slug (its identity, referenced by
/// customers) is intentionally immutable — change it by creating a new plan.
async fn update_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(slug): Path<String>,
    Json(f): Json<PlanFields>,
) -> AppResult<Json<Plan>> {
    user.require_admin()?;
    if f.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    let updated: Option<Plan> = sqlx::query_as(
        "UPDATE plans SET \
            name = $2, price_cents = $3, rate_limit_per_min = $4, monthly_quota = $5, \
            features = $6, sort_order = $7, stripe_price_id = $8, metered_price_id = $9 \
         WHERE slug = $1 RETURNING *",
    )
    .bind(&slug)
    .bind(f.name.trim())
    .bind(f.price_cents)
    .bind(f.rate_limit_per_min)
    .bind(f.monthly_quota)
    .bind(json!(f.features))
    .bind(f.sort_order)
    .bind(&f.stripe_price_id)
    .bind(&f.metered_price_id)
    .fetch_optional(&state.pool)
    .await?;
    updated.map(Json).ok_or(AppError::NotFound)
}

async fn delete_plan(
    State(state): State<AppState>,
    user: AuthUser,
    Path(slug): Path<String>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    // Refuse to delete a plan that customers are still subscribed to — the
    // customers.plan_slug FK would block it anyway; this gives a clear message.
    let in_use: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customers WHERE plan_slug = $1")
        .bind(&slug)
        .fetch_one(&state.pool)
        .await?;
    if in_use > 0 {
        return Err(AppError::BadRequest(format!(
            "{in_use} customer(s) are on '{slug}' — move them to another plan first"
        )));
    }
    let res = sqlx::query("DELETE FROM plans WHERE slug = $1")
        .bind(&slug)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "deleted": slug })))
}

// ---------------- Customers ----------------

async fn list_customers(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Customer>>> {
    user.require_admin()?;
    let rows: Vec<Customer> =
        sqlx::query_as("SELECT * FROM customers ORDER BY created_at DESC")
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(rows))
}

async fn create_customer(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<CreateCustomerRequest>,
) -> AppResult<Json<Customer>> {
    user.require_admin()?;
    let c: Customer = sqlx::query_as(
        "INSERT INTO customers (email, name, plan_slug) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(&req.email)
    .bind(&req.name)
    .bind(&req.plan_slug)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(c))
}

async fn delete_customer(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let res = sqlx::query("DELETE FROM customers WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "deleted": id })))
}

// ---------------- API keys ----------------

#[derive(Debug, Deserialize)]
pub struct IssueKeyRequest {
    pub name: Option<String>,
}

async fn list_keys(
    State(state): State<AppState>,
    user: AuthUser,
    Path(customer_id): Path<Uuid>,
) -> AppResult<Json<Vec<ApiKey>>> {
    user.require_admin()?;
    let rows: Vec<ApiKey> = sqlx::query_as(
        "SELECT * FROM api_keys WHERE customer_id = $1 ORDER BY created_at DESC",
    )
    .bind(customer_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

/// Issue a new key. The FULL key is returned exactly once here; only its hash
/// is stored, so it can never be shown again.
async fn issue_key(
    State(state): State<AppState>,
    user: AuthUser,
    Path(customer_id): Path<Uuid>,
    Json(req): Json<IssueKeyRequest>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let (full, prefix, hash) = generate_key();
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO api_keys (customer_id, name, key_prefix, key_hash)
         VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(customer_id)
    .bind(&req.name)
    .bind(&prefix)
    .bind(&hash)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(json!({
        "id": id, "key": full, "key_prefix": prefix,
        "note": "Store this key now — it will not be shown again."
    })))
}

async fn revoke_key(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let res = sqlx::query("UPDATE api_keys SET revoked = true WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "revoked": id })))
}

// ---------------- Analytics: scraper health ----------------

async fn health(
    State(state): State<AppState>,
    _u: AuthUser,
    Query(q): Query<StatsQuery>,
) -> AppResult<Json<Value>> {
    let pool = &state.pool;
    // scrape_logs has no provider column; the `job` is provider-prefixed for the
    // standalone scrapers (d247-*, 1win-*, bcgame-*, …), so scope best-effort by a
    // job-name prefix. None = all jobs.
    let p = q.provider;

    let (total, ok, err): (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::bigint,
                COUNT(*) FILTER (WHERE status = 'success')::bigint,
                COUNT(*) FILTER (WHERE status = 'error')::bigint
         FROM scrape_logs WHERE started_at > now() - interval '24 hours'
           AND ($1::text IS NULL OR job ILIKE $1 || '%')",
    )
    .bind(&p)
    .fetch_one(pool)
    .await?;

    let success_rate = if total > 0 { (ok as f64 / total as f64) * 100.0 } else { 100.0 };

    let timeline: Vec<(chrono::DateTime<chrono::Utc>, i64, i64, i64)> = sqlx::query_as(
        "SELECT date_trunc('hour', started_at) AS hour,
                COUNT(*) FILTER (WHERE status = 'success')::bigint,
                COUNT(*) FILTER (WHERE status = 'error')::bigint,
                COALESCE(AVG(duration_ms), 0)::bigint
         FROM scrape_logs WHERE started_at > now() - interval '24 hours'
           AND ($1::text IS NULL OR job ILIKE $1 || '%')
         GROUP BY 1 ORDER BY 1",
    )
    .bind(&p)
    .fetch_all(pool)
    .await?;

    let recent: Vec<ScrapeLog> = sqlx::query_as(
        "SELECT * FROM scrape_logs WHERE ($1::text IS NULL OR job ILIKE $1 || '%')
         ORDER BY started_at DESC LIMIT 20",
    )
    .bind(&p)
    .fetch_all(pool)
    .await?;

    let last_run: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT MAX(started_at) FROM scrape_logs WHERE ($1::text IS NULL OR job ILIKE $1 || '%')",
    )
    .bind(&p)
    .fetch_one(pool)
    .await?;

    let page_sync: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'page_sync_enabled'")
            .fetch_optional(pool)
            .await?
            .flatten();

    let timeline_json: Vec<Value> = timeline
        .into_iter()
        .map(|(h, s, e, d)| json!({ "hour": h, "success": s, "error": e, "avg_ms": d }))
        .collect();

    Ok(Json(json!({
        "runs_24h": total,
        "success_24h": ok,
        "error_24h": err,
        "success_rate": success_rate,
        "last_run": last_run,
        "page_sync_enabled": page_sync.as_deref() == Some("true"),
        "timeline": timeline_json,
        "recent": recent,
    })))
}

// ---------------- Analytics: provider coverage ----------------

async fn coverage(State(state): State<AppState>, _u: AuthUser) -> AppResult<Json<Value>> {
    let pool = &state.pool;
    use std::collections::HashMap;

    async fn counts(pool: &sqlx::PgPool, sql: &str) -> Result<HashMap<String, i64>, sqlx::Error> {
        let rows: Vec<(String, i64)> = sqlx::query_as(sql).fetch_all(pool).await?;
        Ok(rows.into_iter().collect())
    }

    let matches = counts(pool, "SELECT provider, COUNT(*)::bigint FROM matches GROUP BY provider").await?;
    let live = counts(pool, "SELECT provider, COUNT(*)::bigint FROM matches WHERE status='live' GROUP BY provider").await?;
    let odds = counts(pool, "SELECT provider, COUNT(*)::bigint FROM odds GROUP BY provider").await?;
    let sports = counts(pool, "SELECT provider, COUNT(DISTINCT id)::bigint FROM sports GROUP BY provider").await?;

    let providers: Vec<Provider> =
        sqlx::query_as("SELECT * FROM providers ORDER BY name").fetch_all(pool).await?;

    let rows: Vec<Value> = providers
        .into_iter()
        .map(|p| {
            json!({
                "slug": p.slug,
                "name": p.name,
                "is_active": p.is_active,
                "capabilities": p.capabilities,
                "matches": matches.get(&p.slug).copied().unwrap_or(0),
                "live": live.get(&p.slug).copied().unwrap_or(0),
                "odds": odds.get(&p.slug).copied().unwrap_or(0),
                "sports": sports.get(&p.slug).copied().unwrap_or(0),
            })
        })
        .collect();

    Ok(Json(json!({ "coverage": rows })))
}

// ---------------- Analytics: data freshness ----------------

async fn freshness(
    State(state): State<AppState>,
    _u: AuthUser,
    Query(q): Query<StatsQuery>,
) -> AppResult<Json<Value>> {
    let pool = &state.pool;
    let p = q.provider; // None = all providers

    // Age in seconds of the oldest / average live row (cast to float8 so sqlx
    // decodes it as f64 — EXTRACT returns numeric on PG14+).
    let (live_max, live_avg): (Option<f64>, Option<f64>) = sqlx::query_as(
        "SELECT MAX(EXTRACT(EPOCH FROM now() - updated_at))::float8,
                AVG(EXTRACT(EPOCH FROM now() - updated_at))::float8
         FROM matches WHERE status = 'live' AND ($1::text IS NULL OR provider = $1)",
    )
    .bind(&p)
    .fetch_one(pool)
    .await?;

    let odds_age: Option<f64> = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM now() - MAX(updated_at))::float8 FROM odds
         WHERE ($1::text IS NULL OR provider = $1)",
    )
    .bind(&p)
    .fetch_one(pool)
    .await?;

    let matches_age: Option<f64> = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM now() - MAX(updated_at))::float8 FROM matches
         WHERE ($1::text IS NULL OR provider = $1)",
    )
    .bind(&p)
    .fetch_one(pool)
    .await?;

    let last_ingest: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT MAX(started_at) FROM scrape_logs
         WHERE ($1::text IS NULL AND job IN ('pages', 'page-sync'))
            OR ($1::text IS NOT NULL AND job ILIKE $1 || '%')",
    )
    .bind(&p)
    .fetch_one(pool)
    .await?;

    Ok(Json(json!({
        "live_oldest_secs": live_max.map(|v| v as i64),
        "live_avg_secs": live_avg.map(|v| v as i64),
        "odds_last_update_secs": odds_age.map(|v| v as i64),
        "matches_last_update_secs": matches_age.map(|v| v as i64),
        "last_ingest": last_ingest,
    })))
}

// ---------------- Analytics: business ----------------

async fn business(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let pool = &state.pool;

    let total_customers: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM customers WHERE is_active")
            .fetch_one(pool)
            .await?;

    // MRR in cents = sum of plan price across active customers.
    let mrr_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(p.price_cents), 0)::bigint
         FROM customers c JOIN plans p ON p.slug = c.plan_slug WHERE c.is_active",
    )
    .fetch_one(pool)
    .await?;

    let by_plan: Vec<(String, i64)> = sqlx::query_as(
        "SELECT plan_slug, COUNT(*)::bigint FROM customers WHERE is_active GROUP BY plan_slug",
    )
    .fetch_all(pool)
    .await?;

    let signups: Vec<(chrono::NaiveDate, i64)> = sqlx::query_as(
        "SELECT created_at::date, COUNT(*)::bigint FROM customers
         WHERE created_at >= current_date - 30 GROUP BY 1 ORDER BY 1",
    )
    .fetch_all(pool)
    .await?;

    let top_customers: Vec<(String, i64)> = sqlx::query_as(
        "SELECT c.email, SUM(r.count)::bigint AS requests
         FROM usage_rollup r JOIN customers c ON c.id = r.customer_id
         WHERE r.day >= current_date - 30
         GROUP BY c.email ORDER BY requests DESC LIMIT 10",
    )
    .fetch_all(pool)
    .await?;

    Ok(Json(json!({
        "total_customers": total_customers,
        "mrr_cents": mrr_cents,
        "by_plan": by_plan.into_iter().map(|(p, c)| json!({ "plan": p, "count": c })).collect::<Vec<_>>(),
        "signups": signups.into_iter().map(|(d, c)| json!({ "day": d, "count": c })).collect::<Vec<_>>(),
        "top_customers": top_customers.into_iter().map(|(e, r)| json!({ "email": e, "requests": r })).collect::<Vec<_>>(),
    })))
}

// ---------------- Changelog + incidents ----------------

#[derive(Debug, Deserialize)]
pub struct CreateChangelogRequest {
    pub version: Option<String>,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default = "default_tag")]
    pub tag: String,
}
fn default_tag() -> String {
    "improvement".into()
}

async fn create_changelog(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<CreateChangelogRequest>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO changelog (version, title, body, tag) VALUES ($1,$2,$3,$4) RETURNING id",
    )
    .bind(&req.version)
    .bind(&req.title)
    .bind(&req.body)
    .bind(&req.tag)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(json!({ "id": id })))
}

async fn delete_changelog(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let res = sqlx::query("DELETE FROM changelog WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "deleted": id })))
}

#[derive(Debug, Deserialize)]
pub struct CreateIncidentRequest {
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default = "default_severity")]
    pub severity: String,
    #[serde(default = "default_inc_status")]
    pub status: String,
}
fn default_severity() -> String {
    "minor".into()
}
fn default_inc_status() -> String {
    "investigating".into()
}

async fn list_incidents(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let rows: Vec<(i64, String, String, String, String, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>)> =
        sqlx::query_as(
            "SELECT id, title, severity, status, body, started_at, resolved_at FROM incidents ORDER BY started_at DESC LIMIT 100",
        )
        .fetch_all(&state.pool)
        .await?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|(id, title, sev, st, body, started, resolved)| {
            json!({ "id": id, "title": title, "severity": sev, "status": st, "body": body, "started_at": started, "resolved_at": resolved })
        })
        .collect();
    Ok(Json(json!({ "incidents": items })))
}

async fn create_incident(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<CreateIncidentRequest>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO incidents (title, body, severity, status) VALUES ($1,$2,$3,$4) RETURNING id",
    )
    .bind(&req.title)
    .bind(&req.body)
    .bind(&req.severity)
    .bind(&req.status)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(json!({ "id": id })))
}

async fn resolve_incident(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let res = sqlx::query(
        "UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE id = $1",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "resolved": id })))
}

/// Current month's request usage for a customer (read from Redis counters).
async fn customer_usage(
    State(state): State<AppState>,
    user: AuthUser,
    Path(customer_id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let plan: Option<(String, i32)> = sqlx::query_as(
        "SELECT p.name, p.monthly_quota FROM customers c JOIN plans p ON p.slug = c.plan_slug WHERE c.id = $1",
    )
    .bind(customer_id)
    .fetch_optional(&state.pool)
    .await?;

    let used = if let Some(cache) = &state.cache {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let month = now / 2_592_000;
        cache.get_i64(&format!("quota:{customer_id}:{month}")).await
    } else {
        0
    };

    let (plan_name, quota) = plan.unwrap_or(("unknown".into(), 0));
    Ok(Json(json!({
        "customer_id": customer_id, "plan": plan_name,
        "used_this_month": used, "monthly_quota": quota
    })))
}

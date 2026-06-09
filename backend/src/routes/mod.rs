pub mod admin;
pub mod auth;
pub mod billing;
pub mod images;
pub mod ingest;
pub mod leagues;
pub mod live;
pub mod matches;
pub mod odds;
pub mod portal;
pub mod sports;
pub mod status;
pub mod v1;

use crate::analytics::record_usage;
use crate::state::AppState;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;

/// Assemble the full `/api` router. Takes `state` so the usage-recording
/// middleware (which needs the DB pool) can be layered onto `/v1` only.
pub fn api_router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/providers", get(public_providers))
        .route("/landing", get(landing_stats))
        .nest("/auth", auth::router())
        .nest("/sports", sports::router())
        .nest("/leagues", leagues::router())
        .nest("/images", images::router())
        .nest("/matches", matches::router())
        .nest("/live", live::router())
        .nest("/odds", odds::router())
        .nest("/admin", admin::router())
        .nest("/ingest", ingest::router())
        .nest(
            "/v1",
            v1::router().route_layer(axum::middleware::from_fn_with_state(
                state,
                record_usage,
            )),
        )
        .nest("/portal", portal::router().nest("/billing", billing::router()))
        .nest("/stripe", billing::webhook_router())
        .nest("/status", status::router())
        .nest("/changelog", status::changelog_router())
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "service": "melbet-saas-backend" }))
}

/// Public list of active providers (slug + name) — no auth. Lets the frontend
/// drive provider pickers from one source instead of hardcoded arrays.
async fn public_providers(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    let rows: Vec<(String, String, serde_json::Value)> = sqlx::query_as(
        "SELECT slug, name, capabilities FROM providers WHERE is_active ORDER BY name",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let list: Vec<_> = rows
        .into_iter()
        .map(|(slug, name, capabilities)| json!({ "slug": slug, "name": name, "capabilities": capabilities }))
        .collect();
    Json(json!(list))
}

/// Public aggregate stats for the marketing landing page (no auth). Powers the
/// dynamic counters + sports grid so they reflect real data instead of hardcoded
/// arrays. Every query falls back to a sane default, so this never 500s.
async fn landing_stats(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    let pool = &state.pool;

    let providers: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM providers WHERE is_active")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let sports: i64 = sqlx::query_scalar("SELECT COUNT(DISTINCT name) FROM sports")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let live_matches: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM matches WHERE status = 'live'")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let markets: i64 = sqlx::query_scalar("SELECT COUNT(DISTINCT market) FROM odds")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // Top sports across every provider, collapsed by name so the grid shows each
    // sport once with its summed match count.
    let top: Vec<(String, i64)> = sqlx::query_as(
        "SELECT name, COALESCE(SUM(match_count), 0)::bigint AS m FROM sports
         GROUP BY name ORDER BY m DESC, name ASC LIMIT 16",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let top_sports: Vec<_> = top
        .into_iter()
        .map(|(name, m)| json!({ "name": name, "matches": m }))
        .collect();

    Json(json!({
        "providers": providers,
        "sports": sports,
        "live_matches": live_matches,
        "markets": markets,
        "top_sports": top_sports,
    }))
}

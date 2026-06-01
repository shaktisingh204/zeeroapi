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
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT slug, name FROM providers WHERE is_active ORDER BY name")
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();
    let list: Vec<_> = rows
        .into_iter()
        .map(|(slug, name)| json!({ "slug": slug, "name": name }))
        .collect();
    Json(json!(list))
}

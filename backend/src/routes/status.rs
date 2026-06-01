//! Public status page + changelog (no auth). Component health is computed live
//! from the DB, Redis, scraper logs and data freshness.

use crate::error::AppResult;
use crate::state::AppState;
use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(status))
}

pub fn changelog_router() -> Router<AppState> {
    Router::new().route("/", get(changelog))
}

fn component(name: &str, state: &str, detail: &str) -> Value {
    json!({ "name": name, "status": state, "detail": detail })
}

async fn status(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let pool = &state.pool;
    let mut components = Vec::new();

    // API is up if we're responding.
    components.push(component("API", "operational", "Serving requests"));

    // Database.
    let db_ok = sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(pool).await.is_ok();
    components.push(component(
        "Database",
        if db_ok { "operational" } else { "down" },
        if db_ok { "Connected" } else { "Unreachable" },
    ));

    // Redis cache.
    let redis_state = match &state.cache {
        Some(c) if c.ping().await => "operational",
        Some(_) => "down",
        None => "degraded",
    };
    components.push(component(
        "Cache (Redis)",
        redis_state,
        if redis_state == "degraded" { "Not configured — running without cache" } else { "Connected" },
    ));

    // Scraper: enabled + a recent run.
    let last_run_secs: Option<f64> = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM now() - MAX(started_at))::float8 FROM scrape_logs",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(None);
    let scraper_state = match last_run_secs {
        Some(s) if s < 300.0 => "operational",
        Some(_) => "degraded",
        None => "degraded",
    };
    let scraper_detail = match last_run_secs {
        Some(s) => format!("Last sync {}s ago", s as i64),
        None => "No syncs recorded yet".to_string(),
    };
    components.push(component("Data pipeline", scraper_state, &scraper_detail));

    // Live data freshness.
    let live_age: Option<f64> = sqlx::query_scalar(
        "SELECT MAX(EXTRACT(EPOCH FROM now() - updated_at))::float8 FROM matches WHERE status='live'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(None);
    let fresh_state = match live_age {
        Some(s) if s < 120.0 => "operational",
        Some(_) => "degraded",
        None => "operational",
    };
    components.push(component(
        "Live odds freshness",
        fresh_state,
        &live_age.map(|s| format!("Oldest live row {}s", s as i64)).unwrap_or_else(|| "No live matches".into()),
    ));

    // Overall = worst component.
    let overall = if components.iter().any(|c| c["status"] == "down") {
        "down"
    } else if components.iter().any(|c| c["status"] == "degraded") {
        "degraded"
    } else {
        "operational"
    };

    // Open incidents.
    let incidents: Vec<Value> = sqlx::query_as::<_, (i64, String, String, String, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT id, title, severity, status, body, started_at FROM incidents
         WHERE resolved_at IS NULL ORDER BY started_at DESC LIMIT 20",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|(id, title, severity, st, body, started)| {
        json!({ "id": id, "title": title, "severity": severity, "status": st, "body": body, "started_at": started })
    })
    .collect();

    Ok(Json(json!({
        "overall": overall,
        "components": components,
        "incidents": incidents,
    })))
}

async fn changelog(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let rows: Vec<Value> = sqlx::query_as::<_, (i64, Option<String>, String, String, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT id, version, title, body, tag, published_at FROM changelog
         ORDER BY published_at DESC LIMIT 100",
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(|(id, version, title, body, tag, published)| {
        json!({ "id": id, "version": version, "title": title, "body": body, "tag": tag, "published_at": published })
    })
    .collect();
    Ok(Json(json!({ "entries": rows })))
}

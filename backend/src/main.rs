mod analytics;
mod api_keys;
mod auth;
mod cache;
mod config;
mod db;
mod error;
mod jobs;
mod models;
mod page_sync;
mod routes;
mod scraper;
mod state;

use axum::http::{HeaderValue, Method};
use axum::response::Redirect;
use axum::routing::get;
use axum::Json;
use config::Config;
use serde_json::json;
use state::AppState;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ---- Logging ----
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // ---- Config + DB ----
    let config = Config::from_env()?;
    tracing::info!(target = %config.melbet_base_url, "starting melbet-saas backend");

    let pool = db::init_pool(&config).await?;
    db::bootstrap_admin(&pool, &config).await?;

    let bind_addr = config.bind_addr.clone();
    let cors_origins = config.cors_origins.clone();

    // ---- Redis (best-effort) ----
    let cache = match cache::Cache::connect(&config.redis_url).await {
        Ok(c) => {
            tracing::info!("connected to redis at {}", config.redis_url);
            Some(c)
        }
        Err(e) => {
            tracing::warn!(error = %e, "redis unavailable — running without cache");
            None
        }
    };

    let state = AppState::new(pool, config, cache)?;

    // Data is ingested exclusively by the Python page scraper (scraper-py/),
    // supervised here as a managed process: auto-starts on boot and is toggled
    // at runtime via the `page_sync_enabled` setting. The legacy JSON-feed
    // scheduler is intentionally NOT started (it produced coded markets).
    page_sync::spawn_supervisor(state.clone());

    // Fold request_events -> usage_rollup periodically (powers analytics + billing).
    jobs::scheduler::spawn_rollup(state.clone());

    // Auto-result settler: finish ended matches + derive winners from final scores.
    jobs::scheduler::spawn_results(state.clone());

    // ---- CORS ----
    let mut cors = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers(tower_http::cors::Any);
    if cors_origins.is_empty() {
        cors = cors.allow_origin(tower_http::cors::Any);
    } else {
        let origins: Vec<HeaderValue> = cors_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        cors = cors.allow_origin(origins);
    }

    // ---- Router ----
    let app = axum::Router::new()
        // Friendly root: this port is the API, not the website.
        .route(
            "/",
            get(|| async {
                Json(json!({
                    "service": "ZeroApi backend",
                    "message": "This is the API server. The dashboard/landing site runs separately.",
                    "website": "http://localhost:3000",
                    "health": "/api/health",
                    "api_docs": "/api/v1/docs",
                    "openapi": "/api/v1/openapi.json"
                }))
            }),
        )
        .route("/docs", get(|| async { Redirect::temporary("/api/v1/docs") }))
        .nest("/api", routes::api_router(state.clone()))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("listening on http://{bind_addr}");
    axum::serve(listener, app).await?;

    Ok(())
}

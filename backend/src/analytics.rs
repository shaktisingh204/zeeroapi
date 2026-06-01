//! Request analytics: a usage-recording middleware that writes one durable
//! `request_events` row per public-API call (off the response path), helpers to
//! normalize the `/api/v1` path into (provider, endpoint), and query helpers
//! that power the portal + admin analytics dashboards from `usage_rollup`.

use crate::api_keys::sha256_hex;
use crate::state::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, Request};
use axum::middleware::Next;
use axum::response::Response;
use chrono::NaiveDate;
use serde::Serialize;
use std::time::Instant;
use uuid::Uuid;

/// Pull the API key from `X-API-Key` header or `?api_key=` query param.
fn extract_api_key<B>(req: &Request<B>) -> Option<String> {
    if let Some(v) = req.headers().get("x-api-key").and_then(|v| v.to_str().ok()) {
        return Some(v.to_string());
    }
    req.uri().query().and_then(|q| {
        q.split('&')
            .find_map(|kv| kv.strip_prefix("api_key=").map(|v| v.to_string()))
    })
}

/// Best-effort client IP from common proxy headers (no proxy in local dev).
pub fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim().to_string())
        })
}

/// Normalize a request path into (provider, endpoint).
/// `/api/v1/melbet/matches/123` -> (Some("melbet"), "matches/:id").
/// `/api/v1/providers`          -> (None, "providers").
pub fn parse_v1_path(path: &str) -> (Option<String>, String) {
    let rest = path
        .trim_start_matches("/api/v1")
        .trim_start_matches('/');
    let segs: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return (None, String::new());
    }
    if matches!(segs[0], "providers" | "openapi.json" | "docs") {
        return (None, segs[0].to_string());
    }
    let provider = segs[0].to_string();
    let endpoint = segs[1..]
        .iter()
        .map(|s| {
            if !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) {
                ":id"
            } else {
                s
            }
        })
        .collect::<Vec<_>>()
        .join("/");
    (Some(provider), endpoint)
}

/// Axum middleware: times the request and, for authenticated public-API calls,
/// records a durable `request_events` row in the background (never blocks the
/// response). Layered onto the `/api/v1` router only.
pub async fn record_usage(State(state): State<AppState>, req: Request<axum::body::Body>, next: Next) -> Response {
    let start = Instant::now();
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();
    let key = extract_api_key(&req);

    let res = next.run(req).await;

    let status = res.status().as_u16() as i32;
    let latency = start.elapsed().as_millis() as i32;

    if let Some(key) = key {
        let pool = state.pool.clone();
        let hash = sha256_hex(&key);
        let (provider, endpoint) = parse_v1_path(&path);
        tokio::spawn(async move {
            // Resolve the key (even revoked/expired ones still produced a 4xx we want to log).
            if let Ok(Some(row)) =
                sqlx::query_as::<_, (Uuid, Uuid)>("SELECT customer_id, id FROM api_keys WHERE key_hash = $1")
                    .bind(&hash)
                    .fetch_optional(&pool)
                    .await
            {
                let _ = sqlx::query(
                    "INSERT INTO request_events
                       (customer_id, api_key_id, provider, endpoint, method, status_code, latency_ms)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)",
                )
                .bind(row.0)
                .bind(row.1)
                .bind(provider)
                .bind(endpoint)
                .bind(method)
                .bind(status)
                .bind(latency)
                .execute(&pool)
                .await;
            }
        });
    }

    res
}

// ---------------------------------------------------------------------------
// Query helpers (read from usage_rollup) shared by portal + admin endpoints.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EndpointStat {
    pub provider: String,
    pub endpoint: String,
    pub count: i64,
    pub avg_latency_ms: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StatusStat {
    pub status_class: i16,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LatencyPoint {
    pub day: NaiveDate,
    pub avg_latency_ms: i64,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DayPoint {
    pub day: NaiveDate,
    pub count: i64,
}

/// Per (provider, endpoint) totals for a customer over the last `days`.
pub async fn endpoint_breakdown(
    pool: &sqlx::PgPool,
    customer_id: Uuid,
    days: i32,
) -> Result<Vec<EndpointStat>, sqlx::Error> {
    sqlx::query_as::<_, EndpointStat>(
        "SELECT provider, endpoint, SUM(count)::bigint AS count,
                CASE WHEN SUM(count) > 0 THEN (SUM(latency_sum) / SUM(count))::bigint ELSE 0 END AS avg_latency_ms
         FROM usage_rollup
         WHERE customer_id = $1 AND day >= current_date - $2::int
         GROUP BY provider, endpoint
         ORDER BY count DESC
         LIMIT 50",
    )
    .bind(customer_id)
    .bind(days)
    .fetch_all(pool)
    .await
}

/// 2xx / 4xx / 5xx split for a customer over the last `days`.
pub async fn status_breakdown(
    pool: &sqlx::PgPool,
    customer_id: Uuid,
    days: i32,
) -> Result<Vec<StatusStat>, sqlx::Error> {
    sqlx::query_as::<_, StatusStat>(
        "SELECT status_class::smallint AS status_class, SUM(count)::bigint AS count
         FROM usage_rollup
         WHERE customer_id = $1 AND day >= current_date - $2::int
         GROUP BY status_class
         ORDER BY status_class",
    )
    .bind(customer_id)
    .bind(days)
    .fetch_all(pool)
    .await
}

/// Daily mean latency + request count for a customer over the last `days`.
pub async fn latency_series(
    pool: &sqlx::PgPool,
    customer_id: Uuid,
    days: i32,
) -> Result<Vec<LatencyPoint>, sqlx::Error> {
    sqlx::query_as::<_, LatencyPoint>(
        "SELECT day,
                CASE WHEN SUM(count) > 0 THEN (SUM(latency_sum) / SUM(count))::bigint ELSE 0 END AS avg_latency_ms,
                SUM(count)::bigint AS count
         FROM usage_rollup
         WHERE customer_id = $1 AND day >= current_date - $2::int
         GROUP BY day
         ORDER BY day",
    )
    .bind(customer_id)
    .bind(days)
    .fetch_all(pool)
    .await
}

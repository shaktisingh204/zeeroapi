//! Self-serve customer portal API (ZeroApi). Customers sign up, log in, manage
//! their own API keys, see usage, and change plans — no admin involvement.
//! Auth is a customer JWT (role = "customer") via the `CustomerAuth` extractor.

use crate::analytics;
use crate::api_keys::generate_key;
use crate::auth::{self, CustomerAuth};
use crate::error::{AppError, AppResult};
use crate::models::{ApiKey, Customer, Plan};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/signup", post(signup))
        .route("/login", post(login))
        .route("/plans", get(plans)) // public: pricing
        .route("/me", get(me))
        .route("/usage", get(usage))
        .route("/usage/history", get(usage_history))
        .route("/usage/breakdown", get(usage_breakdown))
        .route("/usage/status", get(usage_status))
        .route("/usage/latency", get(usage_latency))
        .route("/requests", get(recent_requests))
        .route("/keys", get(list_keys).post(create_key))
        .route("/keys/:id", delete(revoke_key))
        .route("/plan", post(change_plan))
        .route("/account", axum::routing::patch(update_account))
}

/// `?days=` window for analytics endpoints (default 14, capped 90).
#[derive(Deserialize)]
pub struct WindowQuery {
    pub days: Option<i32>,
}
fn window(q: &WindowQuery) -> i32 {
    q.days.unwrap_or(14).clamp(1, 90)
}

#[derive(Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub name: Option<String>,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub customer: Customer,
}

fn token_for(state: &AppState, c: &Customer) -> AppResult<String> {
    auth::issue_token(
        &state.config.jwt_secret,
        state.config.jwt_expiry_hours,
        c.id,
        &c.email,
        "customer",
    )
    .map_err(AppError::Other)
}

async fn signup(
    State(state): State<AppState>,
    Json(req): Json<SignupRequest>,
) -> AppResult<Json<AuthResponse>> {
    if req.password.len() < 8 {
        return Err(AppError::BadRequest("password must be at least 8 characters".into()));
    }
    if !req.email.contains('@') {
        return Err(AppError::BadRequest("invalid email".into()));
    }
    let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM customers WHERE email = $1")
        .bind(&req.email)
        .fetch_optional(&state.pool)
        .await?;
    if exists.is_some() {
        return Err(AppError::BadRequest("email already registered".into()));
    }

    let hash = auth::hash_password(&req.password).map_err(AppError::Other)?;
    let customer: Customer = sqlx::query_as(
        "INSERT INTO customers (email, name, password_hash, plan_slug)
         VALUES ($1, $2, $3, 'free') RETURNING *",
    )
    .bind(&req.email)
    .bind(&req.name)
    .bind(&hash)
    .fetch_one(&state.pool)
    .await?;

    let token = token_for(&state, &customer)?;
    Ok(Json(AuthResponse { token, customer }))
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    let customer: Option<Customer> =
        sqlx::query_as("SELECT * FROM customers WHERE email = $1 AND is_active")
            .bind(&req.email)
            .fetch_optional(&state.pool)
            .await?;
    let customer = customer.ok_or(AppError::Unauthorized)?;
    let ok = customer
        .password_hash
        .as_deref()
        .map(|h| auth::verify_password(&req.password, h))
        .unwrap_or(false);
    if !ok {
        return Err(AppError::Unauthorized);
    }
    let token = token_for(&state, &customer)?;
    Ok(Json(AuthResponse { token, customer }))
}

async fn plans(State(state): State<AppState>) -> AppResult<Json<Vec<Plan>>> {
    let rows: Vec<Plan> = sqlx::query_as("SELECT * FROM plans ORDER BY sort_order")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

async fn me(State(state): State<AppState>, cust: CustomerAuth) -> AppResult<Json<Value>> {
    let customer: Customer = sqlx::query_as("SELECT * FROM customers WHERE id = $1")
        .bind(cust.customer_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    let plan: Plan = sqlx::query_as("SELECT * FROM plans WHERE slug = $1")
        .bind(&customer.plan_slug)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(json!({ "customer": customer, "plan": plan })))
}

async fn usage(State(state): State<AppState>, cust: CustomerAuth) -> AppResult<Json<Value>> {
    let plan: (i32,) =
        sqlx::query_as("SELECT p.monthly_quota FROM customers c JOIN plans p ON p.slug = c.plan_slug WHERE c.id = $1")
            .bind(cust.customer_id)
            .fetch_one(&state.pool)
            .await?;
    let used = if let Some(cache) = &state.cache {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let month = now / 2_592_000;
        cache.get_i64(&format!("quota:{}:{month}", cust.customer_id)).await
    } else {
        0
    };
    Ok(Json(json!({ "used_this_month": used, "monthly_quota": plan.0 })))
}

/// Daily request counts for the last 14 days (oldest first) for the usage chart.
async fn usage_history(State(state): State<AppState>, cust: CustomerAuth) -> AppResult<Json<Value>> {
    let mut points = Vec::new();
    if let Some(cache) = &state.cache {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let today = now / 86_400;
        for i in (0..14).rev() {
            let day = today - i;
            let count = cache.get_i64(&format!("usage:day:{}:{day}", cust.customer_id)).await;
            let date = chrono::DateTime::from_timestamp((day * 86_400) as i64, 0)
                .map(|d| d.format("%m-%d").to_string())
                .unwrap_or_default();
            points.push(json!({ "date": date, "count": count }));
        }
    }
    Ok(Json(json!({ "history": points })))
}

/// Requests-by-endpoint breakdown (provider + endpoint, count, mean latency).
async fn usage_breakdown(
    State(state): State<AppState>,
    cust: CustomerAuth,
    Query(q): Query<WindowQuery>,
) -> AppResult<Json<Value>> {
    let rows = analytics::endpoint_breakdown(&state.pool, cust.customer_id, window(&q)).await?;
    Ok(Json(json!({ "breakdown": rows })))
}

/// 2xx / 4xx / 5xx split.
async fn usage_status(
    State(state): State<AppState>,
    cust: CustomerAuth,
    Query(q): Query<WindowQuery>,
) -> AppResult<Json<Value>> {
    let rows = analytics::status_breakdown(&state.pool, cust.customer_id, window(&q)).await?;
    Ok(Json(json!({ "status": rows })))
}

/// Daily mean latency + request count series.
async fn usage_latency(
    State(state): State<AppState>,
    cust: CustomerAuth,
    Query(q): Query<WindowQuery>,
) -> AppResult<Json<Value>> {
    let rows = analytics::latency_series(&state.pool, cust.customer_id, window(&q)).await?;
    Ok(Json(json!({ "latency": rows })))
}

#[derive(Deserialize)]
pub struct RequestsQuery {
    pub provider: Option<String>,
    pub status_class: Option<i32>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Serialize, sqlx::FromRow)]
struct RequestRow {
    created_at: DateTime<Utc>,
    method: String,
    provider: Option<String>,
    endpoint: String,
    status_code: i32,
    latency_ms: i32,
}

/// Recent API requests made with this customer's keys — paged + filterable,
/// backed by the durable `request_events` table.
async fn recent_requests(
    State(state): State<AppState>,
    cust: CustomerAuth,
    Query(q): Query<RequestsQuery>,
) -> AppResult<Json<Value>> {
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    let rows: Vec<RequestRow> = sqlx::query_as(
        "SELECT created_at, method, provider, endpoint, status_code, latency_ms
         FROM request_events
         WHERE customer_id = $1
           AND ($2::text IS NULL OR provider = $2)
           AND ($3::int  IS NULL OR (status_code / 100) = $3)
         ORDER BY id DESC
         LIMIT $4 OFFSET $5",
    )
    .bind(cust.customer_id)
    .bind(&q.provider)
    .bind(q.status_class)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    // Back-compat fields (t/m/p) plus the richer ones the new Logs UI reads.
    let items: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "t": r.created_at.timestamp(),
                "m": r.method,
                "p": match &r.provider {
                    Some(p) => format!("/v1/{}/{}", p, r.endpoint),
                    None => format!("/v1/{}", r.endpoint),
                },
                "provider": r.provider,
                "endpoint": r.endpoint,
                "status": r.status_code,
                "latency_ms": r.latency_ms,
            })
        })
        .collect();
    Ok(Json(json!({ "requests": items })))
}

#[derive(Deserialize)]
pub struct UpdateAccountRequest {
    pub name: Option<String>,
    pub password: Option<String>,
    /// Usage-alert threshold as a percentage of monthly quota (0–100).
    pub alert_threshold: Option<i32>,
}

async fn update_account(
    State(state): State<AppState>,
    cust: CustomerAuth,
    Json(req): Json<UpdateAccountRequest>,
) -> AppResult<Json<Customer>> {
    if let Some(name) = &req.name {
        sqlx::query("UPDATE customers SET name = $1, updated_at = now() WHERE id = $2")
            .bind(name)
            .bind(cust.customer_id)
            .execute(&state.pool)
            .await?;
    }
    if let Some(threshold) = req.alert_threshold {
        sqlx::query("UPDATE customers SET alert_threshold = $1, updated_at = now() WHERE id = $2")
            .bind(threshold.clamp(0, 100))
            .bind(cust.customer_id)
            .execute(&state.pool)
            .await?;
    }
    if let Some(pw) = &req.password {
        if pw.len() < 8 {
            return Err(AppError::BadRequest("password must be at least 8 characters".into()));
        }
        let hash = auth::hash_password(pw).map_err(AppError::Other)?;
        sqlx::query("UPDATE customers SET password_hash = $1, updated_at = now() WHERE id = $2")
            .bind(hash)
            .bind(cust.customer_id)
            .execute(&state.pool)
            .await?;
    }
    let customer: Customer = sqlx::query_as("SELECT * FROM customers WHERE id = $1")
        .bind(cust.customer_id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(customer))
}

async fn list_keys(State(state): State<AppState>, cust: CustomerAuth) -> AppResult<Json<Vec<ApiKey>>> {
    let rows: Vec<ApiKey> =
        sqlx::query_as("SELECT * FROM api_keys WHERE customer_id = $1 ORDER BY created_at DESC")
            .bind(cust.customer_id)
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct CreateKeyRequest {
    pub name: Option<String>,
    /// Restrict the key to these provider slugs (empty/omitted = all).
    pub allowed_providers: Option<Vec<String>>,
    /// Restrict the key to these source IPs (empty/omitted = any).
    pub allowed_ips: Option<Vec<String>>,
    /// Optional expiry timestamp.
    pub expires_at: Option<DateTime<Utc>>,
}

async fn create_key(
    State(state): State<AppState>,
    cust: CustomerAuth,
    Json(req): Json<CreateKeyRequest>,
) -> AppResult<Json<Value>> {
    let (full, prefix, hash) = generate_key();
    // Normalize empty arrays to NULL (unrestricted).
    let providers = req.allowed_providers.filter(|v| !v.is_empty());
    let ips = req.allowed_ips.filter(|v| !v.is_empty());
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO api_keys (customer_id, name, key_prefix, key_hash,
                               allowed_providers, allowed_ips, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(cust.customer_id)
    .bind(&req.name)
    .bind(&prefix)
    .bind(&hash)
    .bind(providers.as_deref())
    .bind(ips.as_deref())
    .bind(req.expires_at)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(json!({
        "id": id, "key": full, "key_prefix": prefix,
        "note": "Store this key now — it will not be shown again."
    })))
}

async fn revoke_key(
    State(state): State<AppState>,
    cust: CustomerAuth,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    // Scope the revoke to the caller's own keys.
    let res = sqlx::query("UPDATE api_keys SET revoked = true WHERE id = $1 AND customer_id = $2")
        .bind(id)
        .bind(cust.customer_id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "revoked": id })))
}

#[derive(Deserialize)]
pub struct ChangePlanRequest {
    pub plan_slug: String,
}

async fn change_plan(
    State(state): State<AppState>,
    cust: CustomerAuth,
    Json(req): Json<ChangePlanRequest>,
) -> AppResult<Json<Customer>> {
    // (No billing — self-serve plan switch for the demo.)
    let plan_exists: Option<String> = sqlx::query_scalar("SELECT slug FROM plans WHERE slug = $1")
        .bind(&req.plan_slug)
        .fetch_optional(&state.pool)
        .await?;
    if plan_exists.is_none() {
        return Err(AppError::BadRequest("unknown plan".into()));
    }
    let customer: Customer = sqlx::query_as(
        "UPDATE customers SET plan_slug = $1, updated_at = now() WHERE id = $2 RETURNING *",
    )
    .bind(&req.plan_slug)
    .bind(cust.customer_id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(customer))
}

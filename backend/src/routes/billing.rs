//! Stripe billing. Calls the Stripe REST API directly via reqwest (no SDK).
//! Endpoints are no-ops returning 404 when STRIPE_SECRET_KEY is unset, so the
//! product still runs without billing configured.

use crate::auth::CustomerAuth;
use crate::error::{AppError, AppResult};
use crate::models::{Customer, Plan};
use crate::state::AppState;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/summary", get(summary))
        .route("/invoices", get(invoices))
        .route("/checkout", post(checkout))
        .route("/portal-session", post(portal_session))
}

/// The Stripe webhook lives outside `/portal` (no customer JWT) — mounted by the
/// caller. Verifies the signature against STRIPE_WEBHOOK_SECRET.
pub fn webhook_router() -> Router<AppState> {
    Router::new().route("/webhook", post(webhook))
}

fn stripe_enabled(state: &AppState) -> AppResult<&str> {
    let key = state.config.stripe_secret_key.as_str();
    if key.is_empty() {
        return Err(AppError::NotFound);
    }
    Ok(key)
}

async fn stripe_post(secret: &str, path: &str, form: &[(&str, String)]) -> AppResult<Value> {
    let res = reqwest::Client::new()
        .post(format!("https://api.stripe.com/v1/{path}"))
        .basic_auth(secret, Some(""))
        .form(form)
        .send()
        .await
        .map_err(|e| AppError::Other(e.into()))?;
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| AppError::Other(e.into()))?;
    if !status.is_success() {
        let msg = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("stripe error");
        return Err(AppError::BadRequest(format!("stripe: {msg}")));
    }
    Ok(body)
}

async fn stripe_get(secret: &str, path: &str, query: &[(&str, String)]) -> AppResult<Value> {
    let res = reqwest::Client::new()
        .get(format!("https://api.stripe.com/v1/{path}"))
        .basic_auth(secret, Some(""))
        .query(query)
        .send()
        .await
        .map_err(|e| AppError::Other(e.into()))?;
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| AppError::Other(e.into()))?;
    if !status.is_success() {
        let msg = body
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("stripe error");
        return Err(AppError::BadRequest(format!("stripe: {msg}")));
    }
    Ok(body)
}

async fn fetch_customer(state: &AppState, id: uuid::Uuid) -> AppResult<Customer> {
    sqlx::query_as::<_, Customer>("SELECT * FROM customers WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)
}

async fn fetch_plan(state: &AppState, slug: &str) -> AppResult<Plan> {
    sqlx::query_as::<_, Plan>("SELECT * FROM plans WHERE slug = $1")
        .bind(slug)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Ensure the customer has a Stripe customer id, creating one if needed.
async fn ensure_stripe_customer(state: &AppState, secret: &str, c: &Customer) -> AppResult<String> {
    if let Some(id) = &c.stripe_customer_id {
        return Ok(id.clone());
    }
    let body = stripe_post(
        secret,
        "customers",
        &[
            ("email", c.email.clone()),
            ("metadata[customer_id]", c.id.to_string()),
        ],
    )
    .await?;
    let stripe_id = body
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Other(anyhow::anyhow!("no stripe customer id")))?
        .to_string();
    sqlx::query("UPDATE customers SET stripe_customer_id = $1 WHERE id = $2")
        .bind(&stripe_id)
        .bind(c.id)
        .execute(&state.pool)
        .await?;
    Ok(stripe_id)
}

/// Calendar-month request count from the rollup (used for billing summary).
async fn month_usage(state: &AppState, id: uuid::Uuid) -> AppResult<i64> {
    let n: Option<i64> = sqlx::query_scalar(
        "SELECT SUM(count)::bigint FROM usage_rollup
         WHERE customer_id = $1 AND day >= date_trunc('month', current_date)::date",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    Ok(n.unwrap_or(0))
}

async fn summary(State(state): State<AppState>, cust: CustomerAuth) -> AppResult<Json<Value>> {
    stripe_enabled(&state)?;
    let customer = fetch_customer(&state, cust.customer_id).await?;
    let plan = fetch_plan(&state, &customer.plan_slug).await?;
    let used = month_usage(&state, cust.customer_id).await?;

    let overage = if plan.monthly_quota >= 0 {
        (used - plan.monthly_quota as i64).max(0)
    } else {
        0
    };
    // Base price + simple overage estimate ($0.50 per 1k extra requests).
    let overage_cost = (overage as f64 / 1000.0 * 50.0).round() as i64;
    let estimated = plan.price_cents as i64 + overage_cost;

    Ok(Json(json!({
        "plan": plan,
        "subscription_status": customer.subscription_status,
        "used_this_month": used,
        "monthly_quota": plan.monthly_quota,
        "overage": overage,
        "estimated_cost_cents": estimated,
        "has_payment_method": customer.stripe_subscription_id.is_some(),
    })))
}

/// Billing history — the customer's Stripe invoices (most recent first).
/// Returns an empty list if the customer has no Stripe customer id yet.
async fn invoices(State(state): State<AppState>, cust: CustomerAuth) -> AppResult<Json<Value>> {
    let secret = stripe_enabled(&state)?;
    let customer = fetch_customer(&state, cust.customer_id).await?;
    let Some(stripe_customer) = customer.stripe_customer_id.clone() else {
        return Ok(Json(json!({ "invoices": [] })));
    };
    let body = stripe_get(
        secret,
        "invoices",
        &[("customer", stripe_customer), ("limit", "24".into())],
    )
    .await?;
    let list = body.get("data").cloned().unwrap_or_else(|| json!([]));
    let invoices: Vec<Value> = list
        .as_array()
        .map(|a| {
            a.iter()
                .map(|i| {
                    json!({
                        "id": i.get("id"),
                        "number": i.get("number"),
                        "created": i.get("created"),
                        "amount_due": i.get("amount_due"),
                        "amount_paid": i.get("amount_paid"),
                        "currency": i.get("currency"),
                        "status": i.get("status"),
                        "hosted_invoice_url": i.get("hosted_invoice_url"),
                        "invoice_pdf": i.get("invoice_pdf"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Json(json!({ "invoices": invoices })))
}

#[derive(Deserialize)]
pub struct CheckoutRequest {
    pub plan_slug: String,
}

async fn checkout(
    State(state): State<AppState>,
    cust: CustomerAuth,
    Json(req): Json<CheckoutRequest>,
) -> AppResult<Json<Value>> {
    let secret = stripe_enabled(&state)?;
    let customer = fetch_customer(&state, cust.customer_id).await?;
    let plan = fetch_plan(&state, &req.plan_slug).await?;
    let price = plan
        .stripe_price_id
        .clone()
        .ok_or_else(|| AppError::BadRequest("this plan has no Stripe price configured".into()))?;

    let stripe_customer = ensure_stripe_customer(&state, secret, &customer).await?;
    let base = &state.config.portal_base_url;

    let body = stripe_post(
        secret,
        "checkout/sessions",
        &[
            ("mode", "subscription".into()),
            ("customer", stripe_customer),
            ("line_items[0][price]", price),
            ("line_items[0][quantity]", "1".into()),
            ("success_url", format!("{base}/portal/billing?checkout=success")),
            ("cancel_url", format!("{base}/portal/billing?checkout=cancel")),
            ("metadata[customer_id]", customer.id.to_string()),
            ("metadata[plan_slug]", req.plan_slug.clone()),
            ("subscription_data[metadata][customer_id]", customer.id.to_string()),
            ("subscription_data[metadata][plan_slug]", req.plan_slug),
        ],
    )
    .await?;

    let url = body.get("url").and_then(|v| v.as_str()).unwrap_or_default();
    Ok(Json(json!({ "url": url })))
}

async fn portal_session(State(state): State<AppState>, cust: CustomerAuth) -> AppResult<Json<Value>> {
    let secret = stripe_enabled(&state)?;
    let customer = fetch_customer(&state, cust.customer_id).await?;
    let stripe_customer = customer
        .stripe_customer_id
        .clone()
        .ok_or_else(|| AppError::BadRequest("no Stripe customer yet — upgrade a plan first".into()))?;
    let base = &state.config.portal_base_url;
    let body = stripe_post(
        secret,
        "billing_portal/sessions",
        &[
            ("customer", stripe_customer),
            ("return_url", format!("{base}/portal/billing")),
        ],
    )
    .await?;
    let url = body.get("url").and_then(|v| v.as_str()).unwrap_or_default();
    Ok(Json(json!({ "url": url })))
}

// ---------------- Webhook ----------------

fn verify_signature(secret: &str, sig_header: &str, payload: &[u8]) -> bool {
    // Header form: t=timestamp,v1=signature[,v1=...]
    let mut timestamp = "";
    let mut signatures: Vec<&str> = Vec::new();
    for part in sig_header.split(',') {
        if let Some((k, v)) = part.split_once('=') {
            match k {
                "t" => timestamp = v,
                "v1" => signatures.push(v),
                _ => {}
            }
        }
    }
    if timestamp.is_empty() || signatures.is_empty() {
        return false;
    }
    let mut mac = match Hmac::<Sha256>::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(payload);
    let expected = hex::encode(mac.finalize().into_bytes());
    signatures.iter().any(|s| s.eq_ignore_ascii_case(&expected))
}

async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<Json<Value>> {
    let secret = &state.config.stripe_webhook_secret;
    if secret.is_empty() {
        return Err(AppError::NotFound);
    }
    let sig = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !verify_signature(secret, sig, &body) {
        return Err(AppError::Unauthorized);
    }

    let event: Value = serde_json::from_slice(&body).map_err(|e| AppError::Other(e.into()))?;
    let kind = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let obj = event.pointer("/data/object").cloned().unwrap_or(Value::Null);

    match kind {
        "checkout.session.completed" => {
            let customer_id = obj.pointer("/metadata/customer_id").and_then(|v| v.as_str());
            let plan_slug = obj.pointer("/metadata/plan_slug").and_then(|v| v.as_str());
            let sub = obj.get("subscription").and_then(|v| v.as_str());
            if let (Some(cid), Some(plan)) = (customer_id, plan_slug) {
                if let Ok(uid) = uuid::Uuid::parse_str(cid) {
                    let _ = sqlx::query(
                        "UPDATE customers
                         SET plan_slug = $1, stripe_subscription_id = $2,
                             subscription_status = 'active', updated_at = now()
                         WHERE id = $3",
                    )
                    .bind(plan)
                    .bind(sub)
                    .bind(uid)
                    .execute(&state.pool)
                    .await;
                }
            }
        }
        "customer.subscription.updated" | "customer.subscription.deleted" => {
            let status = obj.get("status").and_then(|v| v.as_str()).unwrap_or("canceled");
            let cid = obj.pointer("/metadata/customer_id").and_then(|v| v.as_str());
            if let Some(cid) = cid {
                if let Ok(uid) = uuid::Uuid::parse_str(cid) {
                    // On cancel, drop back to the free plan.
                    if kind == "customer.subscription.deleted" {
                        let _ = sqlx::query(
                            "UPDATE customers SET plan_slug = 'free', subscription_status = 'canceled',
                             stripe_subscription_id = NULL, updated_at = now() WHERE id = $1",
                        )
                        .bind(uid)
                        .execute(&state.pool)
                        .await;
                    } else {
                        let _ = sqlx::query(
                            "UPDATE customers SET subscription_status = $1, updated_at = now() WHERE id = $2",
                        )
                        .bind(status)
                        .bind(uid)
                        .execute(&state.pool)
                        .await;
                    }
                }
            }
        }
        _ => {}
    }

    Ok(Json(json!({ "received": true })))
}

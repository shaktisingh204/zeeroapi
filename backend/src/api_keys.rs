//! Public-API authentication: API-key generation/hashing and the `ApiClient`
//! request extractor that resolves a key to its customer + plan and enforces
//! plan-based rate limiting and monthly quota via Redis.

use crate::analytics::{client_ip, parse_v1_path};
use crate::error::AppError;
use crate::models::Plan;
use crate::state::AppState;
use axum::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use chrono::{DateTime, Utc};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub fn sha256_hex(input: &str) -> String {
    let mut h = Sha256::new();
    h.update(input.as_bytes());
    hex::encode(h.finalize())
}

/// Generate a new API key. Returns (full_key, visible_prefix, sha256_hash).
/// The full key is shown to the user exactly once; we persist only the hash.
pub fn generate_key() -> (String, String, String) {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    let body: String = (0..40).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect();
    let full = format!("mk_live_{body}");
    let prefix = full.chars().take(16).collect::<String>();
    let hash = sha256_hex(&full);
    (full, prefix, hash)
}

/// An authenticated API consumer, attached to public `/api/v1` handlers.
#[derive(Debug, Clone)]
pub struct ApiClient {
    pub customer_id: Uuid,
    pub api_key_id: Uuid,
    pub plan: Plan,
    pub remaining: i64,
}

#[async_trait]
impl FromRequestParts<AppState> for ApiClient {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        // Accept the key via `X-API-Key` header or `?api_key=` query param.
        let key = parts
            .headers
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .or_else(|| {
                parts.uri.query().and_then(|q| {
                    q.split('&')
                        .find_map(|kv| kv.strip_prefix("api_key=").map(|v| v.to_string()))
                })
            })
            .ok_or(AppError::Unauthorized)?;

        let hash = sha256_hex(&key);

        // Resolve key -> customer -> plan (+ key scoping) in one query.
        let row: Option<ApiAuthRow> = sqlx::query_as::<_, ApiAuthRow>(
            "SELECT k.id AS api_key_id, c.id AS customer_id,
                    k.allowed_providers, k.allowed_ips, k.expires_at,
                    p.slug, p.name, p.price_cents, p.rate_limit_per_min,
                    p.rate_limit_per_sec, p.monthly_quota, p.features, p.sort_order,
                    p.stripe_price_id, p.metered_price_id
             FROM api_keys k
             JOIN customers c ON c.id = k.customer_id
             JOIN plans p ON p.slug = c.plan_slug
             WHERE k.key_hash = $1 AND NOT k.revoked AND c.is_active",
        )
        .bind(&hash)
        .fetch_optional(&state.pool)
        .await?;

        let auth = row.ok_or(AppError::Unauthorized)?;
        let api_key_id = auth.api_key_id;

        // ---- Key scoping enforcement ----
        // Expiry.
        if let Some(exp) = auth.expires_at {
            if exp < Utc::now() {
                return Err(AppError::Unauthorized);
            }
        }
        // Provider allow-list (provider parsed from the request path).
        let (req_provider, _endpoint) = parse_v1_path(parts.uri.path());
        if let Some(allowed) = &auth.allowed_providers {
            if !allowed.is_empty() {
                match &req_provider {
                    Some(p) if allowed.iter().any(|a| a == p) => {}
                    // Meta endpoints (no provider) are always allowed.
                    None => {}
                    _ => return Err(AppError::Forbidden),
                }
            }
        }
        // IP allow-list (best-effort from proxy headers).
        if let Some(ips) = &auth.allowed_ips {
            if !ips.is_empty() {
                let ip = client_ip(&parts.headers);
                match ip {
                    Some(ip) if ips.iter().any(|a| a == &ip) => {}
                    _ => return Err(AppError::Forbidden),
                }
            }
        }

        let (customer_id, plan): (Uuid, Plan) = auth.into();

        // Touch last_used_at (best-effort, don't block on it).
        {
            let pool = state.pool.clone();
            let h = hash.clone();
            tokio::spawn(async move {
                let _ = sqlx::query("UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1")
                    .bind(h)
                    .execute(&pool)
                    .await;
            });
        }

        // Rate limit + quota via Redis (skipped gracefully if Redis is down).
        let mut remaining = plan.rate_limit_per_min as i64;
        if let Some(cache) = &state.cache {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
            // A per-second limit (when set) overrides the per-minute one: same
            // counter pattern, just a 1-second window keyed on the current second.
            let (limit, used) = match plan.rate_limit_per_sec {
                Some(per_sec) if per_sec > 0 => {
                    let rl_key = format!("rls:{hash}:{now}");
                    (per_sec as i64, cache.incr_ex(&rl_key, 1).await)
                }
                _ => {
                    let rl_key = format!("rl:{hash}:{}", now / 60);
                    (plan.rate_limit_per_min as i64, cache.incr_ex(&rl_key, 60).await)
                }
            };
            remaining = (limit - used).max(0);
            if used > limit {
                return Err(AppError::TooManyRequests);
            }

            // Monthly quota (-1 = unlimited). Plans with a metered Stripe price
            // are allowed to exceed quota (billed as overage); other capped
            // plans hard-block with 402.
            if plan.monthly_quota >= 0 {
                let month = format!("{}", now / 2_592_000); // ~30-day bucket
                let q_key = format!("quota:{customer_id}:{month}");
                let qused = cache.incr_ex(&q_key, 2_592_000).await;
                if qused > plan.monthly_quota as i64 && plan.metered_price_id.is_none() {
                    return Err(AppError::QuotaExceeded);
                }
            }

            // Per-day usage counter (for the portal usage chart) + request log.
            let day = now / 86_400;
            cache
                .incr_ex(&format!("usage:day:{customer_id}:{day}"), 86_400 * 35)
                .await;
            let entry = format!(
                r#"{{"t":{now},"m":"{}","p":"{}"}}"#,
                parts.method.as_str(),
                parts.uri.path()
            );
            cache
                .log_push(&format!("reqlog:{customer_id}"), &entry, 50, 86_400 * 7)
                .await;
        }

        Ok(ApiClient {
            customer_id,
            api_key_id,
            plan,
            remaining,
        })
    }
}

/// Flat row used to build (customer_id, Plan) from the auth join.
#[derive(sqlx::FromRow)]
struct ApiAuthRow {
    api_key_id: Uuid,
    customer_id: Uuid,
    allowed_providers: Option<Vec<String>>,
    allowed_ips: Option<Vec<String>>,
    expires_at: Option<DateTime<Utc>>,
    slug: String,
    name: String,
    price_cents: i32,
    rate_limit_per_min: i32,
    rate_limit_per_sec: Option<i32>,
    monthly_quota: i32,
    features: serde_json::Value,
    sort_order: i32,
    stripe_price_id: Option<String>,
    metered_price_id: Option<String>,
}

impl From<ApiAuthRow> for (Uuid, Plan) {
    fn from(r: ApiAuthRow) -> Self {
        (
            r.customer_id,
            Plan {
                slug: r.slug,
                name: r.name,
                price_cents: r.price_cents,
                rate_limit_per_min: r.rate_limit_per_min,
                rate_limit_per_sec: r.rate_limit_per_sec,
                monthly_quota: r.monthly_quota,
                features: r.features,
                sort_order: r.sort_order,
                stripe_price_id: r.stripe_price_id,
                metered_price_id: r.metered_price_id,
            },
        )
    }
}

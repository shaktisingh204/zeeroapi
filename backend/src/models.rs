use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Sport {
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub is_active: bool,
    pub match_count: i32,
    pub logo_url: Option<String>,
    pub provider: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct League {
    pub id: i64,
    pub sport_id: i64,
    pub name: String,
    pub country: Option<String>,
    pub logo_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// League joined with sport name + match count for the Leagues tab.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct LeagueView {
    pub id: i64,
    pub sport_id: i64,
    pub sport_name: String,
    pub name: String,
    pub country: Option<String>,
    pub logo_url: Option<String>,
    pub match_count: i64,
    pub live_count: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Image {
    pub url: String,
    pub kind: String,
    pub name: Option<String>,
    pub seen_count: i32,
    pub created_at: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Match {
    pub id: i64,
    pub sport_id: i64,
    pub league_id: Option<i64>,
    pub home_team: String,
    pub away_team: String,
    pub start_time: Option<DateTime<Utc>>,
    pub status: String,
    pub home_score: Option<i32>,
    pub away_score: Option<i32>,
    pub period: Option<String>,
    pub match_time: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Match joined with sport & league names for convenient API responses.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MatchView {
    pub id: i64,
    pub provider: String,
    pub sport_id: i64,
    pub sport_name: String,
    pub league_id: Option<i64>,
    pub league_name: Option<String>,
    pub home_team: String,
    pub away_team: String,
    pub home_logo: Option<String>,
    pub away_logo: Option<String>,
    pub start_time: Option<DateTime<Utc>>,
    pub status: String,
    pub home_score: Option<i32>,
    pub away_score: Option<i32>,
    pub period: Option<String>,
    pub match_time: Option<String>,
    pub result: Option<String>,
    pub finished_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Odd {
    pub id: i64,
    pub match_id: i64,
    pub group_id: Option<i64>,
    pub type_code: Option<i64>,
    pub market: String,
    pub outcome: String,
    pub value: Decimal,
    pub param: Option<Decimal>,
    pub source: String,
    pub provider: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ScrapeLog {
    pub id: i64,
    pub job: String,
    pub status: String,
    pub items: i32,
    pub duration_ms: i64,
    pub message: Option<String>,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Page {
    pub url: String,
    pub kind: String,
    pub sport_slug: Option<String>,
    pub league_id: Option<i64>,
    pub game_id: Option<i64>,
    pub title: Option<String>,
    pub matches_found: i32,
    pub odds_found: i32,
    pub status: String,
    pub note: Option<String>,
    pub last_crawled_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Provider {
    pub slug: String,
    pub name: String,
    pub base_url: String,
    pub is_active: bool,
    pub capabilities: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Plan {
    pub slug: String,
    pub name: String,
    pub price_cents: i32,
    pub rate_limit_per_min: i32,
    pub monthly_quota: i32,
    pub features: serde_json::Value,
    pub sort_order: i32,
    pub stripe_price_id: Option<String>,
    pub metered_price_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Customer {
    pub id: Uuid,
    pub email: String,
    pub name: Option<String>,
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,
    pub plan_slug: String,
    pub is_active: bool,
    pub alert_threshold: i32,
    pub stripe_customer_id: Option<String>,
    pub stripe_subscription_id: Option<String>,
    pub subscription_status: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ApiKey {
    pub id: Uuid,
    pub customer_id: Uuid,
    pub name: Option<String>,
    pub key_prefix: String,
    #[serde(skip_serializing)]
    pub key_hash: String,
    pub revoked: bool,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub allowed_providers: Option<Vec<String>>,
    pub allowed_ips: Option<Vec<String>>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCustomerRequest {
    pub email: String,
    pub name: Option<String>,
    #[serde(default = "default_plan")]
    pub plan_slug: String,
}

fn default_plan() -> String {
    "free".to_string()
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: DateTime<Utc>,
}

// --------- Request / response DTOs ---------

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: User,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
    #[serde(default = "default_role")]
    pub role: String,
}

fn default_role() -> String {
    "viewer".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingRequest {
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct DashboardStats {
    pub total_sports: i64,
    pub total_leagues: i64,
    pub total_matches: i64,
    pub live_matches: i64,
    pub prematch_matches: i64,
    pub total_odds: i64,
    pub last_scrape: Option<ScrapeLog>,
    pub matches_by_sport: Vec<SportCount>,
    pub scrapes_last_24h: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SportCount {
    pub sport_name: String,
    pub count: i64,
}

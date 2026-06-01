use std::env;

/// Strongly-typed runtime configuration, loaded from the environment.
#[derive(Clone, Debug)]
pub struct Config {
    pub bind_addr: String,
    pub database_url: String,
    pub database_max_connections: u32,

    pub jwt_secret: String,
    pub jwt_expiry_hours: i64,

    pub ingest_key: String,
    pub redis_url: String,

    pub page_scraper_python: String,
    pub page_scraper_script: String,

    pub bootstrap_admin_email: String,
    pub bootstrap_admin_password: String,

    pub melbet_base_url: String,
    pub melbet_lang: String,
    pub melbet_partner: i64,

    pub scrape_enabled: bool,
    pub scrape_prematch_interval_secs: u64,
    pub scrape_live_interval_secs: u64,
    pub scrape_request_delay_ms: u64,

    pub cors_origins: Vec<String>,

    // Stripe billing (optional — billing endpoints 404 if the secret is unset).
    pub stripe_secret_key: String,
    pub stripe_webhook_secret: String,
    pub portal_base_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        // Load .env if present; ignore if missing (e.g. in containers).
        let _ = dotenvy::dotenv();

        Ok(Self {
            bind_addr: get("BIND_ADDR", "0.0.0.0:8080"),
            database_url: env::var("DATABASE_URL")
                .map_err(|_| anyhow::anyhow!("DATABASE_URL must be set"))?,
            database_max_connections: get("DATABASE_MAX_CONNECTIONS", "32").parse()?,

            jwt_secret: get("JWT_SECRET", "change-me"),
            jwt_expiry_hours: get("JWT_EXPIRY_HOURS", "24").parse()?,

            ingest_key: get("INGEST_KEY", "dev-ingest-key"),
            redis_url: get("REDIS_URL", "redis://127.0.0.1:6379"),

            page_scraper_python: get("PAGE_SCRAPER_PYTHON", "../scraper-py/.venv/bin/python"),
            page_scraper_script: get("PAGE_SCRAPER_SCRIPT", "../scraper-py/realtime.py"),

            bootstrap_admin_email: get("BOOTSTRAP_ADMIN_EMAIL", "admin@melbet-saas.local"),
            bootstrap_admin_password: get("BOOTSTRAP_ADMIN_PASSWORD", "admin12345"),

            melbet_base_url: get("MELBET_BASE_URL", "https://india.melbet.com")
                .trim_end_matches('/')
                .to_string(),
            melbet_lang: get("MELBET_LANG", "en"),
            melbet_partner: get("MELBET_PARTNER", "8").parse()?,

            scrape_enabled: get("SCRAPE_ENABLED", "true").parse().unwrap_or(true),
            scrape_prematch_interval_secs: get("SCRAPE_PREMATCH_INTERVAL_SECS", "300").parse()?,
            scrape_live_interval_secs: get("SCRAPE_LIVE_INTERVAL_SECS", "20").parse()?,
            scrape_request_delay_ms: get("SCRAPE_REQUEST_DELAY_MS", "400").parse()?,

            cors_origins: get("CORS_ORIGINS", "http://localhost:3000")
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),

            stripe_secret_key: get("STRIPE_SECRET_KEY", ""),
            stripe_webhook_secret: get("STRIPE_WEBHOOK_SECRET", ""),
            portal_base_url: get("PORTAL_BASE_URL", "http://localhost:3000")
                .trim_end_matches('/')
                .to_string(),
        })
    }
}

fn get(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

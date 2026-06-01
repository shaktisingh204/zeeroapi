use crate::cache::Cache;
use crate::config::Config;
use crate::scraper::melbet::MelbetScraper;
use sqlx::PgPool;
use std::sync::Arc;

/// Shared application state passed to every handler.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<Config>,
    pub scraper: Arc<MelbetScraper>,
    /// Redis cache — None if Redis was unreachable at startup.
    pub cache: Option<Cache>,
}

impl AppState {
    pub fn new(pool: PgPool, config: Config, cache: Option<Cache>) -> anyhow::Result<Self> {
        let config = Arc::new(config);
        let scraper = Arc::new(MelbetScraper::new(config.clone())?);
        Ok(Self {
            pool,
            config,
            scraper,
            cache,
        })
    }
}

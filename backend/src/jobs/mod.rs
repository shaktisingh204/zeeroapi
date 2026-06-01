pub mod scheduler;

use crate::scraper::types::ScrapeOutcome;
use crate::state::AppState;
use std::time::Instant;

/// Run a single named scrape job, persisting a row in `scrape_logs`.
/// Returns the outcome so HTTP callers can surface it too.
pub async fn run_job<F, Fut>(state: &AppState, job: &str, f: F) -> anyhow::Result<ScrapeOutcome>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<ScrapeOutcome>>,
{
    let start = Instant::now();
    let result = f().await;
    let duration_ms = start.elapsed().as_millis() as i64;

    match &result {
        Ok(outcome) => {
            let _ = sqlx::query(
                "INSERT INTO scrape_logs (job, status, items, duration_ms, message)
                 VALUES ($1, 'success', $2, $3, $4)",
            )
            .bind(job)
            .bind(outcome.matches as i32)
            .bind(duration_ms)
            .bind(format!("{} matches, {} odds", outcome.matches, outcome.odds))
            .execute(&state.pool)
            .await;
            tracing::info!(job, matches = outcome.matches, odds = outcome.odds, duration_ms, "scrape ok");
        }
        Err(e) => {
            let _ = sqlx::query(
                "INSERT INTO scrape_logs (job, status, items, duration_ms, message)
                 VALUES ($1, 'error', 0, $2, $3)",
            )
            .bind(job)
            .bind(duration_ms)
            .bind(e.to_string())
            .execute(&state.pool)
            .await;
            tracing::error!(job, error = %e, "scrape failed");
        }
    }

    result
}

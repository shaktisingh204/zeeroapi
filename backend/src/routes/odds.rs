use crate::error::AppResult;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new().route("/:match_id/history", get(history))
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub market: Option<String>,
    pub outcome: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OddPoint {
    pub market: String,
    pub outcome: String,
    pub value: Decimal,
    pub param: Option<Decimal>,
    pub recorded_at: DateTime<Utc>,
}

/// Line-movement history for a match, optionally filtered to one market/outcome.
async fn history(
    State(state): State<AppState>,
    Path(match_id): Path<i64>,
    Query(q): Query<HistoryQuery>,
) -> AppResult<Json<Vec<OddPoint>>> {
    let limit = q.limit.unwrap_or(500).clamp(1, 5000);
    let rows: Vec<OddPoint> = sqlx::query_as(
        "SELECT market, outcome, value, param, recorded_at
         FROM odds_history
         WHERE match_id = $1
           AND ($2::text IS NULL OR market = $2)
           AND ($3::text IS NULL OR outcome = $3)
         ORDER BY recorded_at ASC
         LIMIT $4",
    )
    .bind(match_id)
    .bind(q.market)
    .bind(q.outcome)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

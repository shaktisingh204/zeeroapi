use crate::error::AppResult;
use crate::models::MatchView;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(live))
}

#[derive(Debug, Deserialize)]
pub struct LiveQuery {
    pub provider: Option<String>,
}

/// All currently-live matches with their scores, freshest first.
async fn live(
    State(state): State<AppState>,
    Query(q): Query<LiveQuery>,
) -> AppResult<Json<Vec<MatchView>>> {
    let rows: Vec<MatchView> = sqlx::query_as(
        "SELECT m.id, m.provider, m.sport_id, s.name AS sport_name, m.league_id, l.name AS league_name,
                m.home_team, m.away_team, m.home_logo, m.away_logo,
                m.start_time, m.status, m.home_score, m.away_score,
                m.period, m.match_time, m.result, m.finished_at, m.suspended, m.featured, m.updated_at
         FROM matches m
         JOIN sports s ON s.id = m.sport_id
         LEFT JOIN leagues l ON l.id = m.league_id
         WHERE m.status = 'live'
           AND ($1::text IS NULL OR m.provider = $1)
         ORDER BY m.updated_at DESC",
    )
    .bind(q.provider)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

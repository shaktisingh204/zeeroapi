use crate::error::{AppError, AppResult};
use crate::models::{MatchView, Odd};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/:id", get(detail))
        .route("/:id/odds", get(odds))
}

#[derive(Debug, Deserialize)]
pub struct MatchQuery {
    pub status: Option<String>,
    pub sport_id: Option<i64>,
    pub league_id: Option<i64>,
    pub search: Option<String>,
    pub provider: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

const BASE_SELECT: &str = "
    SELECT m.id, m.provider, m.sport_id, s.name AS sport_name, m.league_id, l.name AS league_name,
           m.home_team, m.away_team, m.home_logo, m.away_logo,
           m.start_time, m.status, m.home_score, m.away_score,
           m.period, m.match_time, m.result, m.finished_at, m.suspended, m.featured, m.updated_at
    FROM matches m
    JOIN sports s ON s.id = m.sport_id
    LEFT JOIN leagues l ON l.id = m.league_id
";

async fn list(
    State(state): State<AppState>,
    Query(q): Query<MatchQuery>,
) -> AppResult<Json<Vec<MatchView>>> {
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    let search = q.search.map(|s| format!("%{}%", s.to_lowercase()));

    // Dynamic but parameterized: each filter is NULL-guarded in SQL.
    let sql = format!(
        "{BASE_SELECT}
         WHERE ($1::text IS NULL OR m.status = $1)
           AND ($2::bigint IS NULL OR m.sport_id = $2)
           AND ($3::bigint IS NULL OR m.league_id = $3)
           AND ($4::text IS NULL OR lower(m.home_team) LIKE $4 OR lower(m.away_team) LIKE $4)
           AND ($5::text IS NULL OR m.provider = $5)
         ORDER BY (m.status = 'live') DESC, m.start_time ASC NULLS LAST
         LIMIT $6 OFFSET $7"
    );

    let rows: Vec<MatchView> = sqlx::query_as(&sql)
        .bind(q.status)
        .bind(q.sport_id)
        .bind(q.league_id)
        .bind(search)
        .bind(q.provider)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;

    Ok(Json(rows))
}

#[derive(Debug, Serialize)]
pub struct MatchDetail {
    #[serde(flatten)]
    pub match_view: MatchView,
    pub odds: Vec<Odd>,
}

async fn detail(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<Json<MatchDetail>> {
    let sql = format!("{BASE_SELECT} WHERE m.id = $1");
    let match_view: MatchView = sqlx::query_as(&sql)
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;

    let odds: Vec<Odd> = sqlx::query_as(
        "SELECT * FROM odds WHERE match_id = $1 ORDER BY market, outcome",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(MatchDetail { match_view, odds }))
}

async fn odds(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<Json<Vec<Odd>>> {
    let odds: Vec<Odd> = sqlx::query_as(
        "SELECT * FROM odds WHERE match_id = $1 ORDER BY market, outcome",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(odds))
}

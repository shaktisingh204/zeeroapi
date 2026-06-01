use crate::error::AppResult;
use crate::models::LeagueView;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list))
}

#[derive(Debug, Deserialize)]
pub struct LeagueQuery {
    pub sport_id: Option<i64>,
    pub search: Option<String>,
    pub provider: Option<String>,
    pub limit: Option<i64>,
}

async fn list(
    State(state): State<AppState>,
    Query(q): Query<LeagueQuery>,
) -> AppResult<Json<Vec<LeagueView>>> {
    let limit = q.limit.unwrap_or(200).clamp(1, 1000);
    let search = q.search.map(|s| format!("%{}%", s.to_lowercase()));

    let rows: Vec<LeagueView> = sqlx::query_as(
        "SELECT l.id, l.sport_id, s.name AS sport_name, l.name, l.country, l.logo_url,
                COUNT(m.id) AS match_count,
                COUNT(m.id) FILTER (WHERE m.status = 'live') AS live_count,
                l.updated_at
         FROM leagues l
         JOIN sports s ON s.id = l.sport_id
         LEFT JOIN matches m ON m.league_id = l.id
         WHERE ($1::bigint IS NULL OR l.sport_id = $1)
           AND ($2::text IS NULL OR lower(l.name) LIKE $2)
           AND ($3::text IS NULL OR l.provider = $3)
         GROUP BY l.id, s.name
         ORDER BY match_count DESC, l.name ASC
         LIMIT $4",
    )
    .bind(q.sport_id)
    .bind(search)
    .bind(q.provider)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

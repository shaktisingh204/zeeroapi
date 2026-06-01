use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::models::Sport;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/:id/toggle", patch(toggle))
}

#[derive(Debug, Deserialize)]
pub struct SportQuery {
    pub provider: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    Query(q): Query<SportQuery>,
) -> AppResult<Json<Vec<Sport>>> {
    // match_count is a denormalized column; compute the live per-provider count
    // so the admin view reflects the selected provider accurately.
    let sports: Vec<Sport> = sqlx::query_as(
        "SELECT s.id, s.name, s.slug, s.is_active,
                COALESCE(COUNT(m.id), 0)::int AS match_count,
                s.logo_url, s.provider, s.created_at, s.updated_at
         FROM sports s
         LEFT JOIN matches m ON m.sport_id = s.id
         WHERE ($1::text IS NULL OR s.provider = $1)
         GROUP BY s.id
         ORDER BY match_count DESC, s.name ASC",
    )
    .bind(q.provider)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(sports))
}

async fn toggle(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Sport>> {
    user.require_editor()?;
    let sport: Sport = sqlx::query_as(
        "UPDATE sports SET is_active = NOT is_active, updated_at = now()
         WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(sport))
}

use crate::auth::{self, AuthUser};
use crate::error::{AppError, AppResult};
use crate::models::{LoginRequest, LoginResponse, User};
use crate::state::AppState;
use axum::extract::State;
use axum::{Json, Router};
use axum::routing::{get, post};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/login", post(login))
        .route("/me", get(me))
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    let user: Option<User> =
        sqlx::query_as("SELECT * FROM users WHERE email = $1 AND is_active = true")
            .bind(&req.email)
            .fetch_optional(&state.pool)
            .await?;

    let user = user.ok_or(AppError::Unauthorized)?;

    if !auth::verify_password(&req.password, &user.password_hash) {
        return Err(AppError::Unauthorized);
    }

    let token = auth::issue_token(
        &state.config.jwt_secret,
        state.config.jwt_expiry_hours,
        user.id,
        &user.email,
        &user.role,
    )
    .map_err(AppError::Other)?;

    Ok(Json(LoginResponse { token, user }))
}

async fn me(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<User>> {
    let u: User = sqlx::query_as("SELECT * FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(u))
}

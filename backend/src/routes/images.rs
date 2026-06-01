use crate::error::AppResult;
use crate::models::Image;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/summary", get(summary))
}

#[derive(Debug, Deserialize)]
pub struct ImageQuery {
    pub kind: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
}

async fn list(
    State(state): State<AppState>,
    Query(q): Query<ImageQuery>,
) -> AppResult<Json<Vec<Image>>> {
    let limit = q.limit.unwrap_or(500).clamp(1, 2000);
    let search = q
        .search
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", s.to_lowercase()));

    let images: Vec<Image> = sqlx::query_as(
        "SELECT * FROM images
         WHERE ($1::text IS NULL OR kind = $1)
           AND ($2::text IS NULL OR lower(coalesce(name,'')) LIKE $2)
         ORDER BY last_seen DESC
         LIMIT $3",
    )
    .bind(q.kind)
    .bind(search)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(images))
}

async fn summary(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT kind, COUNT(*)::bigint AS n FROM images GROUP BY kind")
            .fetch_all(&state.pool)
            .await?;

    let mut out = serde_json::Map::new();
    let mut total: i64 = 0;
    for (kind, n) in rows {
        total += n;
        out.insert(kind, json!(n));
    }
    out.insert("total".to_string(), json!(total));

    Ok(Json(Value::Object(out)))
}

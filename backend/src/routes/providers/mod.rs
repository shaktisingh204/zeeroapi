//! Per-provider API modules.
//!
//! Every provider gets its OWN file (melbet.rs, onexbet.rs for 1xbet, ...,
//! diamondexch.rs for d247) exposing its own endpoint set, mounted under its
//! slug — e.g. `/api/v1/melbet/live`, `/api/v1/diamondexch/headermatches`.
//!
//! The HTTP shape is shared (every provider answers the same REST verbs), so
//! the per-file routers delegate to the `*_core` handlers in `routes::v1` with
//! their slug bound. The DATA each returns is provider-native: sportsbooks give
//! a single price, exchanges (diamondexch / d247) add lay + volume + suspended.
//! Endpoints a provider does not list in its `capabilities` return a clean 400.

pub mod melbet;
pub mod onexbet; // 1xbet (module names can't start with a digit)
pub mod betwinner;
pub mod megapari;
pub mod onewin; // 1win
pub mod bcgame;
pub mod diamondexch; // d247

use crate::api_keys::ApiClient;
use crate::error::AppResult;
use crate::routes::v1;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::get;
use axum::{Json, Router};

/// Build one provider's full endpoint router. The `slug` is bound into every
/// handler; capability checks (and the native vs exchange data shape) happen in
/// the shared `v1::*_core` functions.
///
/// Endpoint flow (the canonical order):
///   1. GET /sports                 — sports + ids
///   2. GET /matches?sport_id=ID    — all matches for a sport (also status / search / paging)
///   3. GET /matches/:id            — match detail + all odds  (alias: /matchdetails/:id)
///   4. GET /leagues?sport_id=ID    — leagues
///   5. GET /sidebar                — full sports → leagues tree
///   plus /live, /featured, /headermatches, /results, /odds/:match_id
pub(crate) fn build(slug: &'static str) -> Router<AppState> {
    Router::new()
        .route(
            "/sports",
            get(move |State(s): State<AppState>, c: ApiClient| async move { v1::sports_core(&s, &c, slug).await }),
        )
        .route(
            "/matches",
            get(move |State(s): State<AppState>, c: ApiClient, Query(q): Query<v1::ListQuery>| async move {
                v1::matches_core(&s, &c, slug, q).await
            }),
        )
        .route(
            "/matches/:id",
            get(move |State(s): State<AppState>, c: ApiClient, Path(id): Path<i64>| async move {
                v1::match_detail_core(&s, &c, slug, id).await
            }),
        )
        .route(
            "/matchdetails/:id",
            get(move |State(s): State<AppState>, c: ApiClient, Path(id): Path<i64>| async move {
                v1::match_detail_core(&s, &c, slug, id).await
            }),
        )
        .route(
            "/leagues",
            get(move |State(s): State<AppState>, c: ApiClient, Query(q): Query<v1::ListQuery>| async move {
                v1::leagues_core(&s, &c, slug, q.sport_id).await
            }),
        )
        .route(
            "/sidebar",
            get(move |State(s): State<AppState>, c: ApiClient| async move { v1::sidebar_core(&s, &c, slug).await }),
        )
        .route(
            "/live",
            get(move |State(s): State<AppState>, c: ApiClient| async move { v1::live_core(&s, &c, slug).await }),
        )
        .route(
            "/featured",
            get(move |State(s): State<AppState>, c: ApiClient| async move { v1::featured_core(&s, &c, slug).await }),
        )
        .route(
            "/headermatches",
            get(move |State(s): State<AppState>, c: ApiClient| async move { v1::header_matches_core(&s, &c, slug).await }),
        )
        .route(
            "/results",
            get(move |State(s): State<AppState>, c: ApiClient| async move { v1::results_core(&s, &c, slug).await }),
        )
        .route(
            "/odds/:match_id",
            get(move |State(s): State<AppState>, c: ApiClient, Path(mid): Path<i64>| async move {
                v1::match_odds_core(&s, &c, slug, mid).await
            }),
        )
}

// Type hint so the closures' return type is unambiguous to the compiler when
// referenced as a free helper (kept minimal; the cores already return this).
#[allow(dead_code)]
type Resp<T> = AppResult<(HeaderMap, Json<T>)>;

/// Mount every provider's own router under its slug.
pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/melbet", melbet::router())
        .nest("/1xbet", onexbet::router())
        .nest("/betwinner", betwinner::router())
        .nest("/megapari", megapari::router())
        .nest("/1win", onewin::router())
        .nest("/bcgame", bcgame::router())
        .nest("/diamondexch", diamondexch::router())
        .nest("/d247", diamondexch::router()) // friendly alias for diamondexch
}

#[cfg(test)]
mod tests {
    /// Building the routers exercises matchit's conflict detection, so this
    /// catches any overlapping/ambiguous route registration at test time
    /// (a real router-build panic) rather than in production.
    #[test]
    fn routers_build_without_conflict() {
        let _ = super::router();
        let _ = crate::routes::v1::router();
    }
}

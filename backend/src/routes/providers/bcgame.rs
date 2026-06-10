//! BC.Game — sportsbook (BetBy / sptpub JSON). Mounted at /api/v1/bcgame.
//! Includes outrights (single-entity events) alongside two-team matches.
//!
//! Endpoints: /sports · /matches (?sport_id) · /matches/:id (alias /matchdetails/:id)
//! · /leagues · /sidebar · /live · /featured · /headermatches · /results · /odds/:match_id

use crate::state::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    super::build_sportsbook("bcgame")
}

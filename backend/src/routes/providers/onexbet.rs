//! 1xBet — sportsbook (1xbet-family). Mounted at /api/v1/1xbet.
//! Single decimal price per outcome; locked lines are flagged suspended.
//!
//! Endpoints: /sports · /matches (?sport_id) · /matches/:id (alias /matchdetails/:id)
//! · /leagues · /sidebar · /live · /featured · /headermatches · /results · /odds/:match_id

use crate::state::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    super::build_sportsbook("1xbet")
}

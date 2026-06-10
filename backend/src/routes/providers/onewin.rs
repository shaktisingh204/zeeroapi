//! 1Win — sportsbook (top-parser JSON feed). Mounted at /api/v1/1win.
//! Blocked outcomes are surfaced with suspended = true.
//!
//! Endpoints: /sports · /matches (?sport_id) · /matches/:id (alias /matchdetails/:id)
//! · /leagues · /sidebar · /live · /featured · /headermatches · /results · /odds/:match_id

use crate::state::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    super::build_sportsbook("1win")
}

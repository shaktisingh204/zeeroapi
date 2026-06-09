//! MelBet — sportsbook (1xbet-family JSON feeds, scraped natively in Rust).
//! Mounted at /api/v1/melbet. Single decimal price per outcome; full market tree.
//!
//! Endpoints: /sports · /matches (?sport_id) · /matches/:id (alias /matchdetails/:id)
//! · /leagues · /sidebar · /live · /featured · /headermatches · /results · /odds/:match_id

use crate::state::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    super::build("melbet")
}

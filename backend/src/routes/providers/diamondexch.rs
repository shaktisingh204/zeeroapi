//! Diamond Exch (d247) — betting EXCHANGE. Mounted at /api/v1/diamondexch
//! (and the alias /api/v1/d247). Exchange-native data: each odd carries a back
//! `value`, a `lay` price and matched `volume`, and locked markets/runners are
//! flagged `suspended`. Racing/outright events use the event name as home_team
//! with an empty away_team; their runners are the odds outcomes.
//!
//! Endpoint flow:
//!   1. GET /sports                — sports + ids
//!   2. GET /matches?sport_id=ID   — all matches/events for that sport
//!   3. GET /matchdetails/:id      — full detail + all odds (alias of /matches/:id)
//!   4. GET /leagues?sport_id=ID   — leagues
//!   5. GET /sidebar               — full sports → leagues tree
//!   plus /live · /featured · /headermatches · /results · /odds/:match_id

use crate::state::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    super::build("diamondexch")
}

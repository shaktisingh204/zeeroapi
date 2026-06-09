use rust_decimal::Decimal;

/// A sport as returned by the provider feed (normalized).
#[derive(Debug, Clone)]
pub struct ScrapedSport {
    pub id: i64,
    pub name: String,
    pub match_count: i32,
}

/// A normalized odd (one market line) attached to a match.
#[derive(Debug, Clone)]
pub struct ScrapedOdd {
    pub group_id: i64,   // provider market group (G)
    pub type_code: i64,  // provider outcome type (T)
    pub market: String,  // human label for the group (best-effort)
    pub outcome: String, // human label for the outcome (best-effort)
    pub value: Decimal,  // decimal coefficient (C)
    pub param: Option<Decimal>, // line param (P) — total/handicap value
}

/// A normalized match/event with its odds.
#[derive(Debug, Clone)]
pub struct ScrapedMatch {
    pub id: i64,
    pub sport_id: i64,
    pub sport_name: String,
    pub league_id: Option<i64>,
    pub league_name: Option<String>,
    pub country: Option<String>,
    pub home_team: String,
    pub away_team: String,
    pub start_time: Option<i64>, // unix seconds
    pub is_live: bool,
    pub home_score: Option<i32>,
    pub away_score: Option<i32>,
    pub period: Option<String>,
    pub match_time: Option<String>,
    pub suspended: bool,
    pub odds: Vec<ScrapedOdd>,
}

/// Result of a scrape pass, returned to the scheduler / API for logging.
#[derive(Debug, Default, Clone)]
pub struct ScrapeOutcome {
    pub matches: usize,
    pub odds: usize,
}

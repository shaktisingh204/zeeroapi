//! ZeroApi public API v1 — provider-scoped. Every data endpoint lives under
//! `/api/v1/{provider}/...`; each provider exposes only the endpoints in its
//! `capabilities`, and returns its own scraped data. Auth is via the
//! `ApiClient` extractor (X-API-Key) which also enforces plan rate-limit/quota.
//! `/openapi.json` and `/docs` are public.

use crate::api_keys::ApiClient;
use crate::error::{AppError, AppResult};
use crate::models::{MatchView, Odd, Plan, Provider, Sport};
use crate::state::AppState;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::Html;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/openapi.json", get(openapi))
        .route("/docs", get(docs))
        .route("/providers", get(providers))
        // Every data endpoint is STATIC per provider: each provider has its own
        // module + routes mounted under its slug (src/routes/providers/<slug>.rs).
        // e.g. /api/v1/melbet/live, /api/v1/diamondexch/headermatches. There is no
        // dynamic ?provider= form.
        .merge(crate::routes::providers::router())
        // Helpful JSON for anything else under /api/v1/* (instead of an empty 404).
        .fallback(v1_fallback)
}

async fn v1_fallback() -> AppResult<Json<Value>> {
    Err(AppError::BadRequest(
        "unknown endpoint. Use /api/v1/{provider}/{sports|matches|matches/:id|leagues|sidebar|live|\
         featured|headermatches|results|odds/:id|markets/:id}. See /api/v1/docs."
            .into(),
    ))
}

fn rate_headers(c: &ApiClient) -> HeaderMap {
    let mut h = HeaderMap::new();
    // Report whichever window is actually enforced (per-second overrides per-minute).
    let (limit, window) = match c.plan.rate_limit_per_sec {
        Some(per_sec) if per_sec > 0 => (per_sec, "1"),
        _ => (c.plan.rate_limit_per_min, "60"),
    };
    if let Ok(v) = limit.to_string().parse() {
        h.insert("x-ratelimit-limit", v);
    }
    if let Ok(v) = window.parse() {
        h.insert("x-ratelimit-window-seconds", v);
    }
    if let Ok(v) = c.remaining.to_string().parse() {
        h.insert("x-ratelimit-remaining", v);
    }
    h
}

/// Ensure the provider exists, is active, and exposes `resource`.
async fn require_capability(state: &AppState, provider: &str, resource: &str) -> AppResult<()> {
    let row: Option<(bool, Value)> =
        sqlx::query_as("SELECT is_active, capabilities FROM providers WHERE slug = $1")
            .bind(provider)
            .fetch_optional(&state.pool)
            .await?;
    match row {
        None => Err(AppError::NotFound),
        Some((false, _)) => Err(AppError::BadRequest(format!(
            "provider '{provider}' is not active"
        ))),
        Some((true, caps)) => {
            let has = caps
                .as_array()
                .map(|a| a.iter().any(|c| c.as_str() == Some(resource)))
                .unwrap_or(false);
            if has {
                Ok(())
            } else {
                Err(AppError::BadRequest(format!(
                    "endpoint '{resource}' is not available for provider '{provider}'"
                )))
            }
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub sport_id: Option<i64>,
    pub league_id: Option<i64>,
    pub status: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

async fn providers(
    State(state): State<AppState>,
    client: ApiClient,
) -> AppResult<(HeaderMap, Json<Vec<Provider>>)> {
    let rows: Vec<Provider> =
        sqlx::query_as("SELECT * FROM providers WHERE is_active ORDER BY name")
            .fetch_all(&state.pool)
            .await?;
    Ok((rate_headers(&client), Json(rows)))
}

// ---- sports ----
pub(crate) async fn sports_core(state: &AppState, client: &ApiClient, provider: &str)
    -> AppResult<(HeaderMap, Json<Vec<Sport>>)> {
    require_capability(state, provider, "sports").await?;
    let rows: Vec<Sport> = sqlx::query_as(
        "SELECT * FROM sports WHERE provider = $1 ORDER BY match_count DESC, name ASC LIMIT 500",
    )
    .bind(provider)
    .fetch_all(&state.pool)
    .await?;
    Ok((rate_headers(client), Json(rows)))
}
// ---- leagues ----
pub(crate) async fn leagues_core(state: &AppState, client: &ApiClient, provider: &str, sport_id: Option<i64>)
    -> AppResult<(HeaderMap, Json<Vec<Value>>)> {
    require_capability(state, provider, "leagues").await?;
    let rows: Vec<(i64, i64, String, String, Option<String>, i64)> = sqlx::query_as(
        "SELECT l.id, l.sport_id, s.name AS sport_name, l.name, l.country, COUNT(m.id) AS match_count
         FROM leagues l JOIN sports s ON s.id = l.sport_id
         LEFT JOIN matches m ON m.league_id = l.id
         WHERE l.provider = $1 AND ($2::bigint IS NULL OR l.sport_id = $2)
         GROUP BY l.id, s.name ORDER BY match_count DESC, l.name ASC LIMIT 500",
    )
    .bind(provider)
    .bind(sport_id)
    .fetch_all(&state.pool)
    .await?;
    let out = rows
        .into_iter()
        .map(|(id, sport_id, sport_name, name, country, match_count)| {
            json!({ "id": id, "sport_id": sport_id, "sport_name": sport_name,
                    "name": name, "country": country, "match_count": match_count })
        })
        .collect();
    Ok((rate_headers(client), Json(out)))
}
// ---- sidebar (full sports tree: sports each with their nested leagues) ----
pub(crate) async fn sidebar_core(state: &AppState, client: &ApiClient, provider: &str)
    -> AppResult<(HeaderMap, Json<Vec<Value>>)> {
    require_capability(state, provider, "sports").await?;
    let sports: Vec<(i64, String, String, i32, Option<String>)> = sqlx::query_as(
        "SELECT id, name, slug, match_count, logo_url FROM sports WHERE provider = $1
         ORDER BY match_count DESC, name ASC LIMIT 500",
    )
    .bind(provider)
    .fetch_all(&state.pool)
    .await?;
    let leagues: Vec<(i64, i64, String, Option<String>, i64)> = sqlx::query_as(
        "SELECT l.sport_id, l.id, l.name, l.country, COUNT(m.id) AS match_count
         FROM leagues l LEFT JOIN matches m ON m.league_id = l.id
         WHERE l.provider = $1
         GROUP BY l.id ORDER BY match_count DESC, l.name ASC",
    )
    .bind(provider)
    .fetch_all(&state.pool)
    .await?;

    let mut by_sport: std::collections::HashMap<i64, Vec<Value>> = std::collections::HashMap::new();
    for (sport_id, id, name, country, match_count) in leagues {
        by_sport.entry(sport_id).or_default().push(
            json!({ "id": id, "name": name, "country": country, "match_count": match_count }),
        );
    }
    let out: Vec<Value> = sports
        .into_iter()
        .map(|(id, name, slug, match_count, logo_url)| {
            json!({
                "id": id, "name": name, "slug": slug,
                "match_count": match_count, "logo_url": logo_url,
                "leagues": by_sport.remove(&id).unwrap_or_default()
            })
        })
        .collect();
    Ok((rate_headers(client), Json(out)))
}
const MATCH_SELECT: &str = "
    SELECT m.id, m.provider, m.sport_id, s.name AS sport_name, m.league_id, l.name AS league_name,
           m.home_team, m.away_team, m.home_logo, m.away_logo, m.start_time, m.status,
           m.home_score, m.away_score, m.period, m.match_time, m.result, m.finished_at,
           m.suspended, m.featured, m.header, m.updated_at
    FROM matches m JOIN sports s ON s.id = m.sport_id LEFT JOIN leagues l ON l.id = m.league_id";

// ---- matches (list) ----
pub(crate) async fn matches_core(state: &AppState, client: &ApiClient, provider: &str, q: ListQuery)
    -> AppResult<(HeaderMap, Json<Vec<MatchView>>)> {
    require_capability(state, provider, "matches").await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    let search = q.search.map(|s| format!("%{}%", s.to_lowercase()));
    let sql = format!(
        "{MATCH_SELECT}
         WHERE m.provider = $1
           AND ($2::text IS NULL OR m.status = $2)
           AND ($3::bigint IS NULL OR m.sport_id = $3)
           AND ($4::bigint IS NULL OR m.league_id = $4)
           AND ($5::text IS NULL OR lower(m.home_team) LIKE $5 OR lower(m.away_team) LIKE $5)
         ORDER BY (m.status = 'live') DESC, m.start_time ASC NULLS LAST
         LIMIT $6 OFFSET $7"
    );
    let rows: Vec<MatchView> = sqlx::query_as(&sql)
        .bind(provider)
        .bind(&q.status)
        .bind(q.sport_id)
        .bind(q.league_id)
        .bind(search)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;
    Ok((rate_headers(client), Json(rows)))
}
// ---- match detail ----
pub(crate) async fn match_detail_core(state: &AppState, client: &ApiClient, provider: &str, id: i64)
    -> AppResult<(HeaderMap, Json<Value>)> {
    require_capability(state, provider, "matches").await?;
    let sql = format!("{MATCH_SELECT} WHERE m.provider = $1 AND m.id = $2");
    let m: Option<MatchView> = sqlx::query_as(&sql)
        .bind(provider)
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let m = m.ok_or(AppError::NotFound)?;
    let odds: Vec<Odd> =
        sqlx::query_as("SELECT * FROM odds WHERE match_id = $1 ORDER BY market, outcome")
            .bind(id)
            .fetch_all(&state.pool)
            .await?;
    let mut body = serde_json::to_value(&m).unwrap_or_else(|_| json!({}));
    body["odds"] = serde_json::to_value(odds).unwrap_or_else(|_| json!([]));
    Ok((rate_headers(client), Json(body)))
}
// ---- live ----
pub(crate) async fn live_core(state: &AppState, client: &ApiClient, provider: &str)
    -> AppResult<(HeaderMap, Json<Vec<MatchView>>)> {
    require_capability(state, provider, "live").await?;
    let sql = format!(
        "{MATCH_SELECT} WHERE m.provider = $1 AND m.status = 'live' ORDER BY m.updated_at DESC LIMIT 500"
    );
    let rows: Vec<MatchView> = sqlx::query_as(&sql)
        .bind(provider)
        .fetch_all(&state.pool)
        .await?;
    Ok((rate_headers(client), Json(rows)))
}
// ---- featured (the provider's promoted "highlights" strip) ----
pub(crate) async fn featured_core(state: &AppState, client: &ApiClient, provider: &str)
    -> AppResult<(HeaderMap, Json<Vec<MatchView>>)> {
    require_capability(state, provider, "matches").await?;
    // Promoted events that are still relevant (not finished), live first.
    let sql = format!(
        "{MATCH_SELECT} WHERE m.provider = $1 AND m.featured = true AND m.status <> 'finished'
         ORDER BY (m.status = 'live') DESC, m.updated_at DESC LIMIT 100"
    );
    let rows: Vec<MatchView> = sqlx::query_as(&sql)
        .bind(provider)
        .fetch_all(&state.pool)
        .await?;
    Ok((rate_headers(client), Json(rows)))
}
// ---- header matches (the provider's header match strip) ----
pub(crate) async fn header_matches_core(state: &AppState, client: &ApiClient, provider: &str)
    -> AppResult<(HeaderMap, Json<Vec<MatchView>>)> {
    require_capability(state, provider, "matches").await?;
    let sql = format!(
        "{MATCH_SELECT} WHERE m.provider = $1 AND m.header = true AND m.status <> 'finished'
         ORDER BY (m.status = 'live') DESC, m.start_time ASC NULLS LAST LIMIT 200"
    );
    let rows: Vec<MatchView> = sqlx::query_as(&sql)
        .bind(provider)
        .fetch_all(&state.pool)
        .await?;
    Ok((rate_headers(client), Json(rows)))
}
// ---- results (finished matches with derived winners) ----
pub(crate) async fn results_core(state: &AppState, client: &ApiClient, provider: &str)
    -> AppResult<(HeaderMap, Json<Vec<MatchView>>)> {
    require_capability(state, provider, "matches").await?;
    let sql = format!(
        "{MATCH_SELECT} WHERE m.provider = $1 AND m.status = 'finished' AND m.finished_at IS NOT NULL
         ORDER BY m.finished_at DESC LIMIT 300"
    );
    let rows: Vec<MatchView> = sqlx::query_as(&sql)
        .bind(provider)
        .fetch_all(&state.pool)
        .await?;
    Ok((rate_headers(client), Json(rows)))
}
// ---- match odds ----
pub(crate) async fn match_odds_core(state: &AppState, client: &ApiClient, provider: &str, match_id: i64)
    -> AppResult<(HeaderMap, Json<Vec<Odd>>)> {
    require_capability(state, provider, "odds").await?;
    let odds: Vec<Odd> = sqlx::query_as(
        "SELECT o.* FROM odds o JOIN matches m ON m.id = o.match_id
         WHERE o.match_id = $1 AND m.provider = $2 ORDER BY o.market, o.outcome",
    )
    .bind(match_id)
    .bind(provider)
    .fetch_all(&state.pool)
    .await?;
    Ok((rate_headers(client), Json(odds)))
}
// ---- markets for a match: odds GROUPED by market (shared; exchange shows
//      back/lay/volume, sportsbook shows price/line). ----
pub(crate) async fn markets_core(state: &AppState, client: &ApiClient, provider: &str, match_id: i64)
    -> AppResult<(HeaderMap, Json<Value>)> {
    require_capability(state, provider, "odds").await?;
    let odds: Vec<Odd> = sqlx::query_as(
        "SELECT o.* FROM odds o JOIN matches m ON m.id = o.match_id
         WHERE o.match_id = $1 AND m.provider = $2 ORDER BY o.market, o.outcome",
    )
    .bind(match_id)
    .bind(provider)
    .fetch_all(&state.pool)
    .await?;

    // Group by market, preserving first-seen order.
    let mut order: Vec<String> = Vec::new();
    let mut groups: std::collections::HashMap<String, Vec<Value>> = std::collections::HashMap::new();
    let mut all_susp: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    for o in &odds {
        if !groups.contains_key(&o.market) {
            order.push(o.market.clone());
        }
        groups.entry(o.market.clone()).or_default().push(json!({
            "outcome": o.outcome, "value": o.value, "lay": o.lay,
            "volume": o.volume, "param": o.param, "suspended": o.suspended,
        }));
        let e = all_susp.entry(o.market.clone()).or_insert(true);
        *e = *e && o.suspended; // market is suspended only when every outcome is
    }
    let markets: Vec<Value> = order
        .into_iter()
        .map(|m| {
            let outcomes = groups.remove(&m).unwrap_or_default();
            let suspended = all_susp.get(&m).copied().unwrap_or(false);
            json!({ "market": m, "suspended": suspended, "outcomes": outcomes })
        })
        .collect();
    Ok((rate_headers(client), Json(json!({ "match_id": match_id, "markets": markets }))))
}
// ---- prematch (sportsbook-native): scheduled matches only ----
pub(crate) async fn prematch_core(state: &AppState, client: &ApiClient, provider: &str)
    -> AppResult<(HeaderMap, Json<Vec<MatchView>>)> {
    require_capability(state, provider, "matches").await?;
    let sql = format!(
        "{MATCH_SELECT} WHERE m.provider = $1 AND m.status = 'prematch'
         ORDER BY m.start_time ASC NULLS LAST LIMIT 500"
    );
    let rows: Vec<MatchView> = sqlx::query_as(&sql).bind(provider).fetch_all(&state.pool).await?;
    Ok((rate_headers(client), Json(rows)))
}
// ---- market groups (sportsbook-native): the market tree this provider offers ----
pub(crate) async fn marketgroups_core(state: &AppState, client: &ApiClient, provider: &str)
    -> AppResult<(HeaderMap, Json<Vec<Value>>)> {
    require_capability(state, provider, "odds").await?;
    let rows: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT market, COUNT(*)::bigint AS lines, COUNT(DISTINCT match_id)::bigint AS matches
         FROM odds WHERE provider = $1 GROUP BY market ORDER BY matches DESC, market ASC LIMIT 300",
    )
    .bind(provider)
    .fetch_all(&state.pool)
    .await?;
    let out = rows
        .into_iter()
        .map(|(market, lines, matches)| json!({ "market": market, "lines": lines, "matches": matches }))
        .collect();
    Ok((rate_headers(client), Json(out)))
}
// ---------------- OpenAPI (per-provider, with examples) ----------------

async fn openapi(State(state): State<AppState>) -> Json<Value> {
    let provs: Vec<Provider> = sqlx::query_as("SELECT * FROM providers ORDER BY is_active DESC, name")
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();
    let plans: Vec<Plan> = sqlx::query_as("SELECT * FROM plans ORDER BY sort_order")
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();

    // Example payloads shown in the docs.
    let sport_ex = json!([{ "id": 4471626188_i64, "name": "Football", "slug": "football",
        "match_count": 92, "logo_url": null, "provider": "melbet" }]);
    let match_ex = json!([{ "id": 2267604396_i64, "provider": "melbet", "sport_name": "Football",
        "league_name": "UEFA Champions League", "home_team": "Paris Saint-Germain",
        "away_team": "Arsenal", "home_logo": "https://v3.traincdn.com/sfiles/logo_teams/12709.webp",
        "status": "live", "home_score": 1, "away_score": 1, "match_time": "72'",
        "suspended": false, "updated_at": "2026-05-31T12:00:00Z" }]);
    let odds_ex = json!([
        { "market": "Match Result", "outcome": "W1", "value": "3.88", "suspended": false, "provider": "melbet" },
        { "market": "Total", "outcome": "Over", "value": "1.85", "param": "2.5", "suspended": false, "provider": "melbet" },
        { "market": "Double Chance", "outcome": "1X", "value": "1.30", "suspended": false, "provider": "melbet" }
    ]);
    // Exchange providers (e.g. d247 / diamondexch) quote BACK + LAY with matched
    // VOLUME and suspend (padlock) markets in-play. Their docs show that shape.
    let exch_match_ex = json!([{ "id": 884213, "provider": "diamondexch", "sport_name": "Cricket",
        "league_name": "Indian Premier League", "home_team": "Mumbai Indians",
        "away_team": "Chennai Super Kings", "status": "live", "home_score": null, "away_score": null,
        "match_time": "MI 142/3 (15.3)", "suspended": false, "updated_at": "2026-06-09T14:00:00Z" }]);
    let exch_odds_ex = json!([
        { "market": "Match Odds", "outcome": "Mumbai Indians", "value": "1.85", "lay": "1.87", "volume": "240310.00", "suspended": false, "provider": "diamondexch" },
        { "market": "Match Odds", "outcome": "Chennai Super Kings", "value": "2.12", "lay": "2.16", "volume": "198450.00", "suspended": false, "provider": "diamondexch" },
        { "market": "Bookmaker", "outcome": "Mumbai Indians", "value": "78", "lay": "82", "suspended": true, "provider": "diamondexch" },
        { "market": "Winner", "outcome": "Mumbai Indians", "value": "3.40", "lay": "3.55", "suspended": false, "provider": "diamondexch" }
    ]);
    let provider_ex = json!([{ "slug": "melbet", "name": "MelBet",
        "capabilities": ["sports","leagues","matches","live","odds","full_markets"], "is_active": true }]);

    let resp = |desc: &str, example: &Value| json!({
        "description": desc,
        "content": { "application/json": { "example": example } }
    });

    let mut paths = serde_json::Map::new();
    paths.insert(
        "/providers".into(),
        json!({"get": {"tags": ["meta"], "summary": "List active providers",
            "responses": {"200": resp("Active providers", &provider_ex)}}}),
    );

    // Generate concrete per-provider paths so the docs show each provider's
    // actual (different) endpoint set.
    for p in &provs {
        let caps: Vec<String> = p
            .capabilities
            .as_array()
            .map(|a| a.iter().filter_map(|c| c.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let tag = format!("{} ({})", p.name, if p.is_active { "active" } else { "disabled" });
        let pv = &p.slug;
        // Exchanges expose a different native data shape (back/lay/volume/suspended)
        // than sportsbooks (single price). Document each provider with its own shape.
        let is_exchange = pv == "diamondexch" || caps.iter().any(|c| c == "exchange");
        let m_ex = if is_exchange { &exch_match_ex } else { &match_ex };
        let o_ex = if is_exchange { &exch_odds_ex } else { &odds_ex };
        let odds_note = if is_exchange { "odds (back, lay, volume, suspended)" } else { "odds" };

        // Exchange (d247): EXACTLY 6 endpoints — odds are returned inside
        // /matchdetails/:id, so there is no separate odds/markets/live endpoint.
        if is_exchange {
            paths.insert(format!("/{pv}/sports"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — sports + ids", p.name),
                "responses": {"200": resp("Sports list", &sport_ex)}}}));
            paths.insert(format!("/{pv}/matches"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — matches for a sport", p.name),
                "parameters":[
                    {"name":"sport_id","in":"query","schema":{"type":"integer"}},
                    {"name":"status","in":"query","schema":{"type":"string","enum":["live","prematch","finished"]}},
                    {"name":"limit","in":"query","schema":{"type":"integer","default":50}},
                    {"name":"offset","in":"query","schema":{"type":"integer","default":0}}],
                "responses": {"200": resp("Matches", m_ex)}}}));
            paths.insert(format!("/{pv}/matchdetails/{{id}}"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — match detail + all odds (back/lay/volume/suspended)", p.name),
                "parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"integer"}}],
                "responses": {"200": resp("Match with odds",
                    &json!({"id":m_ex[0]["id"],"home_team":m_ex[0]["home_team"],"away_team":m_ex[0]["away_team"],
                        "status":"live","suspended":false,"odds":o_ex})),
                    "404": {"description":"Not found"}}}}));
            paths.insert(format!("/{pv}/leagues"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — leagues", p.name),
                "parameters":[{"name":"sport_id","in":"query","schema":{"type":"integer"}}],
                "responses": {"200": resp("Leagues list",
                    &json!([{"id":2542291,"name":"Indian Premier League","sport_name":"Cricket","country":"India","match_count":10}]))}}}));
            paths.insert(format!("/{pv}/sidebar"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — full sports tree", p.name),
                "responses": {"200": resp("Sports with nested leagues",
                    &json!([{"id":4471626188_i64,"name":"Cricket","slug":"cricket","match_count":12,
                        "leagues":[{"id":2542291,"name":"Indian Premier League","country":"India","match_count":10}]}]))}}}));
            paths.insert(format!("/{pv}/headermatches"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — header match strip", p.name),
                "responses": {"200": resp("Matches in the header strip", m_ex)}}}));
            continue;
        }

        if caps.iter().any(|c| c == "sports") {
            paths.insert(format!("/{pv}/sports"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — sports", p.name),
                "responses": {"200": resp("Sports list", &sport_ex)}}}));
        }
        if caps.iter().any(|c| c == "leagues") {
            paths.insert(format!("/{pv}/leagues"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — leagues", p.name),
                "parameters":[{"name":"sport_id","in":"query","schema":{"type":"integer"}}],
                "responses": {"200": resp("Leagues list",
                    &json!([{"id":2542291,"name":"Indian Premier League","sport_name":"Cricket","country":"India","match_count":10}]))}}}));
        }
        if caps.iter().any(|c| c == "sports") {
            paths.insert(format!("/{pv}/sidebar"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — sidebar (sports with nested leagues)", p.name),
                "responses": {"200": resp("Full \"All Sports\" tree",
                    &json!([{"id":4471626188_i64,"name":"Cricket","slug":"cricket","match_count":12,"logo_url":null,
                        "leagues":[{"id":2542291,"name":"Indian Premier League","country":"India","match_count":10}]}]))}}}));
        }
        if caps.iter().any(|c| c == "matches") {
            paths.insert(format!("/{pv}/matches"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — matches", p.name),
                "parameters":[
                    {"name":"status","in":"query","schema":{"type":"string","enum":["live","prematch","finished"]}},
                    {"name":"sport_id","in":"query","schema":{"type":"integer"}},
                    {"name":"league_id","in":"query","schema":{"type":"integer"}},
                    {"name":"search","in":"query","schema":{"type":"string"}},
                    {"name":"limit","in":"query","schema":{"type":"integer","default":50}},
                    {"name":"offset","in":"query","schema":{"type":"integer","default":0}}],
                "responses": {"200": resp("Matches", m_ex)}}}));
            let detail_doc = json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — match detail + {}", p.name, odds_note),
                "parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"integer"}}],
                "responses": {"200": resp("Match with odds",
                    &json!({"id":m_ex[0]["id"],"home_team":m_ex[0]["home_team"],"away_team":m_ex[0]["away_team"],
                        "status":"live","suspended":false,"odds":o_ex})),
                    "404": {"description":"Not found"}}}});
            paths.insert(format!("/{pv}/matches/{{id}}"), detail_doc.clone());
            // Alias: same handler, friendlier name.
            paths.insert(format!("/{pv}/matchdetails/{{id}}"), detail_doc);
        }
        if caps.iter().any(|c| c == "live") {
            paths.insert(format!("/{pv}/live"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — live matches", p.name),
                "responses": {"200": resp("Live matches", m_ex)}}}));
        }
        if caps.iter().any(|c| c == "matches") {
            paths.insert(format!("/{pv}/featured"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — featured / highlighted events (promoted strip)", p.name),
                "responses": {"200": resp("Featured events (matches, outrights and special markets)", m_ex)}}}));
            paths.insert(format!("/{pv}/headermatches"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — header match strip", p.name),
                "responses": {"200": resp("Matches shown in the provider's header strip", m_ex)}}}));
        }
        if caps.iter().any(|c| c == "odds") {
            paths.insert(format!("/{pv}/odds/{{match_id}}"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — flat {}", p.name, odds_note),
                "parameters":[{"name":"match_id","in":"path","required":true,"schema":{"type":"integer"}}],
                "responses": {"200": resp("Odds", o_ex)}}}));
            // Shared: odds grouped by market.
            paths.insert(format!("/{pv}/markets/{{match_id}}"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — markets (odds grouped by market)", p.name),
                "parameters":[{"name":"match_id","in":"path","required":true,"schema":{"type":"integer"}}],
                "responses": {"200": resp("Markets with their outcomes",
                    &json!({"match_id": m_ex[0]["id"], "markets":[{"market": o_ex[0]["market"], "suspended": false, "outcomes": o_ex}]}))}}}));
        }
        // Kind-specific endpoints: exchanges and sportsbooks differ.
        if is_exchange {
            paths.insert(format!("/{pv}/suspended"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — suspended feed (events locked in-play now)", p.name),
                "responses": {"200": resp("Currently-suspended events", m_ex)}}}));
        } else if caps.iter().any(|c| c == "matches") {
            paths.insert(format!("/{pv}/prematch"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — prematch (scheduled) matches", p.name),
                "responses": {"200": resp("Scheduled matches", m_ex)}}}));
            paths.insert(format!("/{pv}/marketgroups"), json!({"get": {"tags":[tag.clone()],
                "summary": format!("{} — market groups this provider offers", p.name),
                "responses": {"200": resp("Market group tree",
                    &json!([{"market":"1x2","lines":1240,"matches":410},{"market":"Total","lines":3180,"matches":402}]))}}}));
        }
    }

    let plan_desc = plans.iter().map(|p| format!("{} — {}/min, {}",
        p.name, p.rate_limit_per_min,
        if p.monthly_quota < 0 { "unlimited".into() } else { format!("{}/mo", p.monthly_quota) }))
        .collect::<Vec<_>>().join(" · ");

    Json(json!({
      "openapi": "3.0.3",
      "info": {
        "title": "ZeroApi — Sports Data API",
        "version": "1.0.0",
        "description": format!("Real-time sports, matches, odds & live scores across multiple bookmaker providers.\n\n**Provider-based:** every endpoint is namespaced under `/api/v1/{{provider}}/…`, and each provider exposes its own endpoint set and its own native data shape.\n\n**Sportsbooks** (melbet, 1xbet, betwinner, megapari, 1win, bcgame) quote a single decimal `value` per outcome. **Exchanges** (d247 / diamondexch) quote a best-`value` (back), a `lay` price and matched `volume`. Any line or whole match that is locked in-play carries `suspended: true` (match-level and per-odd).\n\n**Plans:** {plan_desc}\n\nAuthenticate with the `X-API-Key` header (get a key in your ZeroApi dashboard).")
      },
      "servers": [{"url": "/api/v1"}],
      "security": [{"ApiKeyAuth": []}],
      "components": {"securitySchemes": {"ApiKeyAuth": {"type": "apiKey", "in": "header", "name": "X-API-Key"}}},
      "paths": Value::Object(paths)
    }))
}

async fn docs() -> Html<&'static str> {
    Html(DOCS_HTML)
}

// Swagger UI themed dark to match the ZeroApi dashboard.
const DOCS_HTML: &str = r##"<!DOCTYPE html>
<html lang="en"><head>
<title>ZeroApi — API Reference</title>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0e14; }
  .topbar { background:#131722; border-bottom:1px solid #262d3d; padding:16px 24px; display:flex; align-items:center; gap:12px; }
  .topbar .logo { width:30px;height:30px;border-radius:8px;background:#22c55e;display:flex;align-items:center;justify-content:center;color:#000;font-weight:700; }
  .topbar h1 { color:#fff; font:600 18px/1 system-ui,sans-serif; margin:0; }
  .topbar span { color:#8b93a7; font:13px system-ui,sans-serif; }
  /* Swagger dark theme overrides */
  .swagger-ui, .swagger-ui .info .title, .swagger-ui .opblock-tag,
  .swagger-ui .opblock .opblock-summary-operation-id,
  .swagger-ui .opblock .opblock-summary-description,
  .swagger-ui .opblock .opblock-summary-path,
  .swagger-ui .parameter__name, .swagger-ui table thead tr td,
  .swagger-ui table thead tr th, .swagger-ui .response-col_status,
  .swagger-ui .col_header, .swagger-ui label, .swagger-ui .tab li,
  .swagger-ui .info li, .swagger-ui .info p, .swagger-ui .info table { color:#e6e9ef !important; }
  .swagger-ui .scheme-container, .swagger-ui section.models, .swagger-ui .opblock .opblock-section-header { background:#131722 !important; box-shadow:none; border-color:#262d3d; }
  .swagger-ui .opblock-tag { border-bottom:1px solid #262d3d; }
  .swagger-ui .opblock { background:#131722; border:1px solid #262d3d; box-shadow:none; border-radius:10px; margin:0 0 12px; }
  .swagger-ui .opblock .opblock-summary { border-color:#262d3d; }
  .swagger-ui .opblock.opblock-get .opblock-summary-method { background:#22c55e; }
  .swagger-ui .opblock.opblock-get { border-color:#22c55e44; background:#0f1f17; }
  .swagger-ui .btn { color:#e6e9ef; border-color:#3a4358; }
  .swagger-ui input, .swagger-ui textarea, .swagger-ui select { background:#1c2230 !important; color:#e6e9ef !important; border:1px solid #262d3d !important; }
  .swagger-ui .highlight-code, .swagger-ui .microlight, .swagger-ui .responses-inner pre, .swagger-ui .body-param pre { background:#0b0e14 !important; }
  .swagger-ui .markdown code, .swagger-ui .renderedMarkdown code { background:#1c2230; color:#22c55e; }
  .swagger-ui svg { fill:#8b93a7; }
  .swagger-ui .topbar { display:none; }
</style>
</head><body>
<div class="topbar"><div class="logo">Z</div><h1>ZeroApi</h1><span>Sports Data API · provider-based · <b>v1</b> (stable)</span>
<a href="http://localhost:3000/changelog" style="margin-left:auto;color:#22c55e;font:13px system-ui,sans-serif;text-decoration:none">Changelog ↗</a>
<a href="http://localhost:3000/status" style="margin-left:16px;color:#8b93a7;font:13px system-ui,sans-serif;text-decoration:none">Status ↗</a></div>
<div id="swagger"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
SwaggerUIBundle({ url: "/api/v1/openapi.json", dom_id: "#swagger",
  docExpansion: "list", defaultModelsExpandDepth: -1, tryItOutEnabled: true });
</script>
</body></html>"##;

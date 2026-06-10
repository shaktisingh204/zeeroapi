//! Ingest endpoint for externally-scraped data (the Python Playwright page
//! scraper). The page scraper renders melbet's SPA in a real browser, so the
//! odds arrive with their **real human names** already resolved — we just
//! upsert them. Authenticated with a shared `X-Ingest-Key` header.

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new().route("/snapshot", post(snapshot))
}

#[derive(Debug, Deserialize)]
pub struct Snapshot {
    pub source: String,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub matches: Vec<IngestMatch>,
    /// Optional full sidebar/catalog: sports (each with their leagues) that the
    /// scraper saw, independent of whether any have live matches right now. This
    /// lets the provider expose its complete "All Sports" tree even for sports
    /// with zero current matches.
    #[serde(default)]
    pub sports: Vec<IngestSportNode>,
    /// When true, clear every `featured` flag for this provider before applying
    /// the snapshot. The featured scraper sets this so the promoted strip is
    /// authoritative each pass (rotated-out events stop being featured).
    #[serde(default)]
    pub clear_featured: bool,
    /// Match ids (provider ext_ids) to mark `featured = true`. Lets the featured
    /// scraper flag events that already exist (from the normal sweeps) by id,
    /// without needing to re-send their full row or guess their sport.
    #[serde(default)]
    pub featured_ids: Vec<i64>,
    /// Same as `clear_featured`, for the header match strip.
    #[serde(default)]
    pub clear_header: bool,
    /// Same as `featured_ids`, for the header match strip.
    #[serde(default)]
    pub header_ids: Vec<i64>,
    /// When true, this snapshot is the COMPLETE current set for the sports it
    /// contains. After upserting, any earlier match in those same sports that is
    /// NOT in this snapshot is marked `dead` (and dropped from API responses).
    /// Set this only on a full list sweep, never on a partial/detail snapshot.
    #[serde(default)]
    pub sweep: bool,
    /// Grace period (seconds) for the dead-sweep. When > 0, a match missing from
    /// this snapshot is retired only if it has not been re-scraped for at least
    /// this long — so a single missed/incomplete pass does NOT drop a match that
    /// is still listed on the source site (it keeps being re-upserted with a
    /// fresh updated_at). 0 (default) = retire immediately, the old behavior.
    /// Scrapers whose list is scroll-virtualized (d247) set this to ride out
    /// passes that only captured part of the list.
    #[serde(default)]
    pub sweep_grace_seconds: i64,
}

fn default_provider() -> String {
    "melbet".to_string()
}

#[derive(Debug, Deserialize)]
pub struct IngestSportNode {
    pub name: String,
    pub logo: Option<String>,
    #[serde(default)]
    pub leagues: Vec<IngestLeagueNode>,
}

#[derive(Debug, Deserialize)]
pub struct IngestLeagueNode {
    pub name: String,
    pub country: Option<String>,
    pub logo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IngestMatch {
    pub ext_id: Option<i64>,
    pub sport: String,
    pub league: Option<String>,
    pub home: String,
    pub away: String,
    #[serde(default = "default_status")]
    pub status: String,
    pub home_score: Option<i32>,
    pub away_score: Option<i32>,
    pub period: Option<String>,
    pub time: Option<String>,
    pub home_logo: Option<String>,
    pub away_logo: Option<String>,
    pub sport_logo: Option<String>,
    pub league_logo: Option<String>,
    /// Exchange/in-play: the whole event is locked (all markets padlocked).
    #[serde(default)]
    pub suspended: bool,
    /// Promoted in the provider's featured/highlights strip.
    #[serde(default)]
    pub featured: bool,
    /// Listed in the provider's header match strip.
    #[serde(default)]
    pub header: bool,
    #[serde(default)]
    pub markets: Vec<IngestOdd>,
}

fn default_status() -> String {
    "prematch".into()
}

#[derive(Debug, Deserialize)]
pub struct IngestOdd {
    pub market: String,
    pub outcome: String,
    /// Primary price (sportsbook decimal odd, or exchange best BACK price).
    pub value: Decimal,
    /// Exchange best LAY price (omit for sportsbooks).
    #[serde(default)]
    pub lay: Option<Decimal>,
    /// Exchange matched volume / size (omit for sportsbooks).
    #[serde(default)]
    pub volume: Option<Decimal>,
    pub param: Option<Decimal>,
    /// This line/runner is suspended or blocked.
    #[serde(default)]
    pub suspended: bool,
}

#[derive(Debug, Serialize)]
pub struct IngestResult {
    pub matches: usize,
    pub odds: usize,
}

/// Stable FNV-1a hash → positive i64 for page entities that have no numeric
/// provider id. Masked to 52 bits so the value stays within JavaScript's safe
/// integer range (2^53-1); otherwise the browser rounds the id when parsing
/// JSON and subsequent `/matches/:id` lookups 404.
fn stable_id(parts: &[&str]) -> i64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for part in parts {
        for b in part.as_bytes() {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= b'|' as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    (hash & 0xF_FFFF_FFFF_FFFF) as i64 // 52 bits -> JS-safe
}

fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

async fn snapshot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(snap): Json<Snapshot>,
) -> AppResult<Json<Value>> {
    // Auth: shared ingest key.
    let key = headers
        .get("x-ingest-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if key != state.config.ingest_key {
        return Err(AppError::Unauthorized);
    }

    let started = std::time::Instant::now();
    let mut total_matches = 0usize;
    let mut total_odds = 0usize;

    let provider = snap.provider.as_str();

    // One transaction per snapshot — far faster than per-row autocommit at 1 Hz.
    let mut tx = state.pool.begin().await?;

    // Featured pass: reset the provider's featured flags first, so the promoted
    // strip in this snapshot is authoritative (rotated-out events un-feature).
    if snap.clear_featured {
        sqlx::query("UPDATE matches SET featured = false WHERE provider = $1")
            .bind(provider)
            .execute(&mut *tx)
            .await?;
    }
    if !snap.featured_ids.is_empty() {
        sqlx::query("UPDATE matches SET featured = true WHERE provider = $1 AND id = ANY($2)")
            .bind(provider)
            .bind(&snap.featured_ids)
            .execute(&mut *tx)
            .await?;
    }
    if snap.clear_header {
        sqlx::query("UPDATE matches SET header = false WHERE provider = $1")
            .bind(provider)
            .execute(&mut *tx)
            .await?;
    }
    if !snap.header_ids.is_empty() {
        sqlx::query("UPDATE matches SET header = true WHERE provider = $1 AND id = ANY($2)")
            .bind(provider)
            .bind(&snap.header_ids)
            .execute(&mut *tx)
            .await?;
    }

    // Track ids + sports in this snapshot, for the optional dead-sweep below.
    let mut seen_ids: Vec<i64> = Vec::new();
    let mut seen_sports: std::collections::HashSet<i64> = std::collections::HashSet::new();

    for m in &snap.matches {
        let sport_id = stable_id(&[provider, &m.sport]);
        sqlx::query(
            "INSERT INTO sports (id, name, slug, logo_url, provider, updated_at) VALUES ($1,$2,$3,$4,$5, now())
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
                logo_url = COALESCE(EXCLUDED.logo_url, sports.logo_url), updated_at = now()",
        )
        .bind(sport_id)
        .bind(&m.sport)
        .bind(slugify(&m.sport))
        .bind(&m.sport_logo)
        .bind(provider)
        .execute(&mut *tx)
        .await?;

        let league_id = match &m.league {
            Some(l) if !l.is_empty() => {
                let lid = stable_id(&[provider, &m.sport, l]);
                sqlx::query(
                    "INSERT INTO leagues (id, sport_id, name, logo_url, provider, updated_at) VALUES ($1,$2,$3,$4,$5, now())
                     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
                        logo_url = COALESCE(EXCLUDED.logo_url, leagues.logo_url), updated_at = now()",
                )
                .bind(lid)
                .bind(sport_id)
                .bind(l)
                .bind(&m.league_logo)
                .bind(provider)
                .execute(&mut *tx)
                .await?;
                Some(lid)
            }
            _ => None,
        };

        // Catalog any images we saw.
        for (url, kind, name) in [
            (&m.sport_logo, "sport", Some(m.sport.as_str())),
            (&m.league_logo, "league", m.league.as_deref()),
            (&m.home_logo, "team", Some(m.home.as_str())),
            (&m.away_logo, "team", Some(m.away.as_str())),
        ] {
            if let Some(u) = url {
                if !u.is_empty() {
                    sqlx::query(
                        "INSERT INTO images (url, kind, name, provider) VALUES ($1,$2,$3,$4)
                         ON CONFLICT (url) DO UPDATE
                         SET seen_count = images.seen_count + 1, last_seen = now(),
                             name = COALESCE(EXCLUDED.name, images.name),
                             provider = COALESCE(EXCLUDED.provider, images.provider)",
                    )
                    .bind(u)
                    .bind(kind)
                    .bind(name)
                    .bind(provider)
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }

        let match_id = m
            .ext_id
            .unwrap_or_else(|| stable_id(&[provider, &m.sport, &m.home, &m.away]));
        seen_ids.push(match_id);
        seen_sports.insert(sport_id);

        sqlx::query(
            "INSERT INTO matches
                (id, sport_id, league_id, home_team, away_team, home_logo, away_logo, status,
                 home_score, away_score, period, match_time, suspended, featured, header, source, provider, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
             ON CONFLICT (id) DO UPDATE SET
                league_id = EXCLUDED.league_id, status = EXCLUDED.status,
                home_logo = COALESCE(EXCLUDED.home_logo, matches.home_logo),
                away_logo = COALESCE(EXCLUDED.away_logo, matches.away_logo),
                home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
                period = EXCLUDED.period, match_time = EXCLUDED.match_time,
                suspended = EXCLUDED.suspended,
                featured = (matches.featured OR EXCLUDED.featured),
                header = (matches.header OR EXCLUDED.header),
                dead = false,
                source = EXCLUDED.source, updated_at = now()",
        )
        .bind(match_id)
        .bind(sport_id)
        .bind(league_id)
        .bind(&m.home)
        .bind(&m.away)
        .bind(&m.home_logo)
        .bind(&m.away_logo)
        .bind(&m.status)
        .bind(m.home_score)
        .bind(m.away_score)
        .bind(&m.period)
        .bind(&m.time)
        .bind(m.suspended)
        .bind(m.featured)
        .bind(m.header)
        .bind(&snap.source)
        .bind(provider)
        .execute(&mut *tx)
        .await?;
        total_matches += 1;

        for o in &m.markets {
            // Record a line-movement point when the value is new or changed
            // (compared against the currently stored odd). Must run BEFORE the
            // upsert so `odds` still holds the previous value.
            sqlx::query(
                "INSERT INTO odds_history (match_id, market, outcome, value, param)
                 SELECT $1,$2,$3,$4,$5
                 WHERE NOT EXISTS (
                     SELECT 1 FROM odds
                     WHERE match_id = $1 AND market = $2 AND outcome = $3
                       AND COALESCE(param, 0) = COALESCE($5, 0)
                       AND value = $4
                 )",
            )
            .bind(match_id)
            .bind(&o.market)
            .bind(&o.outcome)
            .bind(o.value)
            .bind(o.param)
            .execute(&mut *tx)
            .await?;

            sqlx::query(
                "INSERT INTO odds (match_id, market, outcome, value, lay, volume, param, suspended, source, provider, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
                 ON CONFLICT (match_id, market, outcome, (COALESCE(param, 0))) DO UPDATE
                 SET value = EXCLUDED.value, lay = EXCLUDED.lay, volume = EXCLUDED.volume,
                     suspended = EXCLUDED.suspended, source = EXCLUDED.source, updated_at = now()",
            )
            .bind(match_id)
            .bind(&o.market)
            .bind(&o.outcome)
            .bind(o.value)
            .bind(o.lay)
            .bind(o.volume)
            .bind(o.param)
            .bind(o.suspended)
            .bind(&snap.source)
            .bind(provider)
            .execute(&mut *tx)
            .await?;
            total_odds += 1;
        }
    }

    // Dead-sweep: when the scraper marks this snapshot as the complete set for
    // its sports, retire (mark dead) every earlier match in those same sports
    // that is NOT in this snapshot. Re-scraped matches were revived to dead=false
    // by the upsert above, so only genuinely-gone matches are retired. Finished
    // matches are never swept (they belong in /results).
    if snap.sweep && !seen_ids.is_empty() && !seen_sports.is_empty() {
        let sports: Vec<i64> = seen_sports.iter().copied().collect();
        if snap.sweep_grace_seconds > 0 {
            // Grace-based retirement: only drop a missing match once it has gone
            // un-scraped for the grace window. Matches still on the source are
            // re-upserted each pass (updated_at bumped), so they never age out —
            // exactly "keep showing it until it's actually gone from the site".
            sqlx::query(
                "UPDATE matches SET dead = true
                 WHERE provider = $1 AND sport_id = ANY($2) AND id <> ALL($3)
                   AND dead = false AND status <> 'finished'
                   AND updated_at < now() - make_interval(secs => $4)",
            )
            .bind(provider)
            .bind(&sports)
            .bind(&seen_ids)
            .bind(snap.sweep_grace_seconds as f64)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "UPDATE matches SET dead = true
                 WHERE provider = $1 AND sport_id = ANY($2) AND id <> ALL($3)
                   AND dead = false AND status <> 'finished'",
            )
            .bind(provider)
            .bind(&sports)
            .bind(&seen_ids)
            .execute(&mut *tx)
            .await?;
        }
    }

    // Catalog the full sports-tree / sidebar (sports + leagues with no current
    // matches). Upserts the same way the match loop does so the public
    // /sports, /leagues and /sidebar endpoints expose the complete tree.
    let mut total_sports = 0usize;
    let mut total_leagues = 0usize;
    for s in &snap.sports {
        if s.name.trim().is_empty() {
            continue;
        }
        let sport_id = stable_id(&[provider, &s.name]);
        sqlx::query(
            "INSERT INTO sports (id, name, slug, logo_url, provider, updated_at) VALUES ($1,$2,$3,$4,$5, now())
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
                logo_url = COALESCE(EXCLUDED.logo_url, sports.logo_url), updated_at = now()",
        )
        .bind(sport_id)
        .bind(&s.name)
        .bind(slugify(&s.name))
        .bind(&s.logo)
        .bind(provider)
        .execute(&mut *tx)
        .await?;
        total_sports += 1;

        for l in &s.leagues {
            if l.name.trim().is_empty() {
                continue;
            }
            let lid = stable_id(&[provider, &s.name, &l.name]);
            sqlx::query(
                "INSERT INTO leagues (id, sport_id, name, country, logo_url, provider, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now())
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
                    country = COALESCE(EXCLUDED.country, leagues.country),
                    logo_url = COALESCE(EXCLUDED.logo_url, leagues.logo_url), updated_at = now()",
            )
            .bind(lid)
            .bind(sport_id)
            .bind(&l.name)
            .bind(&l.country)
            .bind(&l.logo)
            .bind(provider)
            .execute(&mut *tx)
            .await?;
            total_leagues += 1;
        }
    }

    tx.commit().await?;

    // Redis: bump lifetime counters + publish a live-update ping for SSE.
    if let Some(cache) = &state.cache {
        cache.incr("stats:ingest:matches", total_matches as i64).await;
        cache.incr("stats:ingest:odds", total_odds as i64).await;
        cache.incr("stats:ingest:passes", 1).await;
        cache
            .set_json(
                &format!("snapshot:{}", snap.source),
                &json!({ "matches": total_matches, "odds": total_odds }),
                60,
            )
            .await;
        cache.publish("live:updates", &snap.source).await;
    }

    // Heartbeat the scrape log, but throttle to ~once per 30s per source so a
    // 1 Hz real-time scraper doesn't flood the table.
    let secs_since: Option<i64> = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM (now() - max(started_at)))::bigint
         FROM scrape_logs WHERE job = $1",
    )
    .bind(&snap.source)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(None);

    if secs_since.map_or(true, |s| s >= 30) {
        let _ = sqlx::query(
            "INSERT INTO scrape_logs (job, status, items, duration_ms, message)
             VALUES ($1, 'success', $2, $3, $4)",
        )
        .bind(&snap.source)
        .bind(total_matches as i32)
        .bind(started.elapsed().as_millis() as i64)
        .bind(format!("{} matches, {} odds (realtime page scraper)", total_matches, total_odds))
        .execute(&state.pool)
        .await;
    }

    Ok(Json(json!({
        "matches": total_matches,
        "odds": total_odds,
        "sports": total_sports,
        "leagues": total_leagues
    })))
}

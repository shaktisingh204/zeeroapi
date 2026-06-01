use crate::config::Config;
use crate::scraper::pages;
use crate::scraper::types::{ScrapedMatch, ScrapedOdd, ScrapedSport, ScrapeOutcome};
use anyhow::Context;
use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::PgPool;
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

/// Client + parser for the melbet (1xbet-family) public line/live feeds.
///
/// These feeds are undocumented JSON endpoints. The base URL, language and
/// partner id are configurable so the scraper can be re-targeted or fixed up
/// without code changes. The parser is intentionally tolerant: it works off
/// `serde_json::Value` and skips anything it can't understand instead of
/// failing the whole pass.
pub struct MelbetScraper {
    http: reqwest::Client,
    config: Arc<Config>,
}

impl MelbetScraper {
    pub fn new(config: Arc<Config>) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            )
            .timeout(Duration::from_secs(25))
            .build()
            .context("failed to build http client")?;
        Ok(Self { http, config })
    }

    async fn polite_delay(&self) {
        tokio::time::sleep(Duration::from_millis(self.config.scrape_request_delay_ms)).await;
    }

    async fn get_json(&self, url: &str) -> anyhow::Result<Value> {
        tracing::debug!(url, "GET feed");
        let resp = self
            .http
            .get(url)
            .header("Accept", "application/json")
            .header("Referer", &self.config.melbet_base_url)
            .send()
            .await
            .with_context(|| format!("request failed: {url}"))?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("feed returned {status}: {}", text.chars().take(200).collect::<String>());
        }
        let json: Value = serde_json::from_str(&text)
            .with_context(|| format!("invalid JSON from {url}"))?;
        Ok(json)
    }

    /// Fetch raw text (HTML / XML). Used for page + sitemap scraping.
    async fn get_text(&self, url: &str) -> anyhow::Result<String> {
        let resp = self
            .http
            .get(url)
            .header("Accept", "text/html,application/xhtml+xml,application/xml")
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
            .with_context(|| format!("request failed: {url}"))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("page returned {status}");
        }
        Ok(body)
    }

    /// Fetch a (possibly gzipped) sitemap and return its decompressed bytes.
    async fn get_sitemap(&self, url: &str) -> anyhow::Result<String> {
        let resp = self
            .http
            .get(url)
            .send()
            .await
            .with_context(|| format!("request failed: {url}"))?;
        if !resp.status().is_success() {
            anyhow::bail!("sitemap returned {}", resp.status());
        }
        let bytes = resp.bytes().await?;
        // `.gz` files are content (not transfer-encoding), so gunzip manually.
        if url.ends_with(".gz") || bytes.starts_with(&[0x1f, 0x8b]) {
            use std::io::Read;
            let mut d = flate2::read::GzDecoder::new(&bytes[..]);
            let mut s = String::new();
            d.read_to_string(&mut s)
                .with_context(|| format!("gunzip failed: {url}"))?;
            Ok(s)
        } else {
            Ok(String::from_utf8_lossy(&bytes).to_string())
        }
    }

    // ----------------------------------------------------------------------
    // Endpoint builders
    // ----------------------------------------------------------------------

    fn sports_url(&self) -> String {
        format!(
            "{base}/service-api/LineFeed/GetSportsShortZip?lng={lng}&partner={partner}\
             &virtualSports=true&gr=70&groupChamps=true",
            base = self.config.melbet_base_url,
            lng = self.config.melbet_lang,
            partner = self.config.melbet_partner,
        )
    }

    fn prematch_url(&self, sport_id: i64) -> String {
        format!(
            "{base}/service-api/LineFeed/Get1x2_VZip?sports={sport}&count=200&lng={lng}\
             &mode=4&partner={partner}&getEmpty=true&gr=70",
            base = self.config.melbet_base_url,
            sport = sport_id,
            lng = self.config.melbet_lang,
            partner = self.config.melbet_partner,
        )
    }

    fn live_url(&self) -> String {
        format!(
            "{base}/service-api/LiveFeed/Get1x2_VZip?count=500&lng={lng}&gr=70&mode=4\
             &partner={partner}&getEmpty=true",
            base = self.config.melbet_base_url,
            lng = self.config.melbet_lang,
            partner = self.config.melbet_partner,
        )
    }

    // ----------------------------------------------------------------------
    // Fetch + parse
    // ----------------------------------------------------------------------

    pub async fn fetch_sports(&self) -> anyhow::Result<Vec<ScrapedSport>> {
        let json = self.get_json(&self.sports_url()).await?;
        let arr = json
            .get("Value")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut out = Vec::new();
        for item in arr {
            let id = item.get("I").and_then(|v| v.as_i64());
            let name = item
                .get("N")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let count = item.get("GC").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            if let (Some(id), Some(name)) = (id, name) {
                out.push(ScrapedSport {
                    id,
                    name,
                    match_count: count,
                });
            }
        }
        Ok(out)
    }

    pub async fn fetch_prematch(&self, sport_id: i64) -> anyhow::Result<Vec<ScrapedMatch>> {
        let json = self.get_json(&self.prematch_url(sport_id)).await?;
        Ok(parse_games(&json, false))
    }

    pub async fn fetch_live(&self) -> anyhow::Result<Vec<ScrapedMatch>> {
        let json = self.get_json(&self.live_url()).await?;
        Ok(parse_games(&json, true))
    }

    /// Raw full-game payload (all markets). Live events live under `LiveFeed`,
    /// prematch under `LineFeed`; we try live first, then fall back to line.
    /// A non-success/empty response from one feed must not abort the other.
    pub async fn fetch_game_raw(&self, id: i64) -> anyhow::Result<Value> {
        if let Ok(live) = self.get_json(&self.game_url(id, "LiveFeed")).await {
            if live.get("Value").map(|v| !v.is_null()).unwrap_or(false) {
                return Ok(live);
            }
        }
        let line = self.get_json(&self.game_url(id, "LineFeed")).await?;
        if line.get("Value").map(|v| !v.is_null()).unwrap_or(false) {
            return Ok(line);
        }
        anyhow::bail!("game {id} not found in live or line feed")
    }

    /// Fetch the full market tree for a single game and persist every line.
    pub async fn scrape_game_markets(&self, pool: &PgPool, id: i64) -> anyhow::Result<usize> {
        let raw = self.fetch_game_raw(id).await?;
        let value = raw.get("Value").cloned().unwrap_or(Value::Null);
        let is_live = value.get("SC").is_some();
        if let Some(m) = parse_game(&value, is_live) {
            persist_match(pool, &m).await?;
            Ok(m.odds.len())
        } else {
            Ok(0)
        }
    }

    /// Enrich the most relevant matches with their COMPLETE market tree by
    /// calling `GetGameZip` per game. Rate-limited; capped per pass so it never
    /// hammers the provider. Live matches are prioritised, then soonest upcoming.
    pub async fn scrape_full_markets(&self, pool: &PgPool, limit: i64) -> anyhow::Result<ScrapeOutcome> {
        let ids: Vec<i64> = sqlx::query_scalar(
            "SELECT id FROM matches
             WHERE status IN ('live','prematch')
             ORDER BY (status = 'live') DESC, start_time ASC NULLS LAST
             LIMIT $1",
        )
        .bind(limit)
        .fetch_all(pool)
        .await?;

        let mut outcome = ScrapeOutcome::default();
        for id in ids {
            self.polite_delay().await;
            match self.scrape_game_markets(pool, id).await {
                Ok(n) => {
                    outcome.matches += 1;
                    outcome.odds += n;
                }
                Err(e) => tracing::warn!(game = id, error = %e, "full-markets fetch failed"),
            }
        }
        Ok(outcome)
    }

    fn game_url(&self, id: i64, feed: &str) -> String {
        format!(
            "{base}/service-api/{feed}/GetGameZip?id={id}&lng={lng}&partner={partner}\
             &country=71&grMode=4&isSubGames=true&GroupEvents=true\
             &allEventsGroupSubGames=true&marketType=1",
            base = self.config.melbet_base_url,
            feed = feed,
            id = id,
            lng = self.config.melbet_lang,
            partner = self.config.melbet_partner,
        )
    }

    fn champ_url(&self, league_id: i64) -> String {
        format!(
            "{base}/service-api/LineFeed/Get1x2_VZip?champs={id}&count=100&lng={lng}\
             &mode=4&partner={partner}&getEmpty=true&gr=70",
            base = self.config.melbet_base_url,
            id = league_id,
            lng = self.config.melbet_lang,
            partner = self.config.melbet_partner,
        )
    }

    /// All matches (+ odds) for a single league/champ.
    pub async fn fetch_champ(&self, league_id: i64) -> anyhow::Result<Vec<ScrapedMatch>> {
        let json = self.get_json(&self.champ_url(league_id)).await?;
        Ok(parse_games(&json, false))
    }

    // ----------------------------------------------------------------------
    // Page scraping: crawl the sitemap tree -> parse page URLs/HTML ->
    // resolve odds for each discovered league/match page.
    // ----------------------------------------------------------------------

    /// Walk the sitemap index recursively and return every line/live page URL.
    pub async fn crawl_sitemap_urls(&self) -> anyhow::Result<Vec<String>> {
        let root = format!("{}/sitemap.xml", self.config.melbet_base_url);
        let mut queue = vec![root];
        let mut pages = Vec::new();
        let mut visited = HashSet::new();
        let mut budget = 25; // cap sitemap fetches to stay polite

        while let Some(url) = queue.pop() {
            if !visited.insert(url.clone()) || budget == 0 {
                continue;
            }
            budget -= 1;
            self.polite_delay().await;
            let body = match self.get_sitemap(&url).await {
                Ok(b) => b,
                Err(e) => {
                    tracing::warn!(url, error = %e, "sitemap fetch failed");
                    continue;
                }
            };
            for loc in pages::extract_sitemap_locs(&body) {
                if loc.ends_with(".xml") || loc.ends_with(".xml.gz") || loc.contains("/sitemap") {
                    queue.push(loc); // nested sitemap
                } else if loc.contains("/line/") || loc.contains("/live/") {
                    pages.push(loc); // actual content page
                }
            }
        }
        pages.sort();
        pages.dedup();
        Ok(pages)
    }

    /// Full page-scraping pass:
    ///   1. discover page URLs from the sitemap tree
    ///   2. parse each URL (sport / league / match + ids) and upsert it
    ///   3. try to fetch+parse the page HTML (title/meta/JSON-LD) when reachable
    ///   4. resolve odds: league pages -> champ feed, match pages -> game feed
    ///
    /// `resolve_limit` caps how many pages we resolve odds for in one pass.
    pub async fn scrape_pages(&self, pool: &PgPool, resolve_limit: usize) -> anyhow::Result<ScrapeOutcome> {
        let urls = self.crawl_sitemap_urls().await?;
        tracing::info!(count = urls.len(), "discovered page URLs from sitemaps");

        let mut outcome = ScrapeOutcome::default();
        let mut resolved = 0usize;

        for url in &urls {
            let parsed = pages::parse_page_url(url);

            // Try to read the page HTML (best-effort; SPA/anti-bot may block it).
            let title = match self.get_text(url).await {
                Ok(html) => {
                    let data = pages::extract_html_data(&html);
                    data.title
                }
                Err(_) => None,
            };

            upsert_page(pool, &parsed, title.as_deref(), "discovered", None).await?;

            // Resolve odds from the ids embedded in the page.
            if resolved >= resolve_limit {
                continue;
            }
            match parsed.kind {
                pages::PageKind::League => {
                    if let Some(lid) = parsed.league_id {
                        self.polite_delay().await;
                        resolved += 1;
                        match self.fetch_champ(lid).await {
                            Ok(games) => {
                                let mut odds = 0;
                                for g in &games {
                                    ensure_sport(pool, g.sport_id, &g.sport_name).await?;
                                    persist_match(pool, g).await?;
                                    odds += g.odds.len();
                                }
                                outcome.matches += games.len();
                                outcome.odds += odds;
                                set_page_resolved(pool, url, games.len() as i32, odds as i32).await?;
                            }
                            Err(e) => {
                                set_page_status(pool, url, "error", &e.to_string()).await?;
                            }
                        }
                    }
                }
                pages::PageKind::Match => {
                    if let Some(gid) = parsed.game_id {
                        self.polite_delay().await;
                        resolved += 1;
                        match self.scrape_game_markets(pool, gid).await {
                            Ok(n) => {
                                outcome.matches += 1;
                                outcome.odds += n;
                                set_page_resolved(pool, url, 1, n as i32).await?;
                            }
                            Err(e) => set_page_status(pool, url, "error", &e.to_string()).await?,
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(outcome)
    }

    // ----------------------------------------------------------------------
    // High level jobs: fetch -> persist -> log
    // ----------------------------------------------------------------------

    pub async fn scrape_sports(&self, pool: &PgPool) -> anyhow::Result<ScrapeOutcome> {
        let sports = self.fetch_sports().await?;
        let mut outcome = ScrapeOutcome::default();
        for s in &sports {
            upsert_sport(pool, s).await?;
            outcome.matches += 1;
        }
        Ok(outcome)
    }

    pub async fn scrape_prematch(&self, pool: &PgPool) -> anyhow::Result<ScrapeOutcome> {
        // Refresh the sports catalog first so we know which sports to walk.
        let sports = self.fetch_sports().await?;
        for s in &sports {
            upsert_sport(pool, s).await?;
        }

        let mut outcome = ScrapeOutcome::default();
        for s in &sports {
            self.polite_delay().await;
            match self.fetch_prematch(s.id).await {
                Ok(games) => {
                    for g in &games {
                        persist_match(pool, g).await?;
                        outcome.matches += 1;
                        outcome.odds += g.odds.len();
                    }
                }
                Err(e) => tracing::warn!(sport = s.id, error = %e, "prematch fetch failed"),
            }
        }
        Ok(outcome)
    }

    pub async fn scrape_live(&self, pool: &PgPool) -> anyhow::Result<ScrapeOutcome> {
        let games = self.fetch_live().await?;
        let mut outcome = ScrapeOutcome::default();
        for g in &games {
            // Make sure the parent sport row exists.
            ensure_sport(pool, g.sport_id, &g.sport_name).await?;
            persist_match(pool, g).await?;
            outcome.matches += 1;
            outcome.odds += g.odds.len();
        }
        Ok(outcome)
    }
}

// --------------------------------------------------------------------------
// JSON parsing helpers (free functions so they're easy to unit-test)
// --------------------------------------------------------------------------

fn parse_games(json: &Value, is_live: bool) -> Vec<ScrapedMatch> {
    let arr = json
        .get("Value")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    arr.iter().filter_map(|g| parse_game(g, is_live)).collect()
}

fn parse_game(g: &Value, is_live: bool) -> Option<ScrapedMatch> {
    let id = g.get("I").or_else(|| g.get("CI")).and_then(|v| v.as_i64())?;
    let home = g.get("O1").and_then(|v| v.as_str())?.to_string();
    let away = g
        .get("O2")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sport_id = g.get("SI").and_then(|v| v.as_i64()).unwrap_or(0);
    let sport_name = g
        .get("SN")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();
    let league_id = g.get("LI").and_then(|v| v.as_i64());
    let league_name = g
        .get("L")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let country = g.get("CN").and_then(|v| v.as_str()).map(|s| s.to_string());
    let start_time = g.get("S").and_then(|v| v.as_i64());

    // Score block (SC). FS = full score, S1/S2 = home/away.
    let (home_score, away_score, period, match_time) = parse_score(g.get("SC"));

    let odds = collect_odds(g);

    Some(ScrapedMatch {
        id,
        sport_id,
        sport_name,
        league_id,
        league_name,
        country,
        home_team: home,
        away_team: away,
        start_time,
        is_live,
        home_score,
        away_score,
        period,
        match_time,
        odds,
    })
}

fn parse_score(sc: Option<&Value>) -> (Option<i32>, Option<i32>, Option<String>, Option<String>) {
    let Some(sc) = sc else {
        return (None, None, None, None);
    };
    let fs = sc.get("FS");
    let home = fs
        .and_then(|f| f.get("S1"))
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let away = fs
        .and_then(|f| f.get("S2"))
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);

    // Period name (e.g. "2nd half") lives in CP/CPS depending on sport.
    let period = sc
        .get("CPS")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Elapsed time seconds -> "mm'"
    let match_time = sc
        .get("TS")
        .and_then(|v| v.as_i64())
        .map(|secs| format!("{}'", secs / 60));

    (home, away, period, match_time)
}

/// Collect EVERY market line for a game from all the places the provider hides
/// them, deduplicated by (group, type, param):
///   * `E`        — the headline event of each market group (list feeds)
///   * `AE[].ME`  — additional events: every line within each group (list feeds)
///   * `GE[].E`   — the full market tree (nested arrays) from `GetGameZip`
fn collect_odds(game: &Value) -> Vec<ScrapedOdd> {
    let mut seen: HashSet<(i64, i64, String)> = HashSet::new();
    let mut out = Vec::new();

    let mut push = |e: &Value| {
        if let Some(odd) = event_to_odd(e) {
            let key = (
                odd.group_id,
                odd.type_code,
                odd.param.map(|p| p.to_string()).unwrap_or_default(),
            );
            if seen.insert(key) {
                out.push(odd);
            }
        }
    };

    // Headline events
    if let Some(arr) = game.get("E").and_then(|v| v.as_array()) {
        arr.iter().for_each(&mut push);
    }
    // Additional events (list feeds)
    if let Some(blocks) = game.get("AE").and_then(|v| v.as_array()) {
        for blk in blocks {
            if let Some(me) = blk.get("ME").and_then(|v| v.as_array()) {
                me.iter().for_each(&mut push);
            }
        }
    }
    // Full market tree (GetGameZip): GE[].E is an array of arrays of events
    if let Some(groups) = game.get("GE").and_then(|v| v.as_array()) {
        for grp in groups {
            if let Some(cols) = grp.get("E").and_then(|v| v.as_array()) {
                for col in cols {
                    if let Some(events) = col.as_array() {
                        events.iter().for_each(&mut push);
                    } else {
                        push(col);
                    }
                }
            }
        }
    }

    out
}

/// Convert one raw event `{ "G": group, "T": type, "C": coef, "P": param }`
/// into a normalized odd, preserving the raw group/type codes.
fn event_to_odd(e: &Value) -> Option<ScrapedOdd> {
    let value = e.get("C").and_then(json_to_decimal)?;
    let group_id = e.get("G").and_then(|v| v.as_i64()).unwrap_or(0);
    let type_code = e.get("T").and_then(|v| v.as_i64()).unwrap_or(0);
    let param = e.get("P").and_then(json_to_decimal);
    let (market, outcome) = classify(group_id, type_code);
    Some(ScrapedOdd {
        group_id,
        type_code,
        market,
        outcome,
        value,
        param,
    })
}

/// Best-effort human labels for a (group, type) pair. The 1x2 / Handicap /
/// Total groups were verified live against real odds; other groups keep a
/// generic label while the raw `group_id`/`type_code` are always persisted, so
/// no data is lost and the table below can be extended freely.
fn classify(group: i64, t: i64) -> (String, String) {
    let market = market_name(group);
    let outcome = match (group, t) {
        (1, 1) => "W1",
        (1, 2) => "X",
        (1, 3) => "W2",
        (2, 7) => "Handicap 1",
        (2, 8) => "Handicap 2",
        (17, 9) => "Over",
        (17, 10) => "Under",
        (19, _) | (20, _) => return (market, format!("T{t}")),
        _ => return (market, format!("T{t}")),
    };
    (market, outcome.to_string())
}

fn market_name(group: i64) -> String {
    match group {
        1 => "1x2",
        2 => "Handicap",
        15 => "Double Chance",
        17 => "Total",
        19 => "Individual Total — Home",
        20 => "Individual Total — Away",
        62 => "1x2 (incl. OT)",
        _ => return format!("Group {group}"),
    }
    .to_string()
}

fn json_to_decimal(v: &Value) -> Option<Decimal> {
    if let Some(f) = v.as_f64() {
        return Decimal::from_str(&format!("{f}")).ok();
    }
    if let Some(s) = v.as_str() {
        return Decimal::from_str(s).ok();
    }
    None
}

// --------------------------------------------------------------------------
// Persistence
// --------------------------------------------------------------------------

async fn upsert_sport(pool: &PgPool, s: &ScrapedSport) -> anyhow::Result<()> {
    let slug = slugify(&s.name);
    sqlx::query(
        "INSERT INTO sports (id, name, slug, match_count, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, slug = EXCLUDED.slug,
             match_count = EXCLUDED.match_count, updated_at = now()",
    )
    .bind(s.id)
    .bind(&s.name)
    .bind(slug)
    .bind(s.match_count)
    .execute(pool)
    .await?;
    Ok(())
}

async fn ensure_sport(pool: &PgPool, id: i64, name: &str) -> anyhow::Result<()> {
    if id == 0 {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO sports (id, name, slug, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(id)
    .bind(name)
    .bind(slugify(name))
    .execute(pool)
    .await?;
    Ok(())
}

async fn ensure_league(pool: &PgPool, m: &ScrapedMatch) -> anyhow::Result<()> {
    let (Some(lid), Some(name)) = (m.league_id, m.league_name.as_ref()) else {
        return Ok(());
    };
    sqlx::query(
        "INSERT INTO leagues (id, sport_id, name, country, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, country = EXCLUDED.country, updated_at = now()",
    )
    .bind(lid)
    .bind(m.sport_id)
    .bind(name)
    .bind(&m.country)
    .execute(pool)
    .await?;
    Ok(())
}

async fn persist_match(pool: &PgPool, m: &ScrapedMatch) -> anyhow::Result<()> {
    ensure_league(pool, m).await?;

    let status = if m.is_live { "live" } else { "prematch" };
    let start_time = m
        .start_time
        .and_then(|s| chrono::DateTime::from_timestamp(s, 0));

    sqlx::query(
        "INSERT INTO matches
            (id, sport_id, league_id, home_team, away_team, start_time, status,
             home_score, away_score, period, match_time, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         ON CONFLICT (id) DO UPDATE SET
            sport_id   = EXCLUDED.sport_id,
            league_id  = EXCLUDED.league_id,
            home_team  = EXCLUDED.home_team,
            away_team  = EXCLUDED.away_team,
            start_time = EXCLUDED.start_time,
            status     = EXCLUDED.status,
            home_score = EXCLUDED.home_score,
            away_score = EXCLUDED.away_score,
            period     = EXCLUDED.period,
            match_time = EXCLUDED.match_time,
            updated_at = now()",
    )
    .bind(m.id)
    .bind(m.sport_id)
    .bind(m.league_id)
    .bind(&m.home_team)
    .bind(&m.away_team)
    .bind(start_time)
    .bind(status)
    .bind(m.home_score)
    .bind(m.away_score)
    .bind(&m.period)
    .bind(&m.match_time)
    .execute(pool)
    .await?;

    for o in &m.odds {
        sqlx::query(
            "INSERT INTO odds (match_id, group_id, type_code, market, outcome, value, param, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7, now())
             ON CONFLICT (match_id, market, outcome, (COALESCE(param, 0))) DO UPDATE
             SET value = EXCLUDED.value, group_id = EXCLUDED.group_id,
                 type_code = EXCLUDED.type_code, updated_at = now()",
        )
        .bind(m.id)
        .bind(o.group_id)
        .bind(o.type_code)
        .bind(&o.market)
        .bind(&o.outcome)
        .bind(o.value)
        .bind(o.param)
        .execute(pool)
        .await?;

        sqlx::query(
            "INSERT INTO odds_history (match_id, group_id, type_code, market, outcome, value, param)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(m.id)
        .bind(o.group_id)
        .bind(o.type_code)
        .bind(&o.market)
        .bind(&o.outcome)
        .bind(o.value)
        .bind(o.param)
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn upsert_page(
    pool: &PgPool,
    p: &pages::ParsedPage,
    title: Option<&str>,
    status: &str,
    note: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO pages (url, kind, sport_slug, league_id, game_id, title, status, note, last_crawled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (url) DO UPDATE SET
            kind = EXCLUDED.kind,
            sport_slug = EXCLUDED.sport_slug,
            league_id = EXCLUDED.league_id,
            game_id = EXCLUDED.game_id,
            title = COALESCE(EXCLUDED.title, pages.title),
            last_crawled_at = now()",
    )
    .bind(&p.url)
    .bind(p.kind.as_str())
    .bind(&p.sport_slug)
    .bind(p.league_id)
    .bind(p.game_id)
    .bind(title)
    .bind(status)
    .bind(note)
    .execute(pool)
    .await?;
    Ok(())
}

async fn set_page_resolved(pool: &PgPool, url: &str, matches: i32, odds: i32) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE pages SET status = 'resolved', matches_found = $2, odds_found = $3,
         note = NULL, last_crawled_at = now() WHERE url = $1",
    )
    .bind(url)
    .bind(matches)
    .bind(odds)
    .execute(pool)
    .await?;
    Ok(())
}

async fn set_page_status(pool: &PgPool, url: &str, status: &str, note: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE pages SET status = $2, note = $3, last_crawled_at = now() WHERE url = $1")
        .bind(url)
        .bind(status)
        .bind(note)
        .execute(pool)
        .await?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A real `Get1x2_VZip` live response captured from india.melbet.com.
    const SAMPLE: &str = include_str!("sample_live.json");

    #[test]
    fn captures_all_markets_from_e_and_ae() {
        let json: Value = serde_json::from_str(SAMPLE).unwrap();
        let games = parse_games(&json, true);
        assert!(!games.is_empty(), "should parse games");

        let g0 = &games[0];
        // The headline `E` array alone had 16 events for this game; capturing
        // `AE[].ME` too must yield strictly more, across multiple market groups.
        let groups: std::collections::HashSet<i64> =
            g0.odds.iter().map(|o| o.group_id).collect();

        assert!(
            g0.odds.len() > 16,
            "expected >16 lines from E+AE, got {}",
            g0.odds.len()
        );
        assert!(
            groups.len() >= 5,
            "expected several market groups, got {:?}",
            groups
        );
        // 1x2 (group 1) and Total (group 17) must be present and named.
        assert!(groups.contains(&1) && groups.contains(&17));
        assert!(g0.odds.iter().any(|o| o.market == "1x2" && o.outcome == "W2"));
        assert!(g0.odds.iter().any(|o| o.market == "Total" && o.outcome == "Over"));

        // Every line keeps its raw provider coordinates.
        assert!(g0.odds.iter().all(|o| o.group_id != 0));
    }

    #[test]
    fn dedupes_repeated_lines() {
        let json: Value = serde_json::from_str(SAMPLE).unwrap();
        let games = parse_games(&json, true);
        let g0 = &games[0];
        let mut keys: Vec<_> = g0
            .odds
            .iter()
            .map(|o| (o.group_id, o.type_code, o.param.map(|p| p.to_string())))
            .collect();
        let before = keys.len();
        keys.sort();
        keys.dedup();
        assert_eq!(before, keys.len(), "no duplicate (group,type,param) lines");
    }
}

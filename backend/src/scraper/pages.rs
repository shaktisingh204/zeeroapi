//! Page-level scraping helpers: turn site **pages** into structured data.
//!
//! melbet is a JS single-page app behind an anti-bot layer, so a match page's
//! odds are not present in the served HTML — they are loaded over XHR from the
//! Line/Live feeds. We therefore "scrape pages" in two complementary ways:
//!
//!   1. **URL intelligence** — the page URL slug encodes the sport, league id
//!      and game id (e.g. `/en/line/cricket/2542291-indian-premier-league`).
//!      `parse_page_url` extracts those so each page maps to a feed query.
//!   2. **HTML extraction** — `extract_html_data` parses whatever HTML *is*
//!      reachable (title, meta/OpenGraph, JSON-LD `SportsEvent`, and on-page
//!      links to more match pages) with the `scraper` crate.
//!
//! The odds themselves are then resolved from the discovered ids against the
//! data feed (see `MelbetScraper::scrape_pages`).

use scraper::{Html, Selector};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PageKind {
    Sport,
    League,
    Match,
    Other,
}

impl PageKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            PageKind::Sport => "sport",
            PageKind::League => "league",
            PageKind::Match => "match",
            PageKind::Other => "other",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParsedPage {
    pub url: String,
    pub kind: PageKind,
    pub sport_slug: Option<String>,
    pub league_id: Option<i64>,
    pub game_id: Option<i64>,
}

/// Parse a melbet `/en/line/...` or `/en/live/...` page URL into its parts.
/// Path shapes:
///   /<lng>/line/<sport>
///   /<lng>/line/<sport>/<leagueId>-<league-slug>
///   /<lng>/line/<sport>/<leagueId>-<league-slug>/<gameId>-<team1>-<team2>
pub fn parse_page_url(url: &str) -> ParsedPage {
    // strip scheme://host
    let path = match url.find("://") {
        Some(i) => match url[i + 3..].find('/') {
            Some(j) => &url[i + 3 + j..],
            None => "/",
        },
        None => url,
    };
    let path = path.split(['?', '#']).next().unwrap_or(path);
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // locate the "line" / "live" marker
    let marker = segs.iter().position(|s| *s == "line" || *s == "live");
    let mut parsed = ParsedPage {
        url: url.to_string(),
        kind: PageKind::Other,
        sport_slug: None,
        league_id: None,
        game_id: None,
    };

    let Some(m) = marker else { return parsed };
    let rest = &segs[m + 1..];

    match rest.len() {
        0 => parsed.kind = PageKind::Other,
        1 => {
            parsed.kind = PageKind::Sport;
            parsed.sport_slug = Some(rest[0].to_string());
        }
        2 => {
            parsed.kind = PageKind::League;
            parsed.sport_slug = Some(rest[0].to_string());
            parsed.league_id = leading_id(rest[1]);
        }
        _ => {
            parsed.kind = PageKind::Match;
            parsed.sport_slug = Some(rest[0].to_string());
            parsed.league_id = leading_id(rest[1]);
            parsed.game_id = leading_id(rest[2]);
        }
    }
    parsed
}

/// Extract the leading integer id from a slug like `2542291-indian-premier-league`.
fn leading_id(slug: &str) -> Option<i64> {
    let digits: String = slug.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

#[derive(Debug, Default, Clone)]
pub struct PageData {
    pub title: Option<String>,
    pub description: Option<String>,
    pub jsonld: Vec<String>,
    /// In-page links to further line/live pages (for crawling).
    pub links: Vec<String>,
}

/// Parse a page's HTML with the `scraper` crate, pulling title, meta/OG tags,
/// JSON-LD blocks and links to other match pages. Used whenever the HTML is
/// actually reachable (direct fetch, a proxy, or a headless renderer).
pub fn extract_html_data(html: &str) -> PageData {
    let doc = Html::parse_document(html);
    let mut data = PageData::default();

    if let Ok(sel) = Selector::parse("title") {
        data.title = doc
            .select(&sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty());
    }

    // description: prefer meta[name=description], fall back to og:title
    for q in ["meta[name=description]", "meta[property='og:description']"] {
        if data.description.is_some() {
            break;
        }
        if let Ok(sel) = Selector::parse(q) {
            data.description = doc
                .select(&sel)
                .next()
                .and_then(|e| e.value().attr("content"))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        }
    }

    if let Ok(sel) = Selector::parse(r#"script[type="application/ld+json"]"#) {
        for el in doc.select(&sel) {
            let txt = el.text().collect::<String>();
            if !txt.trim().is_empty() {
                data.jsonld.push(txt.trim().to_string());
            }
        }
    }

    if let Ok(sel) = Selector::parse("a[href]") {
        for el in doc.select(&sel) {
            if let Some(href) = el.value().attr("href") {
                if href.contains("/line/") || href.contains("/live/") {
                    data.links.push(href.to_string());
                }
            }
        }
        data.links.sort();
        data.links.dedup();
    }

    data
}

/// Extract `<loc>...</loc>` URLs from a sitemap XML body (no XML dep needed).
pub fn extract_sitemap_locs(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<loc>") {
        rest = &rest[start + 5..];
        if let Some(end) = rest.find("</loc>") {
            let loc = rest[..end].trim();
            if !loc.is_empty() {
                out.push(loc.to_string());
            }
            rest = &rest[end + 6..];
        } else {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_league_url() {
        let p = parse_page_url("https://india.melbet.com/en/line/cricket/2542291-indian-premier-league");
        assert_eq!(p.kind, PageKind::League);
        assert_eq!(p.sport_slug.as_deref(), Some("cricket"));
        assert_eq!(p.league_id, Some(2542291));
        assert_eq!(p.game_id, None);
    }

    #[test]
    fn parses_match_url() {
        let p = parse_page_url(
            "https://india.melbet.com/en/live/football/118463-epl/725433493-arsenal-chelsea",
        );
        assert_eq!(p.kind, PageKind::Match);
        assert_eq!(p.league_id, Some(118463));
        assert_eq!(p.game_id, Some(725433493));
    }

    #[test]
    fn parses_sport_url() {
        let p = parse_page_url("https://india.melbet.com/en/line/football");
        assert_eq!(p.kind, PageKind::Sport);
        assert_eq!(p.sport_slug.as_deref(), Some("football"));
    }

    #[test]
    fn extracts_locs() {
        let xml = "<urlset><url><loc>https://x/a</loc></url><url><loc>https://x/b</loc></url></urlset>";
        assert_eq!(extract_sitemap_locs(xml), vec!["https://x/a", "https://x/b"]);
    }

    #[test]
    fn extracts_html() {
        let html = r#"<html><head><title>Cricket Odds</title>
            <meta name="description" content="IPL betting">
            <script type="application/ld+json">{"@type":"SportsEvent"}</script>
            </head><body><a href="/en/line/cricket/123-x">x</a><a href="/about">no</a></body></html>"#;
        let d = extract_html_data(html);
        assert_eq!(d.title.as_deref(), Some("Cricket Odds"));
        assert_eq!(d.description.as_deref(), Some("IPL betting"));
        assert_eq!(d.jsonld.len(), 1);
        assert_eq!(d.links, vec!["/en/line/cricket/123-x"]);
    }
}

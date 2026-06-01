#!/usr/bin/env python3
"""BetWinner page scraper → ZeroApi ingest, tagged provider=betwinner.

BetWinner is a 1xbet-family skin running the SAME SPA engine as melbet: same
DOM (`.dashboard-champ`, `.dashboard-game`, `.ui-market`, `team-score-name`),
same anti-bot layer. So this mirrors `scrape.py` almost exactly — we render the
SPA in real Chrome (Playwright `channel="chrome"`), extract matches + markets
with their real human names, and POST them to the Rust ingest API.

`betwinner.com` returns HTTP 000 / NAME_NOT_RESOLVED on plain curl (anti-bot /
geo). BetWinner rotates mirror domains; confirmed-working defaults are picked at
verification time. Override with BETWINNER_BASE_URL.

Usage:
    python scrape_betwinner.py              # one pass over live + configured sports
    python scrape_betwinner.py --loop 30    # repeat every 30s
    python scrape_betwinner.py --headed     # show the browser (debugging)
    python scrape_betwinner.py --dry-run    # extract + print, no POST

Env:
    BACKEND_URL          default http://localhost:8081
    INGEST_KEY           must match the backend's INGEST_KEY (default dev-ingest-key)
    BETWINNER_BASE_URL   working mirror root (default https://betwinner1.com)
"""
import argparse
import os
import re
import sys
import time

import httpx
from playwright.sync_api import sync_playwright


def hq_logo(url):
    """Strip the CDN `/resized/sizeNN/` thumbnail segment for the full-res original."""
    if not url:
        return url
    return re.sub(r"/resized/size\d+/", "/", url)


BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8081").rstrip("/")
INGEST_KEY = os.environ.get("INGEST_KEY", "dev-ingest-key")
# Confirmed working mirrors (verified rendering `.dashboard-game`): betwinner1.com,
# betwinner.cm. betwinner.com itself does not resolve / is geo-blocked.
BASE_URL = os.environ.get("BETWINNER_BASE_URL", "https://betwinner1.com").rstrip("/")
PROVIDER = "betwinner"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
CHUNK = 80  # matches per ingest POST

# Pages to scrape: (url, status, label). /live aggregates all live sports.
_LINE_SPORTS = [
    "football", "tennis", "basketball", "cricket",
    "table-tennis", "volleyball", "ice-hockey", "esports",
]
TARGETS = [(f"{BASE_URL}/en/live", "live", "page-live")] + [
    (f"{BASE_URL}/en/line/{s}", "prematch", f"page-{s}") for s in _LINE_SPORTS
]

# JS that pulls every match row out of the rendered DOM as structured data.
# Each `.dashboard-champ` block carries the league title and the market column
# header labels (e.g. 1 / X / 2 / O / U); each `.dashboard-game` row's odds
# cells align positionally with those labels. On live pages the cells also
# expose the outcome name directly via aria-label.
EXTRACT_JS = r"""
() => {
    const out = [];
    // Best image URL for a single element: prefer <img> currentSrc/src/data-src
    // (skip empty + tiny data: placeholders), else parse a background-image url().
    const imgUrl = (el) => {
        if (!el) return null;
        if (el.tagName === 'IMG') {
            for (const u of [el.currentSrc, el.getAttribute('src'), el.getAttribute('data-src')]) {
                if (u && !(u.startsWith('data:') && u.length < 30)) return u;
            }
        }
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
            const m = bg.match(/url\(\s*["']?(.*?)["']?\s*\)/);
            if (m && m[1] && !(m[1].startsWith('data:') && m[1].length < 30)) return m[1];
        }
        return null;
    };
    // First N distinct image URLs found within a container (imgs first, then bg).
    const imgUrls = (root, n) => {
        const found = [];
        const cands = [...root.querySelectorAll(
            "img, [class*='ui-ico-team'], [class*='ui-img'], [class*='ui-team-icons'], [style*='background-image']"
        )];
        for (const el of cands) {
            const u = imgUrl(el);
            if (u && !found.includes(u)) {
                found.push(u);
                if (found.length >= n) break;
            }
        }
        return found;
    };
    document.querySelectorAll('.dashboard-champ').forEach(champ => {
        const league = (champ.querySelector(
            "[class*='champ__name'], [class*='champ-caption__name'], [class*='dashboard-champ__title'], [class*='champ__caption']"
        ) || {}).innerText?.trim() || null;
        // league / sport icon lives in the champ header (flag/logo img)
        const champHeader = champ.querySelector(
            "[class*='champ-caption'], [class*='champ__header'], [class*='dashboard-champ__head'], [class*='champ__title']"
        ) || champ;
        // Only accept a champ-logo URL for the league (avoid team-logo false
        // positives when the header selector misses and we scan the whole block).
        const champImg = imgUrls(champHeader, 1)[0] || null;
        const leagueLogo = (champImg && !champImg.includes('logo_teams')) ? champImg : null;
        const sportLogo = null;
        const labels = [...champ.querySelectorAll("[class*='market-group__label']")]
            .map(n => n.innerText.trim());

        champ.querySelectorAll('.dashboard-game').forEach(g => {
            // team names use the dedicated team-score-name class (dedupe nowrap copies)
            const teams = [...new Set(
                [...g.querySelectorAll("[class*='team-score-name']")]
                    .map(n => n.innerText.trim()).filter(Boolean)
            )];
            if (teams.length < 2) return;

            // team logos: first two distinct image URLs in the game row, in order
            const logos = imgUrls(g, 2);
            const homeLogo = logos[0] || null;
            const awayLogo = logos[1] || null;

            const scores = [...g.querySelectorAll('.ui-game-scores__num')].map(n => n.innerText.trim());
            const timeInfo = (g.querySelector("[class*='game-info'], [class*='timer'], [class*='period']")
                              || {}).innerText?.trim() || null;

            const markets = [];
            [...g.querySelectorAll('.ui-market')].forEach((m, i) => {
                const label = m.getAttribute('aria-label')
                    || m.getAttribute('data-original-title')
                    || labels[i] || null;
                const valTxt = (m.querySelector('.ui-market__value') || {}).innerText?.trim() || '';
                const num = parseFloat(valTxt.replace(',', '.'));
                if (label && !isNaN(num) && num >= 1.0) {
                    markets.push({ label, value: num });
                }
            });

            out.push({ teams: teams.slice(0, 2), scores, league, timeInfo, markets,
                       homeLogo, awayLogo, leagueLogo, sportLogo });
        });
    });
    return out;
}
"""

# Map the SPA's short outcome codes to friendly (market, outcome) names.
OUTCOME_MAP = {
    "1": ("Match Result", "W1"), "W1": ("Match Result", "W1"),
    "X": ("Match Result", "Draw"), "draw": ("Match Result", "Draw"),
    "2": ("Match Result", "W2"), "W2": ("Match Result", "W2"),
    "1X": ("Double Chance", "1X"), "12": ("Double Chance", "12"),
    "2X": ("Double Chance", "X2"), "X2": ("Double Chance", "X2"),
    "O": ("Total", "Over"), "Over": ("Total", "Over"),
    "U": ("Total", "Under"), "Under": ("Total", "Under"),
}


def name_market(label):
    if label in OUTCOME_MAP:
        return OUTCOME_MAP[label]
    return ("Main", label)


def to_int(s):
    try:
        return int(str(s).strip())
    except (ValueError, TypeError):
        return None


def build_match(card, status, sport_hint):
    home, away = card["teams"][0], card["teams"][1]
    scores = card.get("scores") or []
    home_score = to_int(scores[0]) if len(scores) >= 1 else None
    away_score = to_int(scores[1]) if len(scores) >= 2 else None

    markets = []
    for m in card.get("markets", []):
        market_name, outcome = name_market(m["label"])
        markets.append({
            "market": market_name,
            "outcome": outcome,
            "value": round(float(m["value"]), 3),
            "param": None,
        })

    return {
        "ext_id": None,
        "sport": sport_hint,
        "league": card.get("league"),
        "home": home,
        "away": away,
        "status": status,
        "home_score": home_score if status == "live" else None,
        "away_score": away_score if status == "live" else None,
        "time": card.get("timeInfo"),
        "period": None,
        "markets": markets,
        "home_logo": hq_logo(card.get("homeLogo")),
        "away_logo": hq_logo(card.get("awayLogo")),
        "sport_logo": hq_logo(card.get("sportLogo")),
        "league_logo": hq_logo(card.get("leagueLogo")),
    }


def sport_from_url(url):
    if "/line/" in url:
        return url.rstrip("/").split("/line/")[-1].split("/")[0].replace("-", " ").title()
    return "Live"


def scroll_collect(page):
    """The match list is virtualized (~40 rows in the DOM at once). Scroll
    top-to-bottom collecting rows at each step, deduped by (league, home, away),
    so we capture every match, not just the first window."""
    try:
        page.mouse.move(700, 420)
        page.mouse.wheel(0, -200000)  # back to top
        page.wait_for_timeout(300)
    except Exception:
        pass
    seen = {}
    last, stable = -1, 0
    for _ in range(60):
        try:
            cards = page.evaluate(EXTRACT_JS)
        except Exception:
            cards = []
        for c in cards:
            t = c.get("teams") or []
            if len(t) >= 2:
                seen[(c.get("league"), t[0], t[1])] = c
        page.mouse.wheel(0, 1200)
        page.wait_for_timeout(160)
        if len(seen) == last:
            stable += 1
            if stable >= 5:
                break
        else:
            stable, last = 0, len(seen)
    return list(seen.values())


def scrape_once(page, url, status):
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(5000)
    try:
        page.wait_for_selector(".dashboard-game", timeout=15000)
    except Exception:
        pass
    cards = scroll_collect(page)
    sport_hint = sport_from_url(url)
    matches = [build_match(c, status, sport_hint) for c in cards if len(c.get("teams", [])) >= 2]
    return matches


def post_snapshot(source, matches, dry_run=False):
    if not matches:
        print(f"  [{source}] no matches extracted")
        return
    if dry_run:
        print(f"  [{source}] DRY-RUN: {len(matches)} matches "
              f"({sum(len(m['markets']) for m in matches)} odds), not posting")
        for m in matches[:3]:
            mk = ", ".join(f"{o['outcome']}={o['value']}" for o in m["markets"][:4])
            print(f"      {m['sport']:10} | {m['league']} | "
                  f"{m['home']} vs {m['away']} [{m['status']}] :: {mk}")
        return
    # Chunk POSTs so a huge prematch page doesn't exceed body limits.
    total_m = total_o = 0
    for i in range(0, len(matches), CHUNK):
        chunk = matches[i:i + CHUNK]
        try:
            r = httpx.post(
                f"{BACKEND_URL}/api/ingest/snapshot",
                headers={"X-Ingest-Key": INGEST_KEY},
                json={"source": source, "provider": PROVIDER, "matches": chunk},
                timeout=60,
            )
            r.raise_for_status()
            b = r.json()
            total_m += b.get("matches", 0)
            total_o += b.get("odds", 0)
        except Exception as e:
            print(f"  [{source}] POST failed (chunk {i}): {e}", file=sys.stderr)
    print(f"  [{source}] sent {len(matches)} matches -> {total_m} upserted, {total_o} odds")


def run(headed=False, dry_run=False):
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=not headed)
        ctx = browser.new_context(locale="en-US",
                                  viewport={"width": 1600, "height": 1200}, user_agent=UA)
        page = ctx.new_page()
        for url, status, source in TARGETS:
            try:
                print(f"scraping {url} ...")
                matches = scrape_once(page, url, status)
                post_snapshot(source, matches, dry_run=dry_run)
            except Exception as e:
                print(f"  error on {url}: {e}", file=sys.stderr)
        browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=int, default=0, help="repeat every N seconds")
    ap.add_argument("--headed", action="store_true", help="show the browser")
    ap.add_argument("--dry-run", action="store_true", help="extract + print, no POST")
    args = ap.parse_args()

    print(f"provider={PROVIDER} base={BASE_URL} backend={BACKEND_URL} "
          f"dry_run={args.dry_run}")
    while True:
        start = time.time()
        run(headed=args.headed, dry_run=args.dry_run)
        if args.loop <= 0:
            break
        elapsed = time.time() - start
        wait = max(5, args.loop - elapsed)
        print(f"--- pass done in {elapsed:.0f}s, sleeping {wait:.0f}s ---")
        time.sleep(wait)


if __name__ == "__main__":
    main()

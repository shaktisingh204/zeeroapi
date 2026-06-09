#!/usr/bin/env python3
"""1xbet page scraper → ZeroApi ingest, tagged provider=1xbet.

1xbet is the engine that melbet is a skin of: the same SPA, the same DOM
(`.dashboard-champ`, `.dashboard-game`, `.ui-market`, `team-score-name`) and the
same `/LineFeed/Get1x2_VZip` JSON feed. So this scraper is the melbet Playwright
DOM engine (scrape.py) pointed at a live 1xbet mirror, with provider=1xbet and
chunked ingest POSTs (like scrape_bcgame.py).

We render the SPA in real Chrome (Playwright `channel="chrome"`) — this passes
1xbet's anti-bot layer that resets plain curl (HTTP 000), and the page resolves
the opaque numeric market codes into human names for us.

1xbet rotates mirror domains. `ONEXBET_BASE_URL` defaults to https://1x001.com,
a stable entry domain that 301-redirects to whichever live mirror is current
(e.g. https://1xlite-NNNNN.pro). Playwright follows the redirect automatically.

Usage:
    python scrape_1xbet.py                 # one pass over live + configured sports
    python scrape_1xbet.py --loop 30       # repeat every 30s
    python scrape_1xbet.py --headed        # show the browser (debugging)
    python scrape_1xbet.py --dry-run       # extract + print counts/samples, no POST

Env:
    BACKEND_URL        default http://localhost:8081
    INGEST_KEY         must match the backend's INGEST_KEY (default dev-ingest-key)
    ONEXBET_BASE_URL   default https://1x001.com (a working 1xbet mirror entry)
"""
import argparse
import json
import os
import re
import sys
import time

import httpx
from playwright.sync_api import sync_playwright

from _ingest import sidebar_payload, tree_from_matches


def hq_logo(url):
    """Strip the CDN `/resized/sizeNN/` thumbnail segment for the full-res original."""
    if not url:
        return url
    return re.sub(r"/resized/size\d+/", "/", url)


BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8081").rstrip("/")
INGEST_KEY = os.environ.get("INGEST_KEY", "dev-ingest-key")
PROVIDER = "1xbet"
# 1x001.com is a stable 1xbet entry domain that redirects to the current live
# mirror (confirmed: -> 1xlite-NNNNN.pro, renders the full live SPA with odds).
BASE_URL = os.environ.get("ONEXBET_BASE_URL", "https://1x001.com").rstrip("/")
CHUNK = 80  # matches per ingest POST
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

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

            // A cell is "locked"/suspended when the SPA disables the odds:
            // a lock/disabled/blocked class on the cell or its value node, a
            // disabled attribute, or a value that is a dash/lock glyph instead
            // of a number.
            const isLocked = (m, valTxt) => {
                try {
                    const cls = (m.className || '') + ' ' +
                        ((m.querySelector('.ui-market__value') || {}).className || '');
                    if (/lock|disabl|block|coef-blocked|suspend|inactive|non-active/i.test(cls)) return true;
                    if (m.getAttribute('aria-disabled') === 'true' || m.hasAttribute('disabled')) return true;
                    if (m.querySelector("[class*='lock'], [class*='ico-lock'], svg[class*='lock']")) return true;
                    const t = (valTxt || '').trim();
                    if (t && /^[—–\-−·•🔒]+$/.test(t)) return true;
                } catch (e) {}
                return false;
            };

            const markets = [];
            let anyOpen = false;
            [...g.querySelectorAll('.ui-market')].forEach((m, i) => {
                const label = m.getAttribute('aria-label')
                    || m.getAttribute('data-original-title')
                    || labels[i] || null;
                const valTxt = (m.querySelector('.ui-market__value') || {}).innerText?.trim() || '';
                const num = parseFloat(valTxt.replace(',', '.'));
                const locked = isLocked(m, valTxt);
                if (label && !isNaN(num) && num >= 1.0 && !locked) {
                    markets.push({ label, value: num, suspended: false });
                    anyOpen = true;
                } else if (label && locked) {
                    // Emit locked outcomes instead of dropping them, value 0.
                    markets.push({ label, value: 0, suspended: true });
                }
            });
            // Whole-match suspension: there are odds cells but none are open.
            const suspended = markets.length > 0 && !anyOpen;

            out.push({ teams: teams.slice(0, 2), scores, league, timeInfo, markets,
                       suspended, homeLogo, awayLogo, leagueLogo, sportLogo });
        });
    });
    return out;
}
"""

# Map 1xbet's short outcome codes to friendly (market, outcome) names.
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
    # Unknown column label: keep it verbatim as both market and outcome so we
    # capture every visible odds column instead of collapsing them into "Main".
    return (label, label)


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
            # New optional ingest fields. Sportsbook odds are back-only, so no
            # lay/volume; suspended flags a locked outcome.
            "lay": None,
            "volume": None,
            "suspended": bool(m.get("suspended", False)),
        })

    return {
        "ext_id": None,
        "sport": sport_hint,
        "league": card.get("league"),
        "home": home,
        "away": away,
        "status": status,
        "suspended": bool(card.get("suspended", False)),
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


def post_chunks(client, source, matches):
    """Chunked ingest POSTs, byte-matching the ingest.rs Snapshot contract."""
    total_m = total_o = 0
    for i in range(0, len(matches), CHUNK):
        chunk = matches[i:i + CHUNK]
        try:
            r = client.post(
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
            print(f"  POST failed ({source} chunk {i}): {e}", file=sys.stderr)
    return total_m, total_o


def run(headed=False, dry_run=False):
    grand_m = grand_o = 0
    all_matches = []
    client = None if dry_run else httpx.Client(http2=False)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=not headed)
            ctx = browser.new_context(locale="en-US",
                                      viewport={"width": 1600, "height": 1200}, user_agent=UA)
            page = ctx.new_page()
            for url, status, source in TARGETS:
                try:
                    print(f"scraping {url} ...")
                    matches = scrape_once(page, url, status)
                    all_matches.extend(matches)
                    odds = sum(len(m["markets"]) for m in matches)
                    if dry_run:
                        print(f"  [{source}] extracted {len(matches)} matches, {odds} odds")
                        for m in matches[:3]:
                            mk = m["markets"][:3]
                            mk_str = ", ".join(f"{o['outcome']}={o['value']}" for o in mk)
                            print(f"    - {m['sport']} | {m['league']} | "
                                  f"{m['home']} vs {m['away']} | {mk_str}")
                        grand_m += len(matches)
                        grand_o += odds
                    else:
                        m, o = post_chunks(client, source, matches)
                        print(f"  [{source}] {len(matches)} matches, {m} upserted, {o} odds")
                        grand_m += m
                        grand_o += o
                except Exception as e:
                    print(f"  error on {url}: {e}", file=sys.stderr)
            browser.close()
    finally:
        if client is not None:
            client.close()

    # Sidebar tree: aggregate the sports + leagues seen across all pages so
    # /api/v1/{provider}/sidebar exposes this provider's tree too.
    tree = tree_from_matches(all_matches)
    tree_leagues = sum(len(s["leagues"]) for s in tree)
    if dry_run:
        print(f"  [sidebar] would post {len(tree)} sports / {tree_leagues} leagues")
    else:
        # The main client is closed above; use a fresh short-lived one for the tree.
        try:
            with httpx.Client(http2=False) as c:
                r = c.post(
                    f"{BACKEND_URL}/api/ingest/snapshot",
                    headers={"X-Ingest-Key": INGEST_KEY},
                    json=sidebar_payload(PROVIDER, tree),
                    timeout=30,
                )
                r.raise_for_status()
                b = r.json()
                print(f"  [sidebar] {b.get('sports', 0)} sports / {b.get('leagues', 0)} leagues")
        except Exception as e:
            print(f"  sidebar POST failed: {e}", file=sys.stderr)
    return grand_m, grand_o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=int, default=0, help="repeat every N seconds")
    ap.add_argument("--headed", action="store_true", help="show the browser")
    ap.add_argument("--dry-run", action="store_true",
                    help="extract + print counts/samples, no POST")
    args = ap.parse_args()

    print(f"provider={PROVIDER} base={BASE_URL} backend={BACKEND_URL} "
          f"{'(DRY RUN)' if args.dry_run else ''}")
    while True:
        start = time.time()
        m, o = run(headed=args.headed, dry_run=args.dry_run)
        elapsed = time.time() - start
        print(f"--- pass done: {m} matches, {o} odds in {elapsed:.0f}s ---")
        if args.loop <= 0:
            break
        wait = max(5, args.loop - elapsed)
        print(f"--- sleeping {wait:.0f}s ---")
        time.sleep(wait)


if __name__ == "__main__":
    main()

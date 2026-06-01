#!/usr/bin/env python3
"""
Real-time melbet page scraper.

Opens one persistent Chrome tab per sport (live + each line page) and keeps them
open. melbet's own SPA streams odds updates into those tabs over its WebSocket,
so each tab's DOM stays live with effectively zero added delay. Every `interval`
seconds we read ALL tabs **in parallel** (no navigation — just a fast DOM eval)
and POST the snapshots concurrently to the backend ingest API.

    python realtime.py                 # 1s cadence (default)
    python realtime.py --interval 1
    python realtime.py --headed        # watch it

Env: BACKEND_URL (default http://localhost:8081), INGEST_KEY (default dev-ingest-key)
"""
import argparse
import asyncio
import os
import re
import signal
import sys
import time

import httpx
from playwright.async_api import async_playwright

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8081").rstrip("/")
INGEST_KEY = os.environ.get("INGEST_KEY", "dev-ingest-key")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# The /live page already aggregates ALL live sports. The line/<sport> pages
# cover prematch per sport — one persistent tab each, scraped in parallel.
# Full melbet sport set so prematch coverage matches live. Any slug melbet
# doesn't serve just yields an empty tab (warm_up fails gracefully), so an
# over-broad list is safe. Override with MELBET_LINE_SPORTS (comma-separated).
_DEFAULT_LINE_SPORTS = [
    "football", "tennis", "basketball", "cricket", "table-tennis",
    "volleyball", "ice-hockey", "handball", "baseball", "badminton",
    "snooker", "darts", "futsal", "boxing", "rugby",
    "american-football", "water-polo", "field-hockey", "esports",
]
_LINE_SPORTS = [
    s.strip() for s in os.environ.get("MELBET_LINE_SPORTS", ",".join(_DEFAULT_LINE_SPORTS)).split(",")
    if s.strip()
]
TARGETS = [("https://india.melbet.com/en/live", "live", "page-live")] + [
    (f"https://india.melbet.com/en/line/{s}", "prematch", f"page-{s}") for s in _LINE_SPORTS
]

# Reload each tab periodically to avoid SPA memory bloat / staleness.
RELOAD_EVERY_SECS = 600

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
            const teams = [...new Set(
                [...g.querySelectorAll("[class*='team-score-name']")]
                    .map(n => n.innerText.trim()).filter(Boolean)
            )];
            if (teams.length < 2) return;
            const logos = imgUrls(g, 2);
            const homeLogo = logos[0] || null;
            const awayLogo = logos[1] || null;
            const scores = [...g.querySelectorAll('.ui-game-scores__num')].map(n => n.innerText.trim());
            const timeInfo = (g.querySelector("[class*='game-info'], [class*='timer'], [class*='period']")
                              || {}).innerText?.trim() || null;
            const markets = [];
            [...g.querySelectorAll('.ui-market')].forEach((m, i) => {
                const label = m.getAttribute('aria-label')
                    || m.getAttribute('data-original-title') || labels[i] || null;
                const valTxt = (m.querySelector('.ui-market__value') || {}).innerText?.trim() || '';
                const num = parseFloat(valTxt.replace(',', '.'));
                if (label && !isNaN(num) && num >= 1.0) markets.push({ label, value: num });
            });
            out.push({ teams: teams.slice(0, 2), scores, league, timeInfo, markets,
                       homeLogo, awayLogo, leagueLogo, sportLogo });
        });
    });
    return out;
}
"""

OUTCOME_MAP = {
    "1": ("Match Result", "W1"), "W1": ("Match Result", "W1"),
    "X": ("Match Result", "Draw"),
    "2": ("Match Result", "W2"), "W2": ("Match Result", "W2"),
    "1X": ("Double Chance", "1X"), "12": ("Double Chance", "12"),
    "2X": ("Double Chance", "X2"), "X2": ("Double Chance", "X2"),
    "O": ("Total", "Over"), "Over": ("Total", "Over"),
    "U": ("Total", "Under"), "Under": ("Total", "Under"),
}


def to_int(s):
    try:
        return int(str(s).strip())
    except (ValueError, TypeError):
        return None


def hq_logo(url):
    """Strip the CDN's `/resized/sizeNN/` thumbnail segment to get the full-res
    original (16px → full quality)."""
    if not url:
        return url
    return re.sub(r"/resized/size\d+/", "/", url)


def sport_from_url(url):
    if "/line/" in url:
        return url.rstrip("/").split("/line/")[-1].split("/")[0].replace("-", " ").title()
    return "Live"


def build_match(card, status, sport_hint):
    scores = card.get("scores") or []
    markets = []
    for m in card.get("markets", []):
        market, outcome = OUTCOME_MAP.get(m["label"], ("Main", m["label"]))
        markets.append({"market": market, "outcome": outcome,
                        "value": round(float(m["value"]), 3), "param": None})
    return {
        "ext_id": None, "sport": sport_hint, "league": card.get("league"),
        "home": card["teams"][0], "away": card["teams"][1], "status": status,
        "home_score": to_int(scores[0]) if status == "live" and scores else None,
        "away_score": to_int(scores[1]) if status == "live" and len(scores) > 1 else None,
        "time": card.get("timeInfo"), "period": None, "markets": markets,
        "home_logo": hq_logo(card.get("homeLogo")), "away_logo": hq_logo(card.get("awayLogo")),
        "sport_logo": hq_logo(card.get("sportLogo")), "league_logo": hq_logo(card.get("leagueLogo")),
    }


async def _block_assets(route):
    # drop heavy assets to cut bandwidth; everything else proceeds normally
    if route.request.resource_type in ("image", "font", "media"):
        await route.abort()
    else:
        await route.continue_()


async def warm_up(ctx, url):
    pg = await ctx.new_page()
    await pg.route("**/*", _block_assets)
    # Fail fast (not 60s) so a temporary anti-bot block doesn't hang the whole
    # warm-up for many minutes — a failed tab is just skipped and retried later.
    goto_timeout = int(os.environ.get("MELBET_GOTO_TIMEOUT_MS", "30000"))
    await pg.goto(url, wait_until="domcontentloaded", timeout=goto_timeout)
    await pg.wait_for_timeout(4000)
    try:
        await pg.wait_for_selector(".dashboard-game", timeout=15000)
    except Exception:
        pass
    for _ in range(6):
        await pg.mouse.wheel(0, 5000)
        await pg.wait_for_timeout(250)
    return pg


async def scroll_collect(page):
    """melbet's match list is virtualized (only ~40 rows in the DOM at a time),
    so a single read misses the rest. Scroll top-to-bottom collecting rows at
    each step and dedupe by (league, home, away)."""
    try:
        await page.mouse.move(700, 420)
        await page.mouse.wheel(0, -200000)  # back to top
        await page.wait_for_timeout(300)
    except Exception:
        pass
    seen = {}
    last, stable = -1, 0
    for _ in range(60):
        try:
            cards = await page.evaluate(EXTRACT_JS)
        except Exception:
            cards = []
        for c in cards:
            t = c.get("teams") or []
            if len(t) >= 2:
                seen[(c.get("league"), t[0], t[1])] = c
        await page.mouse.wheel(0, 1200)
        await page.wait_for_timeout(150)
        if len(seen) == last:
            stable += 1
            if stable >= 5:
                break
        else:
            stable, last = 0, len(seen)
    return list(seen.values())


async def tick(client, page, url, status, source):
    try:
        cards = await scroll_collect(page)
    except Exception as e:
        print(f"  [{source}] eval error: {e}", file=sys.stderr)
        return 0, 0
    sport_hint = sport_from_url(url)
    matches = [build_match(c, status, sport_hint) for c in cards if len(c.get("teams", [])) >= 2]
    if not matches:
        return 0, 0
    try:
        r = await client.post(f"{BACKEND_URL}/api/ingest/snapshot",
                              headers={"X-Ingest-Key": INGEST_KEY},
                              json={"source": source, "matches": matches}, timeout=30)
        r.raise_for_status()
        body = r.json()
        return body.get("matches", 0), body.get("odds", 0)
    except Exception as e:
        print(f"  [{source}] POST failed: {e}", file=sys.stderr)
        return 0, 0


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between passes")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    # Graceful shutdown: when the supervisor sends SIGTERM/SIGINT, stop the loop
    # and let the `async with` blocks close the browser cleanly (no orphan Chrome).
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=not args.headed)
        ctx = await browser.new_context(locale="en-US",
                                        viewport={"width": 1600, "height": 1200}, user_agent=UA)

        # Warm tabs up sequentially with a delay between each so a wide sport
        # list doesn't burst-navigate and trip melbet's anti-bot (which responds
        # to bursts with connection timeouts). The per-second reads below are
        # pure DOM evals (no new navigation), so steady-state load stays low.
        warm_delay = float(os.environ.get("MELBET_WARMUP_DELAY", "3"))
        print(f"opening {len(TARGETS)} tabs (>= {warm_delay}s apart) ...")
        tabs = []
        for url, status, source in TARGETS:
            try:
                pg = await warm_up(ctx, url)
                tabs.append((pg, url, status, source))
                print(f"  ready: {source}")
            except Exception as e:
                print(f"  FAILED {source}: {e}", file=sys.stderr)
            await asyncio.sleep(warm_delay)
        print(f"{len(tabs)} tabs live. streaming...\n")

        last_reload = time.monotonic()
        n = 0
        async with httpx.AsyncClient() as client:
            while not stop.is_set():
                t0 = time.monotonic()

                # read + post ALL sports concurrently
                results = await asyncio.gather(
                    *[tick(client, pg, url, st, src) for (pg, url, st, src) in tabs]
                )

                total_m = sum(r[0] for r in results)
                total_o = sum(r[1] for r in results)
                n += 1
                dt = (time.monotonic() - t0) * 1000
                print(f"pass {n}: {total_m} matches, {total_o} odds across "
                      f"{len(tabs)} sports in {dt:.0f}ms")

                # periodic reload to keep tabs fresh — reload ONE tab per cycle
                # (round-robin) instead of all at once, so we never burst-reload
                # the whole sport list and re-trip melbet's anti-bot.
                if tabs and time.monotonic() - last_reload > RELOAD_EVERY_SECS / len(tabs):
                    last_reload = time.monotonic()
                    pg = tabs[n % len(tabs)][0]
                    try:
                        await pg.reload(wait_until="domcontentloaded")
                    except Exception:
                        pass

                # interruptible sleep so SIGTERM stops us promptly
                sleep = max(0, args.interval - (time.monotonic() - t0))
                try:
                    await asyncio.wait_for(stop.wait(), timeout=sleep)
                except asyncio.TimeoutError:
                    pass
        print("shutting down (browser closing)...")


if __name__ == "__main__":
    asyncio.run(main())

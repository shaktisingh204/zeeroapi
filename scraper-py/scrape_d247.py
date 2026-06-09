#!/usr/bin/env python3
"""Diamond Exch (d247.com) page scraper → ZeroApi ingest, tagged provider=diamondexch.

d247 is an AES-encrypted betting *exchange* SPA behind Cloudflare. We can't hit
its JSON API (responses are CryptoJS-encrypted), but the SPA decrypts and renders
to the DOM — so, like the melbet page scraper, we drive real Chrome, log in via
the public **demo ID**, and read the rendered `.bet-table-row` event rows.

Per sport (`/all-sports/{etid}`) we read each row's match name, start time and the
Match-Odds back prices (1 / X / 2 columns) and POST them to the backend ingest API.

    python scrape_d247.py                 # one pass
    python scrape_d247.py --loop 30       # every 30s
    python scrape_d247.py --headed        # watch it

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
PROVIDER = "diamondexch"
SITE = "https://d247.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Where we persist the logged-in browser state (cookies + localStorage incl.
# the Cloudflare clearance + demo session). On restart we reload this to skip
# the Cloudflare challenge and the demo-login click entirely.
STATE_FILE = os.environ.get("D247_STATE_FILE",
                            os.path.join(os.path.dirname(__file__), ".d247_state.json"))

# We only read the rendered DOM text — images, fonts and media are pure weight.
# Aborting them cuts page-load time and bandwidth a lot. We KEEP stylesheets:
# the event list is scroll-virtualized, so layout must work for rows to render.
BLOCKED_RESOURCE_TYPES = {"image", "media", "font"}


async def block_assets(route):
    """Abort heavy non-essential requests; let everything else through."""
    try:
        if route.request.resource_type in BLOCKED_RESOURCE_TYPES:
            await route.abort()
        else:
            await route.continue_()
    except Exception:
        # A request can vanish mid-flight on navigation; ignore.
        pass

# d247 lists every sport as a tab in `ul.sports-tab li.nav-item` on the home
# main content; clicking a tab filters the event list (in-SPA, session-safe).
# We iterate ALL tabs so every sport the site offers is covered. Race/outright
# sports (Horse/Greyhound Racing, Politics) have no "Team v Team" rows and are
# skipped automatically by build_match.
TAB_STRIP = "ul.sports-tab li.nav-item"

# Read every rendered event row: match name, start date, Match-Odds back prices.
EXTRACT_JS = r"""
() => {
    const clean = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const num = s => { const n = parseFloat(clean(s).replace(',', '.')); return isNaN(n) ? null : n; };
    const out = [];
    document.querySelectorAll('.bet-table-row').forEach(row => {
        const a = row.querySelector('a.bet-nation-game-name');
        if (!a) return;
        const href = a.getAttribute('href') || '';
        const spans = [...a.querySelectorAll('span')].map(s => clean(s.innerText)).filter(Boolean);
        let name = spans[0] || clean(a.innerText);
        const date = spans.find(s => /\d{2}\/\d{2}\/\d{4}/.test(s)) || null;
        // Column labels (1 / X / 2) from the mobile label divs.
        const labels = [...row.querySelectorAll('.bet-nation-odd.d-xl-none b')]
            .map(b => clean(b.innerText));
        // Real odds columns = those carrying a back price.
        const cols = [...row.querySelectorAll('.bet-nation-odd')]
            .filter(c => c.querySelector('.back .bet-odd'));
        const backs = cols.map(c => {
            const b = c.querySelector('.back .bet-odd b');
            return b ? num(b.innerText) : null;
        });
        const live = !!row.querySelector('.icon-tv');
        out.push({ href, name, date, labels, backs, live });
    });
    return out;
}
"""

# Read d247's left "All Sports" sidebar: every sport (the items carrying the
# `+` expand toggle) plus any leagues already rendered beneath them. Sports with
# no current match still appear here, so this gives the COMPLETE sport tree —
# exactly what the site's sidebar shows — independent of live match coverage.
SIDEBAR_JS = r"""
() => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    // Locate the "All Sports" section, then walk up to its list container.
    const heads = [...document.querySelectorAll('*')].filter(e =>
        clean(e.innerText) === 'All Sports' && e.children.length <= 2);
    let box = null;
    if (heads.length) { box = heads[0]; for (let i = 0; i < 4 && box.parentElement; i++) box = box.parentElement; }
    if (!box) return [];
    const out = [];
    const seen = new Set();
    for (const li of box.querySelectorAll('li.nav-item.dropdown')) {
        const a = li.querySelector(':scope > a');
        if (!a || !a.querySelector('i.fa-plus-square')) continue;   // sports carry the + toggle
        // top-level only: skip league dropdowns nested inside another sport
        let p = li.parentElement, nested = false;
        while (p && p !== box) { if (p.matches && p.matches('li.nav-item.dropdown')) { nested = true; break; } p = p.parentElement; }
        if (nested) continue;
        const span = a.querySelector('span');
        const name = clean(span ? span.innerText : a.innerText);
        if (!name || name.length > 32 || seen.has(name)) continue;
        seen.add(name);
        const leagues = [];
        const seenL = new Set();
        li.querySelectorAll('ul a span').forEach(le => {
            const ln = clean(le.innerText);
            if (ln && ln !== name && ln.length < 60 && !seenL.has(ln)) { seenL.add(ln); leagues.push(ln); }
        });
        out.push({ name, leagues: leagues.slice(0, 50) });
    }
    return out;
}
"""

OUTCOME = {"1": "W1", "X": "Draw", "2": "W2"}
# Team separators in priority order: " v "/" vs "/" @ " (real matches),
# then " - " (esports / virtual "Team (e) - Team" format).
SEPARATORS = [" v ", " vs ", " @ ", " - "]

# How many live matches to enrich with full detail-page markets per pass.
DETAIL_CAP = int(os.environ.get("D247_DETAIL_CAP", "25"))

# Read a match DETAIL page: live scorecard + every market (Match Odds back/lay,
# Bookmaker, Fancy/session/odd-even) with best back & lay prices.
EXTRACT_DETAIL_JS = r"""
() => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const num = s => { const n = parseFloat(clean(s).replace(',', '.')); return isNaN(n) ? null : n; };
    const header = document.querySelector('.game-header');
    const score = header ? clean(header.innerText).slice(0, 200) : null;
    const markets = [];
    document.querySelectorAll('.game-market').forEach(gm => {
        const title = clean((gm.querySelector('.market-title span') || {}).innerText || '') || 'Market';
        const rows = [];
        gm.querySelectorAll('.market-body .market-row').forEach(r => {
            const name = clean((r.querySelector('.market-nation-name') || {}).innerText || '');
            if (!name) return;
            const back = (r.querySelector('.market-odd-box.back .market-odd') || {}).innerText;
            const lay = (r.querySelector('.market-odd-box.lay .market-odd') || {}).innerText;
            const vol = (r.querySelector('.market-odd-box.back .market-volume') || {}).innerText;
            rows.push({ name: name.slice(0, 80), back: num(back), lay: num(lay), line: num(vol) });
        });
        if (rows.length) markets.push({ title: title.slice(0, 60), rows });
    });
    return { score, markets };
}
"""


def event_id_from_href(href):
    """Last numeric segment of /game-details/{etid}/{id} (etc.) → stable ext_id."""
    nums = re.findall(r"/(\d+)", href or "")
    return int(nums[-1]) if nums else None


def split_teams(name):
    low = name.lower()
    for sep in SEPARATORS:
        idx = low.find(sep)
        if idx != -1:
            return name[:idx].strip(), name[idx + len(sep):].strip()
    return None


def detail_to_odds(detail):
    """Map a detail page's market tree to ingest odds rows."""
    out = []
    for m in detail.get("markets", []):
        title = m.get("title") or "Market"
        tl = title.lower()
        if "match" in tl and "odd" in tl:
            base = "Match Odds"
        elif "bookmaker" in tl:
            base = "Bookmaker"
        elif tl in ("normal", "winner", "tied match", "completed match"):
            base = title
        else:
            base = title  # fancy / session / oddeven / over-runs
        for r in m.get("rows", []):
            name = r.get("name")
            if not name:
                continue
            back, lay, line = r.get("back"), r.get("lay"), r.get("line")
            param = line if (line is not None and abs(line) < 9_999_999) else None
            if back is not None and back >= 1.0:
                out.append({"market": base[:60], "outcome": name, "value": round(float(back), 3), "param": param})
            if lay is not None and lay >= 1.0:
                out.append({"market": (base + " (Lay)")[:60], "outcome": name, "value": round(float(lay), 3), "param": param})
    return out


def build_match(card, sport):
    name = re.sub(r"\s*/\s*$", "", card.get("name") or "").strip()
    teams = split_teams(name)
    if not teams:
        return None  # not a two-team match (tournament / outright / race) — skip
    home, away = teams
    if not home or not away:
        return None

    labels = card.get("labels") or []
    backs = card.get("backs") or []
    markets = []
    for i, b in enumerate(backs):
        if b is None or b < 1.0:
            continue
        label = labels[i] if i < len(labels) else None
        outcome = OUTCOME.get(label)
        if not outcome:
            continue
        markets.append({"market": "Match Result", "outcome": outcome,
                        "value": round(float(b), 3), "param": None})

    has_odds = len(markets) > 0
    status = "live" if (card.get("live") and has_odds) else "prematch"
    href = card.get("href") or ""
    return {
        "ext_id": event_id_from_href(href),  # stable id shared with the detail page
        "sport": sport, "league": None,
        "home": home, "away": away, "status": status,
        "home_score": None, "away_score": None,
        "time": card.get("date"), "period": None, "markets": markets,
        "home_logo": None, "away_logo": None, "sport_logo": None, "league_logo": None,
        "_href": href,  # internal: used for detail navigation (ignored by ingest)
    }


async def dismiss_modal(page):
    """Close the welcome-banner modal that pops up after login and intercepts clicks."""
    for sel in [".modal.show .btn-close", ".modal.show button.close",
                ".modal.show [aria-label='Close']", ".modal.show .close"]:
        try:
            el = await page.query_selector(sel)
            if el:
                await el.click(timeout=2000)
                await page.wait_for_timeout(400)
                return
        except Exception:
            pass
    # Fallbacks: Escape, then click the backdrop corner.
    try:
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
    except Exception:
        pass
    try:
        await page.mouse.click(8, 8)
        await page.wait_for_timeout(200)
    except Exception:
        pass


# Candidate selectors for the "play as demo" control. d247 has shuffled this
# button's wording/markup before, so we try several rather than one literal
# string. Order = most-specific first. Matching is case-insensitive.
DEMO_LOGIN_SELECTORS = [
    "text=/login with demo id/i",
    "text=/demo\\s*login/i",
    "text=/login\\s*demo/i",
    "text=/one[-\\s]*click\\s*demo/i",
    "button:has-text('Demo')",
    "a:has-text('Demo')",
    "[class*='demo' i]",
]

# Markers that mean we're already past the login wall (demo session is live).
LOGGED_IN_SELECTORS = [TAB_STRIP, ".bet-table-row", ".sports-tab"]


async def _diagnose_login(page, why):
    """Dump what the page is actually showing so a failed login is debuggable
    from the logs (no need to reproduce locally)."""
    print(f"demo_login: {why} — dumping page state for diagnosis", file=sys.stderr)
    try:
        print(f"  url={page.url}  title={await page.title()!r}", file=sys.stderr)
    except Exception:
        pass
    try:
        shot = "/tmp/d247_login_fail.png"
        await page.screenshot(path=shot, full_page=False)
        print(f"  screenshot saved: {shot}", file=sys.stderr)
    except Exception as e:
        print(f"  screenshot failed: {e}", file=sys.stderr)
    try:
        texts = await page.evaluate(
            "() => [...document.querySelectorAll('button,a,[role=button]')]"
            ".map(e => (e.innerText||'').trim()).filter(Boolean).slice(0,40)"
        )
        print(f"  visible buttons/links: {texts}", file=sys.stderr)
    except Exception as e:
        print(f"  could not read controls: {e}", file=sys.stderr)


async def _is_logged_in(page):
    for sel in LOGGED_IN_SELECTORS:
        try:
            if await page.query_selector(sel):
                return True
        except Exception:
            pass
    return False


async def demo_login(page, deadline_s=75):
    """Open d247, wait out Cloudflare, and start a demo session.

    Resilient to: slow Cloudflare challenges (polls instead of a fixed sleep),
    button-text changes (multiple candidate selectors), and an already-live
    session. Raises a clear RuntimeError with diagnostics if none works."""
    await page.goto(f"{SITE}/", wait_until="domcontentloaded", timeout=60000)

    start = time.monotonic()
    clicked = False
    while time.monotonic() - start < deadline_s:
        # Already inside? (Cloudflare may auto-restore a session, or a prior pass
        # left us logged in.) Then there's nothing to click.
        if await _is_logged_in(page):
            print("demo session ready (already logged in):", page.url)
            await dismiss_modal(page)
            return

        for sel in DEMO_LOGIN_SELECTORS:
            try:
                loc = page.locator(sel).first
                if await loc.is_visible():
                    await loc.click(timeout=5000)
                    clicked = True
                    break
            except Exception:
                continue
        if clicked:
            break

        # Not ready yet — Cloudflare's JS challenge or the SPA bundle is still
        # loading. Wait a beat and re-check rather than failing at a fixed 9s.
        await page.wait_for_timeout(2000)

    if not clicked and not await _is_logged_in(page):
        await _diagnose_login(page, "no demo-login control appeared")
        raise RuntimeError(
            "d247 demo login failed: none of the demo-login selectors matched "
            f"within {deadline_s}s (see /tmp/d247_login_fail.png and the button "
            "list above — d247 likely changed the login markup)."
        )

    # Wait for the dashboard to actually render before we declare success.
    try:
        await page.wait_for_selector(",".join(LOGGED_IN_SELECTORS), timeout=20000)
    except Exception:
        await _diagnose_login(page, "clicked demo login but dashboard never rendered")
        raise RuntimeError("d247 demo login: dashboard did not load after click")
    await dismiss_modal(page)
    print("demo session ready:", page.url)


async def tab_labels(page):
    """Read every sport-tab label from the main-content tab strip."""
    try:
        await page.wait_for_selector(TAB_STRIP, timeout=10000)
    except Exception:
        return []
    return await page.evaluate(
        "(sel) => [...document.querySelectorAll(sel)].map(li => (li.innerText||'').trim()).filter(Boolean)",
        TAB_STRIP,
    )


async def open_tab(page, idx, light=False):
    """Click the idx-th sport tab (in-SPA). light=True skips the full-list scroll
    (used when we only need the row links present, not every row loaded)."""
    link = page.locator(TAB_STRIP).nth(idx).locator("a.nav-link")
    try:
        await link.click(timeout=8000)
    except Exception:
        await dismiss_modal(page)  # a banner may have re-appeared
        try:
            await link.click(timeout=5000)
        except Exception:
            return False
    await page.wait_for_timeout(1500 if light else 2000)
    if not light:
        for _ in range(5):  # load the full (sometimes 100+) list
            await page.mouse.wheel(0, 3000)
            await page.wait_for_timeout(250)
    return True


def merge_detail(m, detail):
    """Fold a detail page's markets + score into a list-built match in place."""
    if not detail:
        return False
    if detail.get("score"):
        m["time"] = detail["score"][:160]
        m["period"] = "live"
    seen = {(o["market"], o["outcome"]) for o in m["markets"]}
    added = 0
    for o in detail_to_odds(detail):
        key = (o["market"], o["outcome"])
        if key not in seen:
            m["markets"].append(o)
            seen.add(key)
            added += 1
    return added > 0 or bool(detail.get("score"))


async def post_snapshot(client, source, matches):
    # NB: matches may carry an internal "_href" key — the ingest API ignores
    # unknown fields, and Phase 2 still needs it, so we leave it in place.
    try:
        r = await client.post(
            f"{BACKEND_URL}/api/ingest/snapshot",
            headers={"X-Ingest-Key": INGEST_KEY},
            json={"source": source, "provider": PROVIDER, "matches": matches},
            timeout=30,
        )
        r.raise_for_status()
        b = r.json()
        return b.get("matches", 0), b.get("odds", 0)
    except Exception as e:
        print(f"  POST failed ({source}): {e}", file=sys.stderr)
        return 0, 0


async def scrape_sidebar(client, page):
    """Phase 0: read d247's full 'All Sports' sidebar (sports + any rendered
    leagues) and POST it as a sports-tree so every sport the site lists appears
    in the API/sidebar, even sports that have no live match right now."""
    try:
        sports = await page.evaluate(SIDEBAR_JS)
    except Exception as e:
        print(f"  sidebar eval error: {e}", file=sys.stderr)
        return 0
    sports = [s for s in (sports or []) if s.get("name")]
    if not sports:
        print("  sidebar: no sports found")
        return 0
    nodes = [
        {"name": s["name"], "leagues": [{"name": l} for l in s.get("leagues", [])]}
        for s in sports
    ]
    try:
        r = await client.post(
            f"{BACKEND_URL}/api/ingest/snapshot",
            headers={"X-Ingest-Key": INGEST_KEY},
            json={"source": "d247-sidebar", "provider": PROVIDER, "matches": [], "sports": nodes},
            timeout=30,
        )
        r.raise_for_status()
        b = r.json()
        nl = sum(len(n["leagues"]) for n in nodes)
        print(f"  sidebar: {len(nodes)} sports, {nl} leagues → "
              f"{b.get('sports', 0)} sports / {b.get('leagues', 0)} leagues upserted")
        return len(nodes)
    except Exception as e:
        print(f"  sidebar POST failed: {e}", file=sys.stderr)
        return 0


async def scrape_sport(client, page, idx, sport):
    """Phase 1: fast list sweep for one sport. Returns (matches, odds, live_dicts)."""
    if not await open_tab(page, idx):
        return 0, 0, []
    try:
        cards = await page.evaluate(EXTRACT_JS)
    except Exception as e:
        print(f"  [{sport}] eval error: {e}", file=sys.stderr)
        return 0, 0, []
    seen = {}
    for c in cards:
        m = build_match(c, sport)
        if m:
            seen[(m["home"], m["away"])] = m
    matches = list(seen.values())
    if not matches:
        print(f"  [{sport}] no team-vs-team matches")
        return 0, 0, []
    live = [m for m in matches if m["status"] == "live" and m.get("_href")]
    mm, oo = await post_snapshot(client, f"d247-{sport.lower().replace(' ', '-')}", matches)
    print(f"  [{sport}] {len(matches)} matches → {mm} upserted, {oo} odds ({len(live)} live)")
    return mm, oo, live


async def enrich_detail(client, page, idx, sport, m):
    """Phase 2: open one live match's detail page (in-SPA), scrape full markets +
    score, POST the enriched match. Re-opens the sport tab to expose the link,
    then returns home so the next enrichment can navigate cleanly."""
    href = m.get("_href")
    # Only true match-detail pages have the full market tree (skip casino/virtual).
    if not href or not re.search(r"/game-details/\d+/\d+", href):
        return False
    if not await open_tab(page, idx):  # full open so the row link is rendered/positioned
        return False
    el = await page.query_selector(f"a[href='{href}']")
    if not el:
        return False
    try:
        await el.evaluate("e => e.scrollIntoView()")
        await el.evaluate("e => e.click()")  # JS click → React Router, keeps session
    except Exception:
        return False
    await page.wait_for_timeout(2800)
    await dismiss_modal(page)
    try:
        await page.wait_for_selector(".game-market", timeout=6000)
    except Exception:
        pass
    for _ in range(3):
        await page.mouse.wheel(0, 2500)
        await page.wait_for_timeout(200)
    detail = None
    try:
        detail = await page.evaluate(EXTRACT_DETAIL_JS)
    except Exception:
        pass
    changed = merge_detail(m, detail)
    if changed:
        await post_snapshot(client, f"d247-{sport.lower().replace(' ', '-')}-detail", [m])
    # Return to the list view for the next enrichment.
    try:
        await page.go_back(wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        await dismiss_modal(page)
    except Exception:
        pass
    return changed


async def one_pass(client, page):
    # Phase 0 — scrape the full left "All Sports" sidebar (sports + leagues) and
    # POST it as a sports-tree, so the API exposes the complete catalog.
    await scrape_sidebar(client, page)

    labels = await tab_labels(page)
    if not labels:
        print("  no sport tabs found", file=sys.stderr)
        return 0, 0, 0
    # Phase 1 — fast list sweep across ALL sports (always completes + POSTs).
    total_m = total_o = 0
    live_targets = []  # (idx, sport, match_dict)
    for idx, sport in enumerate(labels):
        m, o, live = await scrape_sport(client, page, idx, sport)
        total_m += m
        total_o += o
        for lm in live:
            live_targets.append((idx, sport, lm))

    # Phase 2 — enrich live matches with full detail markets (bounded by cap).
    enriched = 0
    for idx, sport, lm in live_targets[:DETAIL_CAP]:
        try:
            if await enrich_detail(client, page, idx, sport, lm):
                enriched += 1
        except Exception as e:
            print(f"  enrich failed [{sport}]: {e}", file=sys.stderr)
    if live_targets:
        print(f"  detail-enriched {enriched}/{min(len(live_targets), DETAIL_CAP)} live matches")
    return total_m, total_o, len(labels)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=float, default=0, help="seconds between passes (0 = single pass)")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=not args.headed)
        # Reuse a previous session if we have one — skips Cloudflare + login.
        state_kw = {}
        if os.path.exists(STATE_FILE):
            state_kw["storage_state"] = STATE_FILE
            print(f"reusing saved session: {STATE_FILE}")
        ctx = await browser.new_context(locale="en-US", user_agent=UA,
                                        viewport={"width": 1440, "height": 1100},
                                        **state_kw)
        # Drop images/fonts/media — we only scrape DOM text.
        await ctx.route("**/*", block_assets)
        page = await ctx.new_page()
        await demo_login(page)
        # Persist the now-logged-in state so the next restart starts warm.
        try:
            await ctx.storage_state(path=STATE_FILE)
            print(f"saved session: {STATE_FILE}")
        except Exception as e:
            print(f"could not save session state: {e}", file=sys.stderr)

        async with httpx.AsyncClient() as client:
            n = 0
            while not stop.is_set():
                t0 = time.monotonic()
                n += 1
                tm, to, nsports = await one_pass(client, page)
                dt = (time.monotonic() - t0) * 1000
                print(f"pass {n}: {tm} matches, {to} odds across {nsports} sports in {dt:.0f}ms\n")
                if args.loop <= 0:
                    break
                sleep = max(0, args.loop - (time.monotonic() - t0))
                try:
                    await asyncio.wait_for(stop.wait(), timeout=sleep)
                except asyncio.TimeoutError:
                    pass
        print("shutting down (browser closing)...")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

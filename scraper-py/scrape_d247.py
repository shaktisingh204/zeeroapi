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
import json
import os
import re
import signal
import sys
import time
from urllib.parse import urlparse

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
        // Odds columns = those carrying a back price OR currently locked (so a
        // suspended row still yields its column shape instead of vanishing).
        const lockSel = '.fa-lock, i.icon-lock, [class*="lock" i], [class*="suspend" i]';
        const cols = [...row.querySelectorAll('.bet-nation-odd')]
            .filter(c => c.querySelector('.back .bet-odd') || c.querySelector('.lay .bet-odd') || c.querySelector(lockSel));
        const backs = cols.map(c => { const b = c.querySelector('.back .bet-odd b'); return b ? num(b.innerText) : null; });
        const lays  = cols.map(c => { const b = c.querySelector('.lay .bet-odd b');  return b ? num(b.innerText) : null; });
        // A row is suspended when it shows a padlock, or every price cell is locked/empty.
        const rowLock = !!row.querySelector(lockSel);
        const allDead = cols.length > 0 && cols.every(c => !c.querySelector('.back .bet-odd b') && !c.querySelector('.lay .bet-odd b'));
        const susp = rowLock || allDead;
        const live = !!row.querySelector('.icon-tv');
        out.push({ href, name, date, labels, backs, lays, susp, live });
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

# Read d247's top "highlights" strip: the promoted row of featured events and
# special markets (e.g. "FIFA WORLD CUP - WINNER 2026", featured matches). Each
# is an anchor linking to an event/market detail page. We try the known
# highlight containers first, then fall back to any event-detail anchor near the
# top of the page that is NOT inside the main `.bet-table-row` list.
FEATURED_JS = r"""
() => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const evRe = /\/(game-details|market|race|sport-event|event)\/\d+/;
    const sels = [
        '[class*="highlight" i] a[href]', '[class*="featured" i] a[href]',
        '[class*="top-event" i] a[href]', '[class*="topgame" i] a[href]',
        '[class*="slider" i] a[href]', '[class*="slick" i] a[href]', '.marquee a[href]',
    ];
    let anchors = [];
    for (const s of sels) { try { anchors.push(...document.querySelectorAll(s)); } catch (e) {} }
    if (anchors.length === 0) {
        anchors = [...document.querySelectorAll('a[href]')].filter(a => {
            const h = a.getAttribute('href') || '';
            if (!evRe.test(h) || a.closest('.bet-table-row')) return false;
            const r = a.getBoundingClientRect();
            return r.top >= 0 && r.top < 280 && r.width > 60;   // top strip only
        });
    }
    const out = [], seen = new Set();
    for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (!evRe.test(href) || a.closest('.bet-table-row')) continue;
        const name = clean(a.innerText);
        if (!name || name.length < 2 || name.length > 90) continue;
        const key = href || name;
        if (seen.has(key)) continue;
        seen.add(key);
        const live = !!a.querySelector('.icon-tv, [class*="tv" i], [class*="live" i]');
        out.push({ href, name, live });
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
    const lockSel = '.fa-lock, i.icon-lock, [class*="lock" i], [class*="suspend" i], [class*="status" i]';
    const isLocked = el => {
        if (!el) return false;
        if (el.querySelector(lockSel)) return true;
        const t = (el.innerText || '').toUpperCase();
        return /\b(SUSPENDED|BALL RUNNING|CLOSED|LOCKED)\b/.test(t);
    };
    const markets = [];
    document.querySelectorAll('.game-market').forEach(gm => {
        const title = clean((gm.querySelector('.market-title span') || {}).innerText || '') || 'Market';
        const mSusp = isLocked(gm.querySelector('.market-title')) || isLocked(gm.querySelector('.market-header'));
        const rows = [];
        gm.querySelectorAll('.market-body .market-row').forEach(r => {
            const name = clean((r.querySelector('.market-nation-name') || {}).innerText || '');
            if (!name) return;
            const back = (r.querySelector('.market-odd-box.back .market-odd') || {}).innerText;
            const lay = (r.querySelector('.market-odd-box.lay .market-odd') || {}).innerText;
            const vol = (r.querySelector('.market-odd-box.back .market-volume') || {}).innerText;
            const rSusp = mSusp || isLocked(r) || (!num(back) && !num(lay));
            rows.push({ name: name.slice(0, 80), back: num(back), lay: num(lay), vol: num(vol), suspended: !!rSusp });
        });
        if (rows.length) markets.push({ title: title.slice(0, 60), suspended: !!mSusp, rows });
    });
    const allSusp = markets.length > 0 && markets.every(m => m.suspended || m.rows.every(r => r.suspended));
    return { score, markets, suspended: allSusp };
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
    """Map a detail page's market tree to ingest odds rows.

    Each runner becomes ONE exchange-native odd: value = best back, plus the
    best `lay`, matched `volume`, and a per-runner `suspended` flag. Suspended
    runners are still emitted (with whatever price was last shown) so the API
    can report "locked" rather than silently dropping the line."""
    out = []
    for m in detail.get("markets", []):
        title = m.get("title") or "Market"
        tl = title.lower()
        if "match" in tl and "odd" in tl:
            base = "Match Odds"
        elif "bookmaker" in tl:
            base = "Bookmaker"
        else:
            base = title  # winner / tied match / fancy / session / oddeven / over-runs
        m_susp = bool(m.get("suspended"))
        for r in m.get("rows", []):
            name = r.get("name")
            if not name:
                continue
            back, lay, vol = r.get("back"), r.get("lay"), r.get("vol")
            suspended = bool(r.get("suspended")) or m_susp
            # Primary price: back if present, else lay (so lay-only lines survive).
            value = back if (back is not None and back >= 1.0) else (lay if (lay is not None and lay >= 1.0) else None)
            if value is None and not suspended:
                continue  # no usable price and not flagged locked → nothing to record
            out.append({
                "market": base[:60],
                "outcome": name,
                "value": round(float(value), 3) if value is not None else 0,
                "lay": round(float(lay), 3) if (lay is not None and lay >= 1.0) else None,
                "volume": round(float(vol), 2) if (vol is not None and abs(vol) < 9_999_999_999) else None,
                "param": None,
                "suspended": suspended,
            })
    return out


def build_match(card, sport):
    name = re.sub(r"\s*/\s*$", "", card.get("name") or "").strip()
    teams = split_teams(name)
    if not teams:
        # Not "Team v Team": a race, outright/winner market or tournament.
        # Don't drop it — model it as a single-entity event (runners arrive via
        # the detail page during enrichment).
        return build_event(card, sport, name)
    home, away = teams
    if not home or not away:
        return None

    susp = bool(card.get("susp"))
    labels = card.get("labels") or []
    backs = card.get("backs") or []
    lays = card.get("lays") or []
    markets = []
    for i, b in enumerate(backs):
        label = labels[i] if i < len(labels) else None
        outcome = OUTCOME.get(label)
        if not outcome:
            continue
        lay = lays[i] if i < len(lays) else None
        if (b is None or b < 1.0) and (lay is None or lay < 1.0) and not susp:
            continue
        markets.append({
            "market": "Match Result", "outcome": outcome,
            "value": round(float(b), 3) if (b is not None and b >= 1.0) else 0,
            "lay": round(float(lay), 3) if (lay is not None and lay >= 1.0) else None,
            "volume": None, "param": None, "suspended": susp,
        })

    has_odds = any(o["value"] >= 1.0 for o in markets)
    status = "live" if (card.get("live") and (has_odds or susp)) else "prematch"
    href = card.get("href") or ""
    return {
        "ext_id": event_id_from_href(href),  # stable id shared with the detail page
        "sport": sport, "league": None,
        "home": home, "away": away, "status": status,
        "home_score": None, "away_score": None,
        "time": card.get("date"), "period": None, "suspended": susp, "markets": markets,
        "home_logo": None, "away_logo": None, "sport_logo": None, "league_logo": None,
        "_href": href,  # internal: used for detail navigation (ignored by ingest)
    }


# Race / outright detail hrefs (per-event pages that carry the runner list).
EVENT_HREF_RE = re.compile(r"/(game-details|race|market|sport-event|event)/\d+")


def build_event(card, sport, name):
    """Single-entity event (Horse/Greyhound race, outright 'Winner' market,
    tournament). The list row only gives the event name; the runners and their
    back/lay prices are scraped from the detail page during enrichment. We still
    emit the fixture now so it appears in the API immediately, with its suspended
    flag, and model it as `home = event name, away = ''` so each runner can be an
    outcome under a 'Winner' market."""
    name = (name or "").strip()
    href = card.get("href") or ""
    if not name or len(name) > 90 or not EVENT_HREF_RE.search(href):
        return None  # section header / nav crumb / non-event row — skip
    susp = bool(card.get("susp"))
    status = "live" if card.get("live") else "prematch"
    return {
        "ext_id": event_id_from_href(href),
        "sport": sport, "league": None,
        "home": name, "away": "", "status": status,
        "home_score": None, "away_score": None,
        "time": card.get("date"), "period": None, "suspended": susp, "markets": [],
        "home_logo": None, "away_logo": None, "sport_logo": None, "league_logo": None,
        "_href": href,
        "_event": True,  # internal: mark for outright-style detail merge
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
    # Carry the event-level suspended flag from the detail page.
    if detail.get("suspended"):
        m["suspended"] = True
    seen = {(o["market"], o["outcome"]) for o in m["markets"]}
    added = 0
    for o in detail_to_odds(detail):
        key = (o["market"], o["outcome"])
        if key not in seen:
            m["markets"].append(o)
            seen.add(key)
            added += 1
    return added > 0 or bool(detail.get("score")) or bool(detail.get("suspended"))


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


async def scrape_featured(client, page):
    """Phase 0.5: read the top 'highlights' strip and flag those events as
    featured. Real matches/events (which also appear under their sport tab) are
    flagged by id; pure special-markets/outrights that may not appear elsewhere
    get a lightweight 'Specials' event shell so they still surface via the API.
    `clear_featured` makes the promoted set authoritative each pass."""
    try:
        items = await page.evaluate(FEATURED_JS)
    except Exception as e:
        print(f"  featured eval error: {e}", file=sys.stderr)
        return 0
    items = items or []
    ids, shells, seen_ids = [], [], set()
    for it in items:
        href = it.get("href") or ""
        eid = event_id_from_href(href)
        if eid is not None and eid not in seen_ids:
            seen_ids.add(eid)
            ids.append(eid)
        name = (it.get("name") or "").strip()
        # Non-team items are special markets / outrights — model as a single
        # 'Specials' event so they appear even if no sport tab lists them.
        if name and not split_teams(name):
            shells.append({
                "ext_id": eid, "sport": "Specials", "league": None,
                "home": name, "away": "", "status": "live" if it.get("live") else "prematch",
                "home_score": None, "away_score": None, "time": None, "period": None,
                "suspended": False, "featured": True, "markets": [],
                "home_logo": None, "away_logo": None, "sport_logo": None, "league_logo": None,
                "_href": href, "_event": True,
            })
    if not ids and not shells:
        print("  featured: none found")
        return 0
    try:
        r = await client.post(
            f"{BACKEND_URL}/api/ingest/snapshot",
            headers={"X-Ingest-Key": INGEST_KEY},
            json={"source": "d247-featured", "provider": PROVIDER,
                  "matches": shells, "featured_ids": ids, "clear_featured": True},
            timeout=30,
        )
        r.raise_for_status()
        print(f"  featured: {len(ids)} flagged, {len(shells)} special-market shells")
        return len(ids) + len(shells)
    except Exception as e:
        print(f"  featured POST failed: {e}", file=sys.stderr)
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
            # Key by href when present (events share an empty away team).
            key = m.get("_href") or (m["home"], m["away"])
            seen[key] = m
    matches = list(seen.values())
    if not matches:
        print(f"  [{sport}] no matches/events")
        return 0, 0, []
    # Targets to enrich with detail-page markets: live matches, plus any
    # single-entity event (race/outright) whose runners only exist on the
    # detail page. Both must carry a detail href.
    live = [m for m in matches
            if m.get("_href") and (m["status"] == "live" or m.get("_event"))]
    mm, oo = await post_snapshot(client, f"d247-{sport.lower().replace(' ', '-')}", matches)
    print(f"  [{sport}] {len(matches)} matches → {mm} upserted, {oo} odds ({len(live)} live)")
    return mm, oo, live


async def enrich_detail(client, page, idx, sport, m):
    """Phase 2: open one live match's detail page (in-SPA), scrape full markets +
    score, POST the enriched match. Re-opens the sport tab to expose the link,
    then returns home so the next enrichment can navigate cleanly."""
    href = m.get("_href")
    # Real event-detail pages carry the full market tree (skip casino/virtual).
    # Covers match details (/game-details/{etid}/{id}) and race/outright pages.
    if not href or not (re.search(r"/game-details/\d+/\d+", href) or EVENT_HREF_RE.search(href)):
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

    # Phase 0.5 — read the top highlights strip and flag featured events.
    await scrape_featured(client, page)

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


# ═══════════════════════════════════════════════════════════════════════════
# Browser engines + nodriver backend
# ═══════════════════════════════════════════════════════════════════════════
# We try stealth browsers in order; the first that gets past Cloudflare and logs
# in wins. patchright / rebrowser-playwright / camoufox all expose the standard
# Playwright page API, so the scraping code above runs on them UNCHANGED. nodriver
# has a totally different API, so we wrap its Tab in `NodriverPage`, an adapter
# that emulates exactly the Playwright `page` methods the scraper calls — letting
# the same demo_login/one_pass/etc. drive it. Override the order/set with
# D247_ENGINES (e.g. "nodriver" to force nodriver only).
ENGINE_ORDER = [e.strip().lower() for e in os.environ.get(
    "D247_ENGINES", "patchright,rebrowser,camoufox,playwright,nodriver").split(",") if e.strip()]

# Route the browser through a proxy to escape datacenter-IP Cloudflare blocks.
# Set D247_PROXY, e.g.  http://user:pass@gate.provider.com:7000  (residential).
# Playwright engines support user:pass auth natively; nodriver gets the host:port
# via --proxy-server (use an IP-whitelisted proxy endpoint for nodriver auth).
PROXY = os.environ.get("D247_PROXY", "").strip()


def _proxy_url():
    if not PROXY:
        return None
    u = urlparse(PROXY if "://" in PROXY else "http://" + PROXY)
    return u if u.hostname else None


def proxy_playwright():
    """Playwright/camoufox proxy dict (with auth), or None."""
    u = _proxy_url()
    if not u:
        return None
    hostport = f"{u.hostname}:{u.port}" if u.port else u.hostname
    d = {"server": f"{u.scheme}://{hostport}"}
    if u.username:
        d["username"] = u.username
        d["password"] = u.password or ""
    return d


def proxy_chrome_arg():
    """`--proxy-server=` flag for nodriver/Chrome, or None (no auth — IP-whitelist)."""
    u = _proxy_url()
    if not u:
        return None
    hostport = f"{u.hostname}:{u.port}" if u.port else u.hostname
    return f"--proxy-server={u.scheme}://{hostport}"


def _js_str(s):
    """Embed a Python string as a safe single-quoted JS string literal."""
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"


def _candidates_js(selector):
    """Compile a selector (CSS, `text=...`, `text=/re/flags`, or `tag:has-text(..)`)
    into a JS expression yielding the array of matching elements, most-specific
    first. Covers every selector dialect the scraper feeds to page.locator()."""
    s = selector.strip()
    TAGS = "'button,a,[role=button],input,div,span,li'"
    m = re.match(r"^text=/(.*)/([a-z]*)$", s)
    if m:
        return (f"[...document.querySelectorAll({TAGS})]"
                f".filter(e=>new RegExp({_js_str(m.group(1))},{_js_str(m.group(2))})"
                f".test((e.innerText||'').trim()))"
                f".sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length)")
    if s.startswith("text="):
        needle = s[len("text="):].strip().lower()
        return (f"[...document.querySelectorAll({TAGS})]"
                f".filter(e=>(e.innerText||'').toLowerCase().includes({_js_str(needle)}))"
                f".sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length)")
    m = re.match(r"^([a-zA-Z0-9*]+):has-text\(['\"](.*)['\"]\)$", s)
    if m:
        return (f"[...document.querySelectorAll({_js_str(m.group(1))})]"
                f".filter(e=>(e.innerText||'').toLowerCase().includes({_js_str(m.group(2).lower())}))")
    return f"[...document.querySelectorAll({_js_str(s)})]"


class _NDElement:
    """A handle to one DOM element, identified by the CSS that found it. Re-queries
    on each op (the DOM is stable between query and use in our flows)."""
    def __init__(self, page, css):
        self._page, self._css = page, css

    async def click(self, timeout=0):
        ok = await self._page._eval(
            f"(()=>{{const el=document.querySelector({_js_str(self._css)});"
            f"if(!el)return false;el.scrollIntoView({{block:'center'}});el.click();return true;}})()")
        if not ok:
            raise RuntimeError(f"element not found to click: {self._css}")

    async def evaluate(self, fn):
        return await self._page._eval(
            f"(()=>{{const el=document.querySelector({_js_str(self._css)});"
            f"if(!el)return null;return ({fn})(el);}})()")


class _NDLocator:
    """Emulates the slice of Playwright's Locator the scraper uses: .first, .nth(i),
    .locator(childCss), .click(), .is_visible() — all resolved via one JS query."""
    def __init__(self, page, base, steps=None):
        self._page, self._base, self._steps = page, base, list(steps or [])

    def _with(self, step):
        return _NDLocator(self._page, self._base, self._steps + [step])

    @property
    def first(self):
        return self._with(("nth", 0))

    def nth(self, i):
        return self._with(("nth", i))

    def locator(self, css):
        return self._with(("child", css))

    def _el_js(self):
        """Build a JS IIFE-body that resolves `el` to the target element or null."""
        body = [f"let arr={_candidates_js(self._base)};let el=arr[0]||null;"]
        for kind, val in self._steps:
            if kind == "nth":
                body.append(f"el=arr[{int(val)}]||null;")
            elif kind == "child":
                body.append(f"el=el&&el.querySelector({_js_str(val)});")
        return "".join(body)

    async def click(self, timeout=0):
        ok = await self._page._eval(
            f"(()=>{{{self._el_js()}if(!el)return false;"
            f"el.scrollIntoView({{block:'center'}});el.click();return true;}})()")
        if not ok:
            raise RuntimeError(f"locator click failed: {self._base} {self._steps}")

    async def is_visible(self):
        return bool(await self._page._eval(
            f"(()=>{{{self._el_js()}if(!el)return false;"
            f"const r=el.getBoundingClientRect(),s=getComputedStyle(el);"
            f"return !!(r.width||r.height)&&s.visibility!=='hidden'"
            f"&&s.display!=='none'&&s.opacity!=='0';}})()"))


class _NDMouse:
    def __init__(self, page):
        self._page = page

    async def wheel(self, dx, dy):
        await self._page._eval(f"window.scrollBy({int(dx)},{int(dy)})")

    async def click(self, x, y):
        await self._page._eval(
            f"(()=>{{const el=document.elementFromPoint({int(x)},{int(y)});"
            f"if(el)el.click();return true;}})()")


class _NDKeyboard:
    def __init__(self, page):
        self._page = page

    async def press(self, key):
        await self._page._eval(
            f"(()=>{{const e=new KeyboardEvent('keydown',{{key:{_js_str(key)},"
            f"keyCode:27,which:27,bubbles:true}});document.dispatchEvent(e);"
            f"document.activeElement&&document.activeElement.dispatchEvent(e);return true;}})()")


class NodriverPage:
    """Adapts a nodriver Tab to the Playwright `page` API subset the scraper uses,
    so demo_login / tab_labels / open_tab / scrape_* / enrich_detail run unchanged."""
    def __init__(self, browser, tab):
        self._browser, self._tab = browser, tab
        self._url = SITE + "/"
        self.mouse = _NDMouse(self)
        self.keyboard = _NDKeyboard(self)

    async def _raw_eval(self, expr):
        """Call nodriver's evaluate; tolerate signature drift across versions."""
        try:
            return await self._tab.evaluate(expr, await_promise=False, return_by_value=True)
        except TypeError:
            return await self._tab.evaluate(expr)

    @staticmethod
    def _unwrap(raw):
        """Reduce nodriver's return (value, RemoteObject, or (RemoteObject, errors)
        tuple) down to the underlying primitive."""
        if isinstance(raw, tuple):
            raw = raw[0] if raw else None
        return getattr(raw, "value", raw)  # RemoteObject → .value; primitives pass through

    async def _eval(self, js):
        """Run a JS expression and return a real Python value.

        nodriver only reliably returns *primitives* by value — arrays/objects can
        come back as an un-iterable RemoteObject. So we JSON-stringify in-page
        (always a string primitive) and parse it here. Returns None for
        undefined/void expressions or in-page errors."""
        wrapped = ("JSON.stringify((()=>{try{return (" + js + ");}"
                   "catch(e){return null;}})())")
        raw = self._unwrap(await self._raw_eval(wrapped))
        if raw is None:
            return None
        if not isinstance(raw, str):
            return raw  # a version that already deserialized — use as-is
        if raw in ("undefined", ""):
            return None
        try:
            return json.loads(raw)
        except Exception:
            return raw

    async def evaluate(self, fn, arg=None):
        """Playwright-style: `fn` is a JS function source; call it with `arg`."""
        call = "" if arg is None else json.dumps(arg)
        return await self._eval(f"({fn})({call})")

    async def goto(self, url, wait_until=None, timeout=None):
        self._tab = await self._browser.get(url)
        self._url = url

    async def wait_for_timeout(self, ms):
        await asyncio.sleep(ms / 1000)

    async def wait_for_selector(self, selector, timeout=10000):
        deadline = time.monotonic() + timeout / 1000
        check = f"(()=>!!document.querySelector({_js_str(selector)}))()"
        while time.monotonic() < deadline:
            try:
                if await self._eval(check):
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.25)
        raise RuntimeError(f"wait_for_selector timeout: {selector}")

    async def query_selector(self, css):
        present = await self._eval(f"(()=>!!document.querySelector({_js_str(css)}))()")
        return _NDElement(self, css) if present else None

    def locator(self, selector):
        return _NDLocator(self, selector)

    async def go_back(self, wait_until=None):
        await self._eval("window.history.back()")

    async def title(self):
        try:
            return await self._eval("document.title") or ""
        except Exception:
            return ""

    @property
    def url(self):
        return self._url

    async def screenshot(self, path=None, full_page=False):
        try:
            await self._tab.save_screenshot(path)
        except Exception:
            pass


async def _nd_export_state(browser, path):
    """Dump nodriver's cookies into Playwright storage_state JSON, so a later
    Playwright engine can reuse the Cloudflare-cleared session (cookie-warmer)."""
    try:
        cookies = await browser.cookies.get_all()
    except Exception as e:
        print(f"  [nodriver] cookie export skipped: {e}", file=sys.stderr)
        return
    same = {"strict": "Strict", "lax": "Lax", "none": "None"}
    out = {"cookies": [], "origins": []}
    for c in cookies:
        try:
            exp = getattr(c, "expires", None)
            out["cookies"].append({
                "name": c.name, "value": c.value,
                "domain": c.domain, "path": getattr(c, "path", "/") or "/",
                "expires": float(exp) if exp not in (None, -1) else -1,
                "httpOnly": bool(getattr(c, "http_only", False)),
                "secure": bool(getattr(c, "secure", False)),
                "sameSite": same.get(str(getattr(c, "same_site", "") or "").split(".")[-1].lower(), "Lax"),
            })
        except Exception:
            continue
    try:
        with open(path, "w") as f:
            json.dump(out, f)
        print(f"  [nodriver] exported {len(out['cookies'])} cookies → {path}")
    except Exception as e:
        print(f"  [nodriver] could not write state: {e}", file=sys.stderr)


async def open_engine(name, headless):
    """Launch one engine. Returns (page, on_login_saved, aclose).
    `on_login_saved` is an async fn(page) to persist the session post-login.
    Raises ModuleNotFoundError if the engine isn't installed."""
    state_kw = {}
    if os.path.exists(STATE_FILE):
        state_kw["storage_state"] = STATE_FILE

    # ---- nodriver (native API, wrapped in the adapter) ----
    if name == "nodriver":
        import nodriver as uc
        nd_args = ["--lang=en-US"]
        pa = proxy_chrome_arg()
        if pa:
            nd_args.append(pa)
            print(f"[nodriver] using proxy {pa}")
        browser = await uc.start(headless=headless, browser_args=nd_args)
        if os.path.exists(STATE_FILE):
            try:  # warm-start: load any saved cookies before first navigation
                data = json.load(open(STATE_FILE))
                params = [uc.cdp.network.CookieParam(
                    name=c["name"], value=c["value"], domain=c.get("domain"),
                    path=c.get("path", "/"), secure=c.get("secure", False),
                    http_only=c.get("httpOnly", False)) for c in data.get("cookies", [])]
                if params:
                    await browser.cookies.set_all(params)
                    print(f"[nodriver] loaded {len(params)} saved cookies")
            except Exception as e:
                print(f"[nodriver] cookie warm-start skipped: {e}", file=sys.stderr)
        tab = await browser.get(SITE + "/")
        page = NodriverPage(browser, tab)

        async def aclose():
            try:
                r = browser.stop()
                if hasattr(r, "__await__"):
                    await r
            except Exception:
                pass

        return page, (lambda p: _nd_export_state(browser, STATE_FILE)), aclose

    # ---- camoufox (stealth Firefox; Playwright API) ----
    if name == "camoufox":
        from camoufox.async_api import AsyncCamoufox
        px = proxy_playwright()
        cf = AsyncCamoufox(headless=headless, **({"proxy": px} if px else {}))
        browser = await cf.__aenter__()
        # No UA override — camoufox supplies a consistent fingerprint itself.
        ctx = await browser.new_context(locale="en-US",
                                        viewport={"width": 1440, "height": 1100},
                                        **({"proxy": px} if px else {}), **state_kw)
        await ctx.route("**/*", block_assets)
        page = await ctx.new_page()

        async def aclose():
            try:
                await ctx.close()
            except Exception:
                pass
            try:
                await cf.__aexit__(None, None, None)
            except Exception:
                pass

        async def save(_p):
            await ctx.storage_state(path=STATE_FILE)
        return page, save, aclose

    # ---- patchright / rebrowser-playwright / stock playwright (Playwright API) ----
    if name == "patchright":
        from patchright.async_api import async_playwright as pw
    elif name in ("rebrowser", "rebrowser-playwright", "rebrowser_playwright"):
        from rebrowser_playwright.async_api import async_playwright as pw
    elif name == "playwright":
        from playwright.async_api import async_playwright as pw
    else:
        raise ValueError(f"unknown engine: {name}")

    px = proxy_playwright()
    p = await pw().start()
    browser = await p.chromium.launch(channel="chrome", headless=headless)
    ctx = await browser.new_context(locale="en-US", user_agent=UA,
                                    viewport={"width": 1440, "height": 1100},
                                    **({"proxy": px} if px else {}), **state_kw)
    await ctx.route("**/*", block_assets)
    page = await ctx.new_page()

    async def aclose():
        for closer in (ctx.close, browser.close, p.stop):
            try:
                await closer()
            except Exception:
                pass

    async def save(_p):
        await ctx.storage_state(path=STATE_FILE)
    return page, save, aclose


async def run_engine(name, args, stop):
    """Bring up one engine, log in, then run the scrape loop on it.
    Returns True if it ran a pass; raises if bring-up/login failed."""
    headless = not args.headed
    if os.path.exists(STATE_FILE):
        print(f"[{name}] reusing saved session: {STATE_FILE}")
    page, save, aclose = await open_engine(name, headless)
    try:
        try:
            await demo_login(page)
        except Exception:
            # A failed login often means the saved session is stale/blocked — drop
            # it so the next engine (or run) starts cold instead of reusing it.
            if os.path.exists(STATE_FILE):
                try:
                    os.remove(STATE_FILE)
                    print(f"[{name}] removed stale session {STATE_FILE}", file=sys.stderr)
                except OSError:
                    pass
            raise
        try:
            await save(page)
            print(f"[{name}] saved session: {STATE_FILE}")
        except Exception as e:
            print(f"[{name}] could not save session: {e}", file=sys.stderr)

        async with httpx.AsyncClient() as client:
            n = 0
            while not stop.is_set():
                t0 = time.monotonic()
                n += 1
                tm, to, nsports = await one_pass(client, page)
                dt = (time.monotonic() - t0) * 1000
                print(f"[{name}] pass {n}: {tm} matches, {to} odds across {nsports} sports in {dt:.0f}ms\n")
                if args.loop <= 0:
                    break
                sleep = max(0, args.loop - (time.monotonic() - t0))
                try:
                    await asyncio.wait_for(stop.wait(), timeout=sleep)
                except asyncio.TimeoutError:
                    pass
        return True
    finally:
        print(f"[{name}] shutting down (browser closing)...")
        await aclose()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=float, default=0, help="seconds between passes (0 = single pass)")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--engine", help="force one engine (overrides D247_ENGINES)")
    args = ap.parse_args()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    engines = [args.engine.strip().lower()] if args.engine else ENGINE_ORDER
    last_err = None
    for name in engines:
        if stop.is_set():
            break
        try:
            await run_engine(name, args, stop)
            return  # an engine carried the whole run; done
        except ModuleNotFoundError as e:
            print(f"[{name}] not installed ({e}); trying next engine", file=sys.stderr)
        except Exception as e:
            last_err = e
            print(f"[{name}] failed: {e}; trying next engine\n", file=sys.stderr)
            # A nodriver run that cleared Cloudflare leaves cookies in STATE_FILE,
            # so subsequent Playwright engines get a warm start automatically.
    if last_err:
        print(f"all engines exhausted; last error: {last_err}", file=sys.stderr)
        sys.exit(1)
    print("no engine available — install one of: "
          "patchright, rebrowser-playwright, camoufox, playwright, nodriver", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""Diamond Exch (d247.com) page scraper → ZeroApi ingest, tagged provider=diamondexch.

d247 is an AES-encrypted betting *exchange* SPA behind Cloudflare. We can't hit
its JSON API (responses are CryptoJS-encrypted), but the SPA decrypts and renders
to the DOM — so, like the melbet page scraper, we drive real Chrome, log in via
the public **demo ID**, and read the rendered `.bet-table-row` event rows.

Per sport (`/all-sports/{etid}`) we read each row's match name, start time and the
Match-Odds back prices (1 / X / 2 columns) and POST them to the backend ingest API.

    python scrape_d247.py                 # one (full) pass
    python scrape_d247.py --loop 5        # fast native odds harvest every ~5s
    python scrape_d247.py --headed        # watch it

Architecture keeps odds in ~real time without re-doing slow work each loop:
  • STREAMING (default): PARK each of D247_WORKERS tabs on a sport and continuously
    DRAIN the decrypted native buffer the SPA keeps refilling on its own poll —
    no DOM scroll, no re-clicking, no detail nav. With tabs >= sports every sport
    streams in parallel, so odds reach the API gated only by d247's poll rate
    (~1-2s). The native list payload is the COMPLETE match set + Match-Odds ladders
    regardless of DOM virtualization, so streaming needs no scrolling at all.
  • FULL pass (every D247_FULL_EVERY seconds, default 120): sidebar/featured/
    header catalog + DOM admin snapshot + detail-page Fancy/Bookmaker enrichment.
Set D247_STREAM=0 to fall back to the older fast/full tab-cycling cadence.

Env: BACKEND_URL (default http://localhost:8081), INGEST_KEY (default dev-ingest-key),
     D247_WORKERS (default 4; raise it to stream more sports 1:1),
     D247_STREAM (default 1), D247_STREAM_INTERVAL (default 0.4s),
     D247_FULL_EVERY (default 120), D247_ADMIN_SNAPSHOT (default 1)
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
        // Take the DESKTOP odd columns BY POSITION so a row keeps its full column
        // shape whether priced, dashed or padlocked (a suspended row must not
        // vanish). Fall back to all odd cells if the desktop variant isn't there.
        // NB: do NOT use [class*="lock"] — it also matches Bootstrap "block"
        // classes (d-block, inline-block) → every cell looks locked. Use specific
        // padlock / suspended markers only.
        const lockSel = '.fa-lock, .fa-lock-alt, i.icon-lock, .icon-lock, .suspended-box, [class*="suspend" i], [class*="padlock" i]';
        const isDash = t => { const c = (t || '').replace(/\s+/g, ' ').trim(); return c === '' || c === '-' || c === '--'; };
        let cols = [...row.querySelectorAll('.bet-nation-odd:not(.d-xl-none)')];
        if (!cols.length) cols = [...row.querySelectorAll('.bet-nation-odd')];
        const backs = cols.map(c => { const b = c.querySelector('.back .bet-odd b'); return b ? num(b.innerText) : null; });
        const lays  = cols.map(c => { const b = c.querySelector('.lay .bet-odd b');  return b ? num(b.innerText) : null; });
        // Per-cell lock: padlock/suspended-box element, or a dash where a price
        // should be. Lets individual outcomes be flagged suspended.
        const colSusp = cols.map(c => {
            if (c.querySelector(lockSel)) return true;
            if (c.querySelector('.back .bet-odd b') || c.querySelector('.lay .bet-odd b')) return false;
            return isDash(c.innerText);
        });
        // Row is suspended when it shows a padlock, or every odd cell is locked.
        const rowLock = !!row.querySelector(lockSel);
        const allDead = cols.length > 0 && colSusp.every(Boolean);
        const susp = rowLock || allDead;
        const live = !!row.querySelector('.icon-tv');
        out.push({ href, name, date, labels, backs, lays, colSusp, susp, live });
    });
    return out;
}
"""

# Scroll the VIRTUALIZED event list. d247 renders rows only while in (or near)
# the viewport, so we must scroll the actual scroll CONTAINER (an inner div, not
# the window) to force every row to render at least once. Returns scroll metrics
# so the Python loop knows when the bottom has been reached.
SCROLL_JS = r"""
(dy) => {
    const rows = document.querySelectorAll('.bet-table-row');
    let cont = null;
    if (rows.length) {
        let el = rows[rows.length - 1].parentElement;
        while (el && el !== document.body) {
            const s = getComputedStyle(el);
            if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
                el.scrollHeight > el.clientHeight + 20) { cont = el; break; }
            el = el.parentElement;
        }
    }
    const t = cont || document.scrollingElement || document.documentElement;
    t.scrollTop += dy;
    window.scrollBy(0, dy);   // also nudge the window in case the page itself grows
    // Fallback that advances virtualization even when no scroll container was
    // found: pull the last rendered row to the edge so the next batch mounts.
    if (!cont && rows.length) {
        try { rows[dy >= 0 ? rows.length - 1 : 0].scrollIntoView({ block: dy >= 0 ? 'end' : 'start' }); } catch (e) {}
    }
    return { top: Math.round(t.scrollTop), height: Math.round(t.scrollHeight),
             client: Math.round(t.clientHeight), rows: rows.length, container: !!cont };
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
        // Best-effort etid: the sport links to /all-sports/{etid} (events supply
        // the authoritative etid for sports that have matches).
        let etid = 0;
        for (const link of li.querySelectorAll('a[href]')) {
            const h = link.getAttribute('href') || '';
            const mm = h.match(/all-sports\/(\d+)/) || h.match(/sport[s]?\/(\d+)/);
            if (mm) { etid = parseInt(mm[1], 10) || 0; break; }
        }
        const leagues = [];
        const seenL = new Set();
        li.querySelectorAll('ul a span').forEach(le => {
            const ln = clean(le.innerText);
            if (ln && ln !== name && ln.length < 60 && !seenL.has(ln)) { seenL.add(ln); leagues.push(ln); }
        });
        out.push({ name, etid, leagues: leagues.slice(0, 50) });
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

# Read d247's HEADER match strip (the matches shown in the page header / ticker,
# distinct from the main body list). We flag these by id so the API can serve
# them at /v1/diamondexch/headermatches. Defensive: scan event anchors inside
# header / ticker / upcoming / marquee containers.
HEADER_JS = r"""
() => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const evRe = /\/(game-details|market|race|sport-event|event)\/\d+/;
    const sels = [
        '[class*="header" i] a[href]', '[class*="ticker" i] a[href]',
        '[class*="upcoming" i] a[href]', '[class*="marquee" i] a[href]',
        '[class*="topbar" i] a[href]', '[class*="top-bar" i] a[href]',
    ];
    let anchors = [];
    for (const s of sels) { try { anchors.push(...document.querySelectorAll(s)); } catch (e) {} }
    const out = [], seen = new Set();
    for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (!evRe.test(href)) continue;
        const name = clean(a.innerText);
        if (!name || name.length < 2 || name.length > 90) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        out.push({ href, name });
    }
    return out;
}
"""

# Team separators in priority order: " v "/" vs "/" @ " (real matches),
# then " - " (esports / virtual "Team (e) - Team" format).
SEPARATORS = [" v ", " vs ", " @ ", " - "]

# How many live matches to enrich with full detail-page markets per pass.
DETAIL_CAP = int(os.environ.get("D247_DETAIL_CAP", "25"))

# Number of parallel worker PAGES (tabs in the same logged-in browser context)
# used to sweep sports / enrich details concurrently. Real concurrency: each page
# scrapes a different sport at the same time, so a full refresh — and therefore
# the odds reaching the API — completes ~N× faster (near-real-time). 1 = the old
# sequential single-page behavior. Tunable via D247_WORKERS (default 4); the pool
# shares one Cloudflare session, so keep it modest.
D247_WORKERS = max(1, int(os.environ.get("D247_WORKERS", "4")))

# How often (seconds) to run the EXPENSIVE "full" pass: the sidebar/featured/
# header catalog, the DOM admin snapshot, and detail-page enrichment for Fancy/
# Bookmaker markets. Between full passes EVERY loop runs only the cheap native
# list harvest (no DOM scroll), so Match-Odds reach the API near-real-time. The
# full pass refreshes the slow-changing structure + extra markets. Default 120s;
# set 0 to make every pass a full pass (legacy behavior).
D247_FULL_EVERY = float(os.environ.get("D247_FULL_EVERY", "120"))

# Streaming mode (default ON): instead of re-clicking every sport tab each pass,
# PARK each worker tab on a sport and continuously DRAIN the decrypted native
# buffer the SPA keeps refilling on its own poll. With enough tabs every live
# sport streams in parallel in real time (gated only by d247's own poll rate),
# collapsing odds latency from minutes to ~1-2s. Set 0 for the older fast/full
# tab-cycling cadence.
D247_STREAM = os.environ.get("D247_STREAM", "1") != "0"

# Drain tick (seconds) for a parked single-sport tab — how often we read the
# buffer between the SPA's polls. Kept small; the real floor is d247's poll rate.
D247_STREAM_INTERVAL = float(os.environ.get("D247_STREAM_INTERVAL", "0.4"))

# Push the DOM-derived admin snapshot (post_snapshot) during full passes. The
# PUBLIC diamondexch API reads ONLY the native table (fed every fast pass), so
# this snapshot exists purely for the admin dashboard and is the one thing that
# still needs the slow full-list scroll. On by default (keeps the dashboard
# working); set 0 to skip it and make even full passes much faster.
D247_ADMIN_SNAPSHOT = os.environ.get("D247_ADMIN_SNAPSHOT", "1") != "0"

# Grace window (seconds) before a match missing from a sweep is retired. Set
# generously so a pass that only captured part of d247's scroll-virtualized list
# never drops matches that are still on the site; only matches genuinely gone for
# this long age out. ~0 disables (immediate retire). Default 360s (6 min).
SWEEP_GRACE_SECONDS = int(os.environ.get("D247_SWEEP_GRACE", "360"))

# ── Native capture ────────────────────────────────────────────────────────────
# d247's API responses are CryptoJS-encrypted, but the app DECRYPTS them and
# JSON.parse()s the result before rendering. We wrap JSON.parse (installed before
# any app script via add_init_script) and stash every decrypted API payload that
# carries match data. This hands us the EXACT native feed — cname, cid, mid, sid,
# matched size, clean stime, full market ladders (back1/2/3, lay1/2/3), and every
# market type (Bookmaker, Fancy, oddeven, …) — with no DOM parsing and no need to
# break the encryption ourselves.
#   window.__dxlist   = [ data, … ]   from list endpoints (data.t1 / data.t2)
#   window.__dxdetail = { gmid: [markets] }  from detail endpoints (data.odds)
CAPTURE_HOOK = r"""
(() => {
  if (window.__dxHooked) return; window.__dxHooked = true;
  window.__dxlist = []; window.__dxdetail = {};
  const orig = JSON.parse;
  JSON.parse = function (t) {
    const v = orig.apply(this, arguments);
    try {
      const d = v && v.data;
      if (d) {
        if (Array.isArray(d.t1) || Array.isArray(d.t2)) {
          window.__dxlist.push({ t1: d.t1 || [], t2: d.t2 || [] });
          if (window.__dxlist.length > 60) window.__dxlist.shift();
        }
        if (d.odds && typeof d.odds === 'object' && !Array.isArray(d.odds)) {
          for (const g in d.odds) window.__dxdetail[g] = d.odds[g];
        }
      }
    } catch (e) {}
    return v;
  };
})();
"""


def _num(x):
    try:
        f = float(x)
        return f if f == f and f not in (float("inf"), float("-inf")) else None
    except (TypeError, ValueError):
        return None


def _oname_idx(oname):
    m = re.search(r"(\d+)", oname or "")
    return int(m.group(1)) if m else 1


def native_market_to_lean(mkt):
    """Convert ONE native market object (gmid match-obj from a list, or a market
    from data.odds) into our lean market: { market, gtype, suspended,
    runners:[{nat, suspended, back:[{odds,size}], lay:[{odds,size}]}] }."""
    mname = (mkt.get("mname") or "Market").strip() or "Market"
    gtype = mkt.get("gtype") or "match"
    msusp = str(mkt.get("status", "")).upper() == "SUSPENDED"
    runners = []
    for s in mkt.get("section", []) or []:
        nat = (s.get("nat") or "").strip()
        if not nat:
            continue
        backs, lays = [], []
        for o in s.get("odds", []) or []:
            price = _num(o.get("odds"))
            if price is None or price < 1.0:
                continue
            entry = ({"odds": round(price, 3), "size": _num(o.get("size")) or 0},
                     _oname_idx(o.get("oname")))
            if str(o.get("otype", "")).lower() == "back":
                backs.append(entry)
            elif str(o.get("otype", "")).lower() == "lay":
                lays.append(entry)
        backs.sort(key=lambda e: e[1])  # back1, back2, back3 …
        lays.sort(key=lambda e: e[1])
        rsusp = msusp or str(s.get("gstatus", "")).upper() == "SUSPENDED"
        runners.append({
            "nat": nat, "sid": s.get("sid") or 0, "suspended": rsusp,
            "back": [e[0] for e in backs], "lay": [e[0] for e in lays],
        })
    return {"market": mname, "gtype": gtype, "mid": mkt.get("mid") or 0,
            "suspended": msusp, "runners": runners}


def native_match_to_event(mm, sport_name):
    """A native LIST match object (carries the MATCH_ODDS market inline) → our
    d247 ingest event, with full native fields (cname/cid/mid/size/stime)."""
    gmid = mm.get("gmid")
    gmid = int(gmid) if isinstance(gmid, int) or (isinstance(gmid, str) and gmid.isdigit()) else None
    if gmid is None:
        return None  # skip casino/lottery rows whose gmid is a slug
    ename = (mm.get("ename") or "").strip()
    teams = split_teams(ename)
    home, away = teams if teams else (ename, "")
    return {
        "gmid": gmid,
        "etid": mm.get("etid") or 0,
        "sport": sport_name or "",
        "cid": mm.get("cid") or 0,
        "cname": (mm.get("cname") or "").strip(),
        "ename": ename, "home": home, "away": away,
        "iplay": bool(mm.get("iplay")),
        "stime": mm.get("stime"),
        "suspended": str(mm.get("status", "")).upper() == "SUSPENDED",
        "featured": bool(mm.get("f")),
        "header": False,
        # The list match-obj IS the MATCH_ODDS market.
        "markets": [native_market_to_lean(mm)],
    }


# etid → sport name, filled from the sidebar catalog (which carries both).
ETID_NAME = {}


async def collect_native_events(page):
    """Read the JSON.parse-captured native LIST payloads and return events grouped
    by etid (sport). Dedupes by gmid (last-seen wins). Clears the buffer."""
    try:
        payloads = await page.evaluate("() => { const x = window.__dxlist || []; window.__dxlist = []; return x; }")
    except Exception:
        return {}
    by_gmid = {}
    for pl in payloads or []:
        for arr in (pl.get("t1") or [], pl.get("t2") or []):
            for mm in arr:
                etid = mm.get("etid") or 0
                ev = native_match_to_event(mm, ETID_NAME.get(etid, sport_name_for_etid(etid)))
                if ev:
                    by_gmid[ev["gmid"]] = ev
    groups = {}
    for ev in by_gmid.values():
        groups.setdefault(ev["etid"], []).append(ev)
    return groups


def sport_name_for_etid(etid):
    """Best-effort name when the sidebar map doesn't have it."""
    known = {4: "Cricket", 1: "Football", 2: "Tennis", 8: "Table Tennis"}
    return known.get(etid, f"Sport {etid}")


async def collect_native_detail(page, gmid):
    """Read the captured native DETAIL markets (data.odds[gmid]) for one match and
    return a list of lean markets (ALL markets: Match Odds ladder, Bookmaker,
    Fancy, oddeven, …). Empty if the detail wasn't captured."""
    try:
        raw = await page.evaluate(
            "(g) => { const d = (window.__dxdetail || {})[g]; return d || null; }", str(gmid)
        )
    except Exception:
        raw = None
    if not raw:
        # Some builds key the dict by int; try the numeric form too.
        try:
            raw = await page.evaluate("(g) => (window.__dxdetail || {})[g] || null", gmid)
        except Exception:
            raw = None
    if not raw:
        return []
    return [native_market_to_lean(mkt) for mkt in raw]


async def post_d247_native(client, source, events, sweep=False):
    """POST already-built native events (from capture) to /api/ingest/d247.
    Grace is 0 → each scrape REPLACES the sport's set wholesale: stale rows are
    deleted immediately so the API only ever serves the freshest scrape."""
    payload = {
        "source": source, "events": events, "sweep": sweep,
        "sweep_grace_seconds": 0,
    }
    try:
        r = await client.post(
            f"{BACKEND_URL}/api/ingest/d247",
            headers={"X-Ingest-Key": INGEST_KEY},
            json=payload, timeout=30,
        )
        r.raise_for_status()
        return len(events)
    except Exception as e:
        print(f"  d247 native POST failed ({source}): {e}", file=sys.stderr)
        return 0

# Read a match DETAIL page: live scorecard + every market (Match Odds back/lay,
# Bookmaker, Fancy/session/odd-even) with best back & lay prices.
EXTRACT_DETAIL_JS = r"""
() => {
    const clean = s => (s || '').replace(/\s+/g, ' ').trim();
    const num = s => { const n = parseFloat(clean(s).replace(',', '.')); return isNaN(n) ? null : n; };
    const header = document.querySelector('.game-header');
    const score = header ? clean(header.innerText).slice(0, 200) : null;
    // Specific lock markers only — [class*="lock"] also matches "block" classes.
    const lockSel = '.fa-lock, .fa-lock-alt, i.icon-lock, .icon-lock, .suspended-box, [class*="suspend" i], [class*="padlock" i]';
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


def etid_from_href(href):
    """First numeric segment of /game-details/{etid}/{id} → sport/event-type id."""
    nums = re.findall(r"/(\d+)", href or "")
    return int(nums[0]) if len(nums) >= 2 else None


def sport_etid(sport):
    """Fallback sport→etid map when the href doesn't carry it (d247 ids)."""
    s = (sport or "").lower()
    if "cricket" in s:
        return 4
    if "table" in s and "tennis" in s:
        return 8
    if "tennis" in s:
        return 2
    if "soccer" in s or "football" in s:
        return 1
    return 0


def to_native_event(m):
    """Convert an internal match dict (build_match/build_event output) into a d247
    NATIVE event for the dedicated diamondexch_events table: event header + lean
    markets [{ market, gtype, suspended, runners:[{nat,suspended,back,lay}] }].
    Each market's runners group the internal odds rows by outcome (team/runner),
    with back/lay as ascending price LEVELS [{odds,size}]."""
    gmid = m.get("ext_id")
    if gmid is None:
        return None  # no stable id → can't key the native row
    href = m.get("_href") or ""
    etid = etid_from_href(href) or sport_etid(m.get("sport"))
    home = m.get("home") or ""
    away = m.get("away") or ""
    ename = f"{home} v {away}" if away else home

    order, groups = [], {}
    for o in m.get("markets", []):
        mk = o.get("market") or "Match Odds"
        if mk not in groups:
            groups[mk] = {}
            order.append(mk)
        nat = o.get("outcome") or ""
        # Key runners case-insensitively so "ARCS Andheri" (detail) doesn't become
        # a 2nd runner next to "Arcs Andheri" (list). Keep the first-seen display.
        rkey = nat.strip().lower()
        r = groups[mk].get(rkey)
        if r is None:
            r = {"nat": nat, "suspended": False, "back": [], "lay": []}
            groups[mk][rkey] = r
        back, lay, size = o.get("value"), o.get("lay"), o.get("volume")
        if back is not None and back >= 1.0:
            r["back"].append({"odds": back, "size": size or 0})
        if lay is not None and lay >= 1.0:
            r["lay"].append({"odds": lay, "size": size or 0})
        if o.get("suspended"):
            r["suspended"] = True

    markets = []
    for mk in order:
        runners = list(groups[mk].values())
        # Ground truth for "locked": a runner with NO back AND NO lay price can't
        # be bet → suspended. This is exactly what d247 shows ("- -"), and it's
        # immune to selector quirks in the list lock-icon detection.
        for rr in runners:
            rr["suspended"] = not rr["back"] and not rr["lay"]
        msusp = bool(runners) and all(rr["suspended"] for rr in runners)
        gtype = "fancy1" if ("fancy" in mk.lower() or "session" in mk.lower()) else "match"
        markets.append({"market": mk, "gtype": gtype, "suspended": msusp, "runners": runners})

    # The event is suspended only when NOTHING is priced anywhere.
    has_price = any((rr["back"] or rr["lay"]) for mm in markets for rr in mm["runners"])

    return {
        "gmid": gmid, "etid": etid, "sport": m.get("sport") or "",
        "cid": 0, "cname": m.get("league") or "",
        "ename": ename, "home": home, "away": away,
        "iplay": m.get("status") == "live",
        "stime": m.get("time"),
        "suspended": not has_price,
        "featured": bool(m.get("featured")),
        "header": False,
        "markets": markets,
    }


async def post_d247(client, source, matches, sweep=False, featured_ids=None,
                    header_ids=None, clear_featured=False, clear_header=False):
    """POST events to the dedicated d247 native ingest (/api/ingest/d247), which
    stores them in `diamondexch_events`. The public diamondexch API reads ONLY
    this table; we still also POST the shared snapshot (post_snapshot) so the
    admin dashboard keeps working. Returns the number of events sent."""
    events = [e for e in (to_native_event(m) for m in matches) if e]
    payload = {
        "source": source, "events": events, "sweep": sweep,
        "sweep_grace_seconds": SWEEP_GRACE_SECONDS if sweep else 0,
    }
    if featured_ids is not None:
        payload["featured_ids"] = featured_ids
        payload["clear_featured"] = clear_featured
    if header_ids is not None:
        payload["header_ids"] = header_ids
        payload["clear_header"] = clear_header
    try:
        r = await client.post(
            f"{BACKEND_URL}/api/ingest/d247",
            headers={"X-Ingest-Key": INGEST_KEY},
            json=payload,
            timeout=30,
        )
        r.raise_for_status()
        return len(events)
    except Exception as e:
        print(f"  d247 POST failed ({source}): {e}", file=sys.stderr)
        return 0


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
    name = card.get("name") or ""
    # Strip a trailing " / DD/MM/YYYY HH:MM:SS" date that some rows append to the
    # name, plus any leftover trailing slash.
    name = re.sub(r"\s*/\s*\d{1,2}/\d{1,2}/\d{2,4}.*$", "", name)
    name = re.sub(r"\s*/\s*$", "", name).strip()
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
    col_susp = card.get("colSusp") or []
    # The list 1/X/2 columns ARE the exchange Match Odds market. Store them under
    # "Match Odds" with the TEAM NAME as the outcome (1→home, 2→away, X→Draw), so
    # (a) the API's native Match-Odds sections pick them up — without this every
    # prematch match renders locked — and (b) list odds dedupe cleanly with the
    # detail page's Match Odds (which also uses team names as runners).
    label_to_nat = {"1": home, "2": away, "X": "Draw"}
    markets = []
    for i, b in enumerate(backs):
        label = labels[i] if i < len(labels) else None
        nat = label_to_nat.get(label)
        if not nat:
            continue
        lay = lays[i] if i < len(lays) else None
        cell_susp = susp or (bool(col_susp[i]) if i < len(col_susp) else False)
        # Emit the outcome whenever it has a price OR is locked — a suspended
        # line is real data the user wants (so they see "locked", not a gap).
        if (b is None or b < 1.0) and (lay is None or lay < 1.0) and not cell_susp:
            continue
        markets.append({
            "market": "Match Odds", "outcome": nat,
            "value": round(float(b), 3) if (b is not None and b >= 1.0) else 0,
            "lay": round(float(lay), 3) if (lay is not None and lay >= 1.0) else None,
            "volume": None, "param": None, "suspended": cell_susp,
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


# Page-title markers for a Cloudflare/Chrome error shell (NOT the real app). When
# we see one, the cure is to RELOAD, not to keep polling for a button that will
# never render. "Reload a page" is Chrome's net-error page; "Just a moment" /
# "Attention Required" are Cloudflare interstitials.
ERROR_SHELL_MARKERS = (
    "reload", "just a moment", "attention required", "error",
    "isn't working", "not work", "verify you are human", "blocked",
)


async def _looks_like_error_shell(page):
    try:
        t = (await page.title() or "").lower()
    except Exception:
        return True  # couldn't even read the title → treat as broken
    return any(k in t for k in ERROR_SHELL_MARKERS)


async def demo_login(page, deadline_s=90):
    """Open d247, wait out Cloudflare, and start a demo session.

    Resilient to: slow Cloudflare challenges (polls instead of a fixed sleep),
    button-text changes (multiple candidate selectors), an already-live session,
    AND the transient Cloudflare/Chrome "Reload a page" error shell — which we
    RELOAD through instead of fruitlessly waiting for a login button. Raises a
    clear RuntimeError with diagnostics only after exhausting reloads."""
    async def nav():
        try:
            await page.goto(f"{SITE}/", wait_until="domcontentloaded", timeout=60000)
        except Exception:
            pass

    await nav()
    start = time.monotonic()
    clicked = False
    reloads = 0
    last_reload = time.monotonic()
    while time.monotonic() - start < deadline_s:
        # Already inside? (Cloudflare may auto-restore a session, or a prior pass
        # left us logged in.) Then there's nothing to click.
        if await _is_logged_in(page):
            print("demo session ready (already logged in):", page.url)
            await dismiss_modal(page)
            return

        # On a Cloudflare/Chrome error shell, or stuck for >15s, reload and retry.
        bad = await _looks_like_error_shell(page)
        if bad or (time.monotonic() - last_reload) > 15:
            reloads += 1
            last_reload = time.monotonic()
            try:
                await page.reload(wait_until="domcontentloaded", timeout=60000)
            except Exception:
                await nav()
            await page.wait_for_timeout(2500)
            continue

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

        # SPA bundle / Cloudflare JS still loading — wait a beat and re-check.
        await page.wait_for_timeout(2000)

    if not clicked and not await _is_logged_in(page):
        await _diagnose_login(page, f"no demo-login control appeared (after {reloads} reloads)")
        raise RuntimeError(
            "d247 demo login failed: none of the demo-login selectors matched "
            f"within {deadline_s}s / {reloads} reloads (see /tmp/d247_login_fail.png "
            "and the button list above — Cloudflare block or changed login markup)."
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
    # The detail page's .game-header text is the live scoreboard (it also repeats
    # the team names). Put it in `period`, NOT `time` — `time` must stay the clean
    # start-time string from the list, else stime gets polluted with team names.
    if detail.get("score"):
        m["period"] = detail["score"][:160]
    # Carry the event-level suspended flag from the detail page.
    if detail.get("suspended"):
        m["suspended"] = True
    # Dedupe runners case/space-insensitively so the detail page's UPPERCASE team
    # names don't create a second runner alongside the list's title-case ones.
    norm = lambda mk, oc: (mk.strip().lower(), oc.strip().lower())
    seen = {norm(o["market"], o["outcome"]) for o in m["markets"]}
    added = 0
    for o in detail_to_odds(detail):
        key = norm(o["market"], o["outcome"])
        if key not in seen:
            m["markets"].append(o)
            seen.add(key)
            added += 1
    return added > 0 or bool(detail.get("score")) or bool(detail.get("suspended"))


async def post_snapshot(client, source, matches, sweep=False):
    # NB: matches may carry an internal "_href" key — the ingest API ignores
    # unknown fields, and Phase 2 still needs it, so we leave it in place.
    # `sweep=True` tells the backend this is the COMPLETE set for these sports,
    # so any earlier match in them that is not here is retired (marked dead).
    # Only the full per-sport list sets it — never a partial/detail snapshot.
    #
    # `sweep_grace_seconds` softens that retirement: a match missing from THIS
    # pass is only dropped once it has gone un-scraped for the grace window. So a
    # pass that captured only part of the (scroll-virtualized) list does NOT kill
    # matches that are still on d247 — they keep being re-upserted next pass and
    # only genuinely-gone matches age out. This is what keeps a match visible to
    # the user "until it actually disappears from the d247 website".
    try:
        r = await client.post(
            f"{BACKEND_URL}/api/ingest/snapshot",
            headers={"X-Ingest-Key": INGEST_KEY},
            json={"source": source, "provider": PROVIDER, "matches": matches,
                  "sweep": sweep, "sweep_grace_seconds": SWEEP_GRACE_SECONDS if sweep else 0},
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
        # Native d247 table: store the full sports CATALOG (name + best-effort
        # etid) so /sports + /sidebar list every sport, not just ones with
        # current matches. sweep_sports makes the catalog authoritative each pass.
        catalog = [{"name": s["name"], "etid": int(s.get("etid") or 0)} for s in sports]
        # Build etid → name so native-capture events get a sport name.
        for c in catalog:
            if c["etid"]:
                ETID_NAME[c["etid"]] = c["name"]
        try:
            cr = await client.post(
                f"{BACKEND_URL}/api/ingest/d247",
                headers={"X-Ingest-Key": INGEST_KEY},
                json={"source": "d247-sidebar", "events": [],
                      "sports": catalog, "sweep_sports": True},
                timeout=30,
            )
            cr.raise_for_status()
        except Exception as e:
            print(f"  sidebar d247 catalog POST failed: {e}", file=sys.stderr)
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
        # Native d247 table: upsert any special shells + flag featured by id.
        await post_d247(client, "d247-featured", shells,
                        featured_ids=ids, clear_featured=True)
        print(f"  featured: {len(ids)} flagged, {len(shells)} special-market shells")
        return len(ids) + len(shells)
    except Exception as e:
        print(f"  featured POST failed: {e}", file=sys.stderr)
        return 0


async def scrape_header(client, page):
    """Phase 0.6: read the HEADER match strip and flag those matches so the API
    serves them at /v1/diamondexch/headermatches. Flag-by-id (matches also exist
    via the main sweep); `clear_header` makes the strip authoritative each pass."""
    try:
        items = await page.evaluate(HEADER_JS)
    except Exception as e:
        print(f"  header eval error: {e}", file=sys.stderr)
        return 0
    ids, seen = [], set()
    for it in (items or []):
        eid = event_id_from_href(it.get("href") or "")
        if eid is not None and eid not in seen:
            seen.add(eid)
            ids.append(eid)
    if not ids:
        print("  header: none found")
        return 0
    try:
        r = await client.post(
            f"{BACKEND_URL}/api/ingest/snapshot",
            headers={"X-Ingest-Key": INGEST_KEY},
            json={"source": "d247-header", "provider": PROVIDER,
                  "matches": [], "header_ids": ids, "clear_header": True},
            timeout=30,
        )
        r.raise_for_status()
        # Native d247 table: flag header matches by id.
        await post_d247(client, "d247-header", [], header_ids=ids, clear_header=True)
        print(f"  header: {len(ids)} matches flagged")
        return len(ids)
    except Exception as e:
        print(f"  header POST failed: {e}", file=sys.stderr)
        return 0


async def scrape_sport(client, page, idx, sport):
    """Phase 1: list sweep for one sport. Returns (matches, odds, live_dicts).

    d247's event list is scroll-VIRTUALIZED: rows render as they enter the
    viewport and de-render once scrolled away, so a single extract only sees one
    screenful. We extract repeatedly WHILE scrolling down and accumulate every
    row by href, capturing the full list (including rows whose odds are all "-").
    """
    # Clear the native-capture buffer BEFORE navigating so what we read after the
    # tab opens belongs to THIS sport (d247 polls frequently; a shared buffer fills
    # with other sports' payloads otherwise).
    try:
        await page.evaluate("() => { window.__dxlist = []; }")
    except Exception:
        pass
    if not await open_tab(page, idx, light=True):  # we drive our own scroll below
        return 0, 0, []
    # Start at the very top of the list (scroll the container up hard).
    try:
        await page.evaluate(SCROLL_JS, -200000)
        await page.wait_for_timeout(300)
    except Exception:
        pass

    def absorb(cards):
        for c in cards or []:
            m = build_match(c, sport)
            if m:
                # Key by href when present (events share an empty away team).
                key = m.get("_href") or (m["home"], m["away"])
                seen[key] = m

    seen = {}
    stale = 0          # consecutive scroll steps that added no new match
    bottom_hits = 0    # consecutive steps already at the container bottom
    last_top = -1
    # Scroll the virtualized container all the way down, extracting at each step.
    # We only stop once we've reached the bottom AND stopped finding new rows —
    # so the WHOLE list is captured, not just the first screenful. Hard cap is
    # generous (long cricket/soccer lists can be 200+ rows).
    for _ in range(400):
        try:
            absorb(await page.evaluate(EXTRACT_JS))
        except Exception as e:
            print(f"  [{sport}] eval error: {e}", file=sys.stderr)
        before = len(seen)
        try:
            info = await page.evaluate(SCROLL_JS, 900)
        except Exception:
            info = None
        await page.wait_for_timeout(200)

        stale = 0 if len(seen) > before else stale + 1
        if info:
            at_bottom = info["top"] + info["client"] >= info["height"] - 60
            moved = info["top"] != last_top
            last_top = info["top"]
            bottom_hits = bottom_hits + 1 if at_bottom else 0
            # Done when we've sat at the bottom a couple steps with nothing new,
            # or the list won't scroll any further and has gone stale.
            if (bottom_hits >= 2 and stale >= 2) or (not moved and stale >= 4):
                break
        elif stale >= 6:
            break
    # One final extract at the resting position to catch the last rows.
    try:
        absorb(await page.evaluate(EXTRACT_JS))
    except Exception:
        pass

    matches = list(seen.values())
    if not matches:
        print(f"  [{sport}] no matches/events")
        return 0, 0, []
    # Targets to enrich with detail-page markets: live matches, plus any
    # single-entity event (race/outright) whose runners only exist on the
    # detail page. Both must carry a detail href.
    live = [m for m in matches
            if m.get("_href") and (m["status"] == "live" or m.get("_event"))]
    # Full list for this sport → sweep: retire matches in this sport that are
    # no longer listed (so the next API response shows only the current set).
    src = f"d247-{sport.lower().replace(' ', '-')}"
    # Admin/shared snapshot is the only consumer of the scrolled DOM; the PUBLIC
    # API reads the native table. Skip it when D247_ADMIN_SNAPSHOT=0 to save a POST.
    mm, oo = (await post_snapshot(client, src, matches, sweep=True)
              if D247_ADMIN_SNAPSHOT else (0, 0))
    # The d247 NATIVE table is fed from the JSON.parse capture (full fidelity:
    # cname/cid/mid/sid/size/ladders) collected NOW for THIS sport.
    bufn = await native_buffer_size(page)
    nat = await collect_and_post_native_sport(client, page, sport)
    # FALLBACK: if the native capture saw nothing (e.g. d247 decrypts in a Web
    # Worker our main-thread hook can't observe), feed diamondexch_events from the
    # DOM matches we already scraped — Match Odds still get to the public API.
    src_used = "native"
    if nat == 0 and matches:
        nat = await post_d247(client, src, matches, sweep=True)
        src_used = "dom"
    print(f"  [{sport}] {len(matches)} matches → {mm} upserted, {oo} odds "
          f"({len(live)} live, {nat} {src_used}, buf={bufn})")
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
    src = f"d247-{sport.lower().replace(' ', '-')}-detail"
    if changed:
        await post_snapshot(client, src, [m])   # shared (admin), DOM-derived
    # NATIVE detail: the app fetched gamedetailPrivate when we opened the page →
    # the JSON.parse hook captured the FULL market tree (Match Odds ladder,
    # Bookmaker, Fancy, oddeven, …). Post that to the d247 table — full fidelity.
    gmid = m.get("ext_id")
    if gmid is not None:
        markets = await collect_native_detail(page, gmid)
        if markets:
            ename = m.get("name") or f"{m.get('home','')} v {m.get('away','')}"
            ev = {
                "gmid": gmid, "etid": etid_from_href(href) or sport_etid(sport),
                "sport": sport, "cid": 0, "cname": "",
                "ename": ename, "home": m.get("home") or "", "away": m.get("away") or "",
                "iplay": m.get("status") == "live", "stime": m.get("time"),
                "suspended": all(mk.get("suspended") for mk in markets),
                "featured": False, "header": False, "markets": markets,
            }
            await post_d247_native(client, src, [ev])
            changed = True
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

    # Phase 0.6 — read the header match strip and flag header matches.
    await scrape_header(client, page)

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


async def collect_native_sport_events(page, sport):
    """Drain the native-capture buffer (just THIS sport's list payload, since the
    caller cleared it before navigating) and return de-duped native events. The
    decrypted t1/t2 arrays are the COMPLETE match list for the sport regardless of
    DOM virtualization — so this needs no scroll."""
    try:
        payloads = await page.evaluate("() => { const x = window.__dxlist || []; window.__dxlist = []; return x; }")
    except Exception:
        return []
    by_gmid = {}
    for pl in payloads or []:
        for arr in (pl.get("t1") or [], pl.get("t2") or []):
            for mm in arr:
                ev = native_match_to_event(mm, sport)
                if ev:
                    by_gmid[ev["gmid"]] = ev
    return list(by_gmid.values())


async def post_native_sport_events(client, sport, events, sweep=True):
    """POST native events for one sport to the d247 table, grouped per etid (so
    each etid's set is swept/replaced wholesale)."""
    if not events:
        return 0
    groups = {}
    for ev in events:
        groups.setdefault(ev["etid"], []).append(ev)
    src = f"d247-native-{sport.lower().replace(' ', '-')}"
    total = 0
    for etid, evs in groups.items():
        total += await post_d247_native(client, src, evs, sweep=sweep)
    return total


async def collect_and_post_native_sport(client, page, sport):
    """Drain the native buffer for THIS sport and POST it (sweep)."""
    events = await collect_native_sport_events(page, sport)
    return await post_native_sport_events(client, sport, events)


# ═══════════════════════════════════════════════════════════════════════════
# Parallel pass — a pool of worker PAGES scrape different sports concurrently.
# ═══════════════════════════════════════════════════════════════════════════
# Each page is an independent tab in the SAME logged-in context (shared cookies +
# localStorage demo session). We fan the sports out across the pool with a shared
# queue and asyncio.gather: while page A waits on a render/scroll, page B is
# already scraping its sport. The per-sport snapshot is POSTed the instant that
# sport is done, so fresh odds hit the API continuously through the pass instead
# of only at the end — collapsing the odds-to-API delay toward real time.

async def _drain_queue(queue, worker_label, handler):
    """Pop (item) off `queue` and run `handler(item)` until empty. One coroutine
    per worker page; exceptions in a handler are logged, never fatal."""
    while True:
        try:
            item = queue.get_nowait()
        except asyncio.QueueEmpty:
            return
        try:
            await handler(item)
        except Exception as e:
            print(f"  [{worker_label}] task error: {e}", file=sys.stderr)
        finally:
            queue.task_done()


async def sweep_parallel(client, pages, labels):
    """Phase 1, parallel: each worker page pulls sports off a shared queue and
    sweeps them concurrently. Returns (total_matches, total_odds, live_targets)."""
    queue = asyncio.Queue()
    for idx, sport in enumerate(labels):
        queue.put_nowait((idx, sport))

    totals = {"m": 0, "o": 0}
    live_targets = []  # (idx, sport, match_dict)
    agg = asyncio.Lock()

    def make_handler(page, wid):
        async def handle(item):
            idx, sport = item
            m, o, live = await scrape_sport(client, page, idx, sport)
            async with agg:
                totals["m"] += m
                totals["o"] += o
                for lm in live:
                    live_targets.append((idx, sport, lm))
        return handle

    await asyncio.gather(*(
        _drain_queue(queue, f"w{wid}", make_handler(page, wid))
        for wid, page in enumerate(pages)
    ))
    return totals["m"], totals["o"], live_targets


async def enrich_parallel(client, pages, live_targets):
    """Phase 2, parallel: distribute live/event detail enrichment across the page
    pool. Each worker re-opens the sport tab on ITS page, so they don't collide."""
    if not live_targets:
        return 0
    queue = asyncio.Queue()
    for t in live_targets:
        queue.put_nowait(t)

    done = {"n": 0}
    agg = asyncio.Lock()

    def make_handler(page, wid):
        async def handle(item):
            idx, sport, lm = item
            if await enrich_detail(client, page, idx, sport, lm):
                async with agg:
                    done["n"] += 1
        return handle

    await asyncio.gather(*(
        _drain_queue(queue, f"w{wid}", make_handler(page, wid))
        for wid, page in enumerate(pages)
    ))
    return done["n"]


# ═══════════════════════════════════════════════════════════════════════════
# Fast pass — drain the native odds buffer with NO DOM scroll, every loop.
# ═══════════════════════════════════════════════════════════════════════════
# d247's SPA polls its (encrypted) list endpoint and our JSON.parse hook stashes
# the DECRYPTED payload into window.__dxlist continuously. The payload's t1/t2
# arrays carry the COMPLETE match set + Match-Odds ladders for the selected tab,
# independent of which rows the virtualized DOM has rendered. So to get fresh
# odds we only need to: switch to the sport tab, wait for the poll to land, and
# read the buffer — no 400-step scroll, no detail navigation. This collapses a
# per-sport sweep from seconds to ~1-2s, so Match-Odds reach the API near-real-
# time. Structure + Fancy/Bookmaker are refreshed by the throttled full pass.

async def await_native(page, deadline_s=4.0):
    """Wait (adaptively) until the SPA has polled the current tab's list endpoint
    and the decrypted payload has landed in __dxlist. Returns True if data
    arrived before the deadline."""
    end = time.monotonic() + deadline_s
    while time.monotonic() < end:
        try:
            n = await page.evaluate(
                "() => (window.__dxlist||[]).reduce("
                "(a,p)=>a+((p.t1||[]).length+(p.t2||[]).length),0)")
        except Exception:
            n = 0
        if n:
            # Brief settle so a split t1/t2 poll is fully captured before we read.
            await page.wait_for_timeout(150)
            return True
        await page.wait_for_timeout(200)
    return False


async def native_buffer_size(page):
    """How many match rows are currently sitting in the captured native buffer.
    -1 on error. Used for diagnostics: if this is persistently 0 the JSON.parse
    hook is not seeing d247's decrypted payloads (e.g. decryption moved to a Web
    Worker) and we must fall back to the DOM."""
    try:
        return await page.evaluate(
            "() => (window.__dxlist||[]).reduce("
            "(a,p)=>a+((p.t1||[]).length+(p.t2||[]).length),0)")
    except Exception:
        return -1


async def harvest_dom_matches(page, sport, max_steps=12):
    """Scroll-extract the virtualized list into match dicts via the DOM (EXTRACT_JS).
    Bounded + lighter than the full-pass sweep. This is the RELIABLE feed when the
    native JSON.parse capture comes back empty — the rows always render even when
    we can't see the decrypted API payload."""
    seen = {}

    def absorb(cards):
        for c in cards or []:
            m = build_match(c, sport)
            if m:
                key = m.get("_href") or (m["home"], m["away"])
                seen[key] = m

    try:
        await page.evaluate(SCROLL_JS, -200000)  # jump to top
        await page.wait_for_timeout(200)
    except Exception:
        pass
    stale = 0
    for _ in range(max_steps):
        try:
            absorb(await page.evaluate(EXTRACT_JS))
        except Exception:
            pass
        before = len(seen)
        try:
            await page.evaluate(SCROLL_JS, 900)
        except Exception:
            pass
        await page.wait_for_timeout(150)
        stale = 0 if len(seen) > before else stale + 1
        if stale >= 3:
            break
    try:
        absorb(await page.evaluate(EXTRACT_JS))
    except Exception:
        pass
    return list(seen.values())


async def park_tab(page, idx):
    """Click the idx-th sport tab once so the SPA starts polling that sport's
    (encrypted) list endpoint. Resilient to a re-appearing banner and to the page
    having been left on a detail route (then we navigate home first). Returns
    True once the tab is selected."""
    link = page.locator(TAB_STRIP).nth(idx).locator("a.nav-link")
    try:
        await link.click(timeout=6000)
        return True
    except Exception:
        pass
    await dismiss_modal(page)
    try:
        await link.click(timeout=4000)
        return True
    except Exception:
        pass
    try:  # last resort: the page wandered off the home list — go back and retry.
        await page.goto(f"{SITE}/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(1200)
        await dismiss_modal(page)
        await page.locator(TAB_STRIP).nth(idx).locator("a.nav-link").click(timeout=6000)
        return True
    except Exception:
        return False


async def scrape_sport_native(client, page, idx, sport):
    """Fast-pass sweep of one sport: switch to its tab, wait for the decrypted
    list poll, harvest the native buffer (NO scroll), and POST it (sweep).
    Returns the number of native events posted."""
    try:
        await page.evaluate("() => { window.__dxlist = []; }")
    except Exception:
        pass
    if not await park_tab(page, idx):
        return 0
    await await_native(page)
    events = await collect_native_sport_events(page, sport)
    if events:
        return await post_native_sport_events(client, sport, events)
    # Native capture empty → fall back to the DOM (rows still render). This keeps
    # diamondexch_events fed (Match Odds) even when the JSON.parse hook is blind.
    matches = await harvest_dom_matches(page, sport, max_steps=10)
    if matches:
        return await post_d247(client, f"d247-{sport.lower().replace(' ', '-')}",
                               matches, sweep=True)
    return 0


# ── Streaming workers: parked tabs + continuous drain ───────────────────────────
async def _stream_worker(client, page, assigned, stop, deadline):
    """One worker page's stream loop. `assigned` is the list of (idx, sport) this
    page owns. If it owns ONE sport it parks there and drains every SPA poll —
    pure real-time streaming, no re-clicking. If it owns several (fewer pages than
    sports), it round-robins them, parking each just long enough for one poll."""
    if not assigned:
        return
    single = len(assigned) == 1
    pos = 0
    parked_idx = None
    while not stop.is_set() and time.monotonic() < deadline:
        idx, sport = assigned[pos]
        if parked_idx != idx:
            try:
                await page.evaluate("() => { window.__dxlist = []; }")
            except Exception:
                pass
            if not await park_tab(page, idx):
                pos = (pos + 1) % len(assigned)
                await page.wait_for_timeout(300)
                continue
            parked_idx = idx
        # Wait for the next decrypted poll to land (buffer was cleared on park /
        # after the previous drain), then harvest + POST.
        got = await await_native(page, deadline_s=4.0)
        if got:
            await collect_and_post_native_sport(client, page, sport)
        if single:
            # Parked: stay put, just pace the next read against d247's poll rate.
            await page.wait_for_timeout(int(D247_STREAM_INTERVAL * 1000))
        else:
            # Rotate to the next owned sport (re-click it next iteration).
            pos = (pos + 1) % len(assigned)
            parked_idx = None


async def stream_until(client, pages, labels, stop, deadline):
    """Distribute sports across the worker pages (round-robin) and run every
    page's stream loop concurrently until `deadline`. With pages >= sports each
    page owns exactly one sport → every sport streams in parallel in real time."""
    if not labels:
        return
    buckets = [[] for _ in pages]
    for i, sport in enumerate(labels):
        buckets[i % len(pages)].append((i, sport))
    npark = sum(1 for b in buckets if len(b) == 1)
    print(f"  streaming {len(labels)} sports across {len(pages)} tabs "
          f"({npark} parked 1:1) until next full pass", flush=True)
    await asyncio.gather(*(
        _stream_worker(client, pages[w], buckets[w], stop, deadline)
        for w in range(len(pages))
    ))


async def fast_pass_parallel(client, pages):
    """Fast pass across the worker-page pool: each page pulls sports off a shared
    queue and harvests the native odds buffer for each (no scroll, no detail)."""
    primary = pages[0]
    labels = await tab_labels(primary)
    if not labels:
        print("  no sport tabs found", file=sys.stderr)
        return 0, 0
    queue = asyncio.Queue()
    for idx, sport in enumerate(labels):
        queue.put_nowait((idx, sport))
    totals = {"n": 0}
    agg = asyncio.Lock()

    def make_handler(page, wid):
        async def handle(item):
            idx, sport = item
            nat = await scrape_sport_native(client, page, idx, sport)
            async with agg:
                totals["n"] += nat
        return handle

    await asyncio.gather(*(
        _drain_queue(queue, f"w{wid}", make_handler(page, wid))
        for wid, page in enumerate(pages)
    ))
    return totals["n"], len(labels)


async def fast_pass(client, page):
    """Single-page fast pass: harvest the native odds buffer for every sport."""
    labels = await tab_labels(page)
    if not labels:
        print("  no sport tabs found", file=sys.stderr)
        return 0, 0
    total = 0
    for idx, sport in enumerate(labels):
        total += await scrape_sport_native(client, page, idx, sport)
    return total, len(labels)


async def one_pass_parallel(client, pages):
    """A full pass using the worker-page pool. Phase 0 stays on the primary page
    (cheap, single-shot); Phases 1 and 2 fan out across all pages."""
    primary = pages[0]
    # Phase 0 — catalog/featured/header from the primary page (single source).
    await scrape_sidebar(client, primary)
    await scrape_featured(client, primary)
    await scrape_header(client, primary)

    labels = await tab_labels(primary)
    if not labels:
        print("  no sport tabs found", file=sys.stderr)
        return 0, 0, 0

    # Phase 1 — parallel list sweep across ALL sports.
    total_m, total_o, live_targets = await sweep_parallel(client, pages, labels)

    # Native capture is collected per-sport inside scrape_sport (each on its own
    # worker page, buffer cleared before each navigation).

    # Phase 2 — parallel detail enrichment (bounded by cap, live first).
    targets = live_targets[:DETAIL_CAP]
    enriched = await enrich_parallel(client, pages, targets)
    if live_targets:
        print(f"  detail-enriched {enriched}/{len(targets)} live matches "
              f"(across {len(pages)} pages)")
    return total_m, total_o, len(labels)


async def open_worker_pages(new_page, n):
    """Open up to n-1 EXTRA worker pages in the same context and make sure each is
    past the login wall (they share the session cookies/localStorage, so a goto +
    modal dismiss is usually enough; fall back to a full demo_login if not)."""
    extra = []
    for i in range(max(0, n - 1)):
        try:
            p = await new_page()
            await p.goto(f"{SITE}/", wait_until="domcontentloaded", timeout=60000)
            await p.wait_for_timeout(800)
            await dismiss_modal(p)
            if not await _is_logged_in(p):
                await demo_login(p)
            extra.append(p)
            print(f"  worker page {i + 2}/{n} ready")
        except Exception as e:
            print(f"  worker page {i + 2}/{n} failed: {e}; continuing with fewer",
                  file=sys.stderr)
            break
    return extra


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

    async def reload(self, wait_until=None, timeout=None):
        # nodriver has no direct reload in our adapter; re-navigate to current url.
        await self.goto(self._url)

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
    """Launch one engine. Returns (page, on_login_saved, aclose, new_page).
    `on_login_saved` is an async fn(page) to persist the session post-login.
    `new_page` is an async fn() that opens another page in the SAME context (for
    the parallel worker pool), or None if the engine can't (nodriver).
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

        # nodriver: no shared-context multi-page support here → sequential only.
        return page, (lambda p: _nd_export_state(browser, STATE_FILE)), aclose, None

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
        await ctx.add_init_script(CAPTURE_HOOK)
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

        # ctx.route already applies to every page (incl. ones opened later).
        async def new_page():
            return await ctx.new_page()
        return page, save, aclose, new_page

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
    await ctx.add_init_script(CAPTURE_HOOK)
    page = await ctx.new_page()

    async def aclose():
        for closer in (ctx.close, browser.close, p.stop):
            try:
                await closer()
            except Exception:
                pass

    async def save(_p):
        await ctx.storage_state(path=STATE_FILE)

    # ctx.route already applies to every page (incl. ones opened later).
    async def new_page():
        return await ctx.new_page()
    return page, save, aclose, new_page


async def run_engine(name, args, stop):
    """Bring up one engine, log in, then run the scrape loop on it.
    Returns True if it ran a pass; raises if bring-up/login failed."""
    headless = not args.headed
    if os.path.exists(STATE_FILE):
        print(f"[{name}] reusing saved session: {STATE_FILE}")
    page, save, aclose, new_page = await open_engine(name, headless)
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

        # Build the parallel worker-page pool (extra tabs in the same logged-in
        # context). Each scrapes a different sport concurrently → odds reach the
        # API ~Nx faster. Falls back to a single page if the engine can't spawn
        # pages (nodriver) or D247_WORKERS=1.
        pages = [page]
        if D247_WORKERS > 1 and new_page is not None:
            pages.extend(await open_worker_pages(new_page, D247_WORKERS))
        if len(pages) > 1:
            print(f"[{name}] parallel mode: {len(pages)} worker pages")
        else:
            print(f"[{name}] sequential mode (1 page)")

        async with httpx.AsyncClient() as client:
            n = 0
            while not stop.is_set():
                t0 = time.monotonic()
                n += 1
                # FULL pass: structure (sidebar/featured/header) + detail-page
                # Fancy/Bookmaker markets + native odds for every sport. Always run
                # first so the catalog exists, then refreshed each cycle.
                if len(pages) > 1:
                    tm, to, nsports = await one_pass_parallel(client, pages)
                else:
                    tm, to, nsports = await one_pass(client, page)
                dt = (time.monotonic() - t0) * 1000
                print(f"[{name}] FULL pass {n}: {tm} matches, {to} odds "
                      f"across {nsports} sports in {dt:.0f}ms\n")
                if args.loop <= 0:
                    break

                # Steady state until the next full pass is due. Odds stream here.
                deadline = time.monotonic() + max(0.0, D247_FULL_EVERY)
                if D247_STREAM:
                    # Park each tab on a sport and continuously drain the decrypted
                    # native buffer → odds reach the API in ~real time (no scroll,
                    # no re-clicking, no detail nav).
                    labels = await tab_labels(page)
                    await stream_until(client, pages, labels, stop, deadline)
                else:
                    # Older cadence: repeat cheap tab-cycling fast passes.
                    while not stop.is_set() and time.monotonic() < deadline:
                        ts = time.monotonic()
                        if len(pages) > 1:
                            nat, nsp = await fast_pass_parallel(client, pages)
                        else:
                            nat, nsp = await fast_pass(client, page)
                        print(f"[{name}] fast pass: {nat} native events across "
                              f"{nsp} sports in {(time.monotonic()-ts)*1000:.0f}ms")
                        slp = max(0, args.loop - (time.monotonic() - ts))
                        try:
                            await asyncio.wait_for(stop.wait(), timeout=slp)
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

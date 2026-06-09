#!/usr/bin/env python3
"""1win sportsbook scraper → ZeroApi ingest, tagged provider=1win.

Unlike 1xbet/betwinner/megapari (1xbet-family skins that reuse the melbet DOM
engine), **1win runs its own platform**. Its sportsbook is powered by the
**top-parser** feed service. The live "list page" feed bundles matches AND their
odds inline in one clean JSON document — no login, no browser, no Cloudflare:

  GET https://match-storage-partners.top-parser.com/lp-feed
        ?lang=en&matchesLimit=100&localeId=2
  -> {"feed":[ {sportId, sportName, matches:[ {
        homeTeamName, awayTeamName, categoryName (league), dateOfMatch,
        gameScore{Sc1,Sc2}, matchScore{Sc1,Sc2}, status, service:"LIVE",
        oddGroups:[ {name, odds:[ {name, coefficient, value, outCome, blocked} ]} ]
     } ] } ] }

`coefficient` is the decimal odd; `value` (when present) is the line/param for
totals & handicaps; `outCome` is a stable short code (1/x/2/over/under/...).

Discovery note: 1win also exposes `api-gateway.top-parser.com` with
`POST /matches/get-many` (match listings, NO odds) and a Socket.IO push stream
(`wss://api-gateway.top-parser.com/push-server-v2/`) carrying `match-odds-snapshot`
deltas for both live & prematch. The `lp-feed` REST snapshot is the simplest
odds-complete source, so the scraper is built around it. Both LIVE and prematch
matches in the feed are ingested (status "live"/"prematch"); odds flagged
`blocked` are emitted as suspended (locked) lines rather than dropped, and a
match whose every odd is blocked is marked suspended at the match level.
See probe_1win.py for the full network capture used to find these.

    python scrape_1win.py --dry-run     # extract + print, no POST
    python scrape_1win.py               # one pass → ingest
    python scrape_1win.py --loop 20     # repeat every 20s

Env: BACKEND_URL, INGEST_KEY, ONEWIN_BASE_URL, ONEWIN_FEED, ONEWIN_FEED_LIMIT
"""
import argparse
import os
import sys
import time

import httpx

from _ingest import sidebar_payload

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8081").rstrip("/")
INGEST_KEY = os.environ.get("INGEST_KEY", "dev-ingest-key")
PROVIDER = "1win"

# Mirror domain used only for Origin/Referer (anti-bot friendliness). The feed
# host itself is the provider-agnostic top-parser CDN.
BASE = os.environ.get("ONEWIN_BASE_URL", "https://1win.pro").rstrip("/")
FEED = os.environ.get(
    "ONEWIN_FEED", "https://match-storage-partners.top-parser.com/lp-feed"
).rstrip("/")
# The feed silently returns an empty document above ~100; 100 is the sweet spot.
FEED_LIMIT = int(os.environ.get("ONEWIN_FEED_LIMIT", "100"))

CHUNK = 80  # matches per ingest POST

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Origin": BASE,
    "Referer": f"{BASE}/",
    "Accept": "application/json",
}


def fetch_feed(client):
    """One GET → the full live feed document {"feed":[ {sport, matches[]} ]}."""
    r = client.get(
        FEED,
        params={"lang": "en", "matchesLimit": FEED_LIMIT, "localeId": 2},
        headers=HEADERS,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def _to_int(x):
    try:
        return int(str(x).strip())
    except (TypeError, ValueError):
        return None


def _line(value):
    """`value` carries the totals/handicap line as a string, e.g. '2.5' / '-0.5'."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# JS Number.MAX_SAFE_INTEGER — the backend stores ext_id as a JS-safe integer.
_JS_SAFE_MAX = 9007199254740991


def _ext_id(m):
    """The feed's numeric match/event id, as a JS-safe integer, else None.

    Prefer the per-match id (matchId), fall back to eventId. Any id that is
    not a positive integer within the JS-safe range is rejected so we never
    send a value the backend (or a JS client) would round/lose."""
    for key in ("matchId", "eventId", "id"):
        n = _to_int(m.get(key))
        if n is not None and 0 < n <= _JS_SAFE_MAX:
            return n
    return None


def build_match(sport_name, m):
    """Map one 1win feed match → an ingest match dict (or None if unusable)."""
    home = (m.get("homeTeamName") or "").strip()
    away = (m.get("awayTeamName") or "").strip()
    if not home or not away:
        return None  # skip outrights / single-competitor markets

    league = (m.get("categoryName") or m.get("tournamentName") or "").strip() or None

    # Live score: matchScore is the main scoreline (e.g. goals / total runs);
    # gameScore is the current game/point. Prefer matchScore.
    ms = m.get("matchScore") or {}
    gs = m.get("gameScore") or {}
    hs = _to_int(ms.get("Sc1"))
    as_ = _to_int(ms.get("Sc2"))
    if hs is None and as_ is None:
        hs, as_ = _to_int(gs.get("Sc1")), _to_int(gs.get("Sc2"))

    status_text = (m.get("status") or "").strip() or None
    # service is LIVE for the live page feed; map to our status vocabulary.
    # Prematch matches carry the same odds shape, so they are ingested too.
    is_live = (m.get("service") or "").upper() == "LIVE"
    status = "live" if is_live else "prematch"

    # Scheduled start time (epoch seconds/ms or ISO string) for prematch rows.
    start = m.get("dateOfMatch") or m.get("startTime") or m.get("date")

    odds = []
    seen = set()
    n_blocked = 0
    for g in m.get("oddGroups") or []:
        gname = (g.get("name") or "Market")[:60]
        for o in g.get("odds") or []:
            try:
                val = float(o.get("coefficient"))
            except (TypeError, ValueError):
                val = None
            blocked = bool(o.get("blocked"))
            # Blocked odds are emitted as suspended (locked) lines so the API
            # can report them. Their value is the coefficient if it's a real
            # odd (>=1.0), else 0 to signal "no priceable line".
            if blocked:
                value = round(val, 3) if (val is not None and val >= 1.0) else 0
                n_blocked += 1
            else:
                if val is None or val < 1.0:
                    continue
                value = round(val, 3)
            line = _line(o.get("value"))
            oname = (o.get("name") or o.get("outCome") or "").strip()
            if not oname:
                continue
            oname = oname[:80]
            key = (gname, oname, line)
            if key in seen:
                continue
            seen.add(key)
            try:
                vol = float(o.get("volume"))
            except (TypeError, ValueError):
                vol = None
            odds.append({
                "market": gname,
                "outcome": oname,
                "value": value,
                "param": line,
                "suspended": blocked,
                "lay": None,
                "volume": vol,
            })
    if not odds:
        return None

    # If every emitted odd is blocked, the whole match is suspended.
    match_suspended = n_blocked == len(odds)

    # Prefer the scheduled start time for prematch; live keeps period/clock text.
    time_field = status_text if is_live else (start or status_text)

    return {
        "ext_id": _ext_id(m),  # feed's numeric id when present, else backend hashes
        "sport": sport_name or "Other",
        "league": league,
        "home": home,
        "away": away,
        "status": status,
        "suspended": match_suspended,
        "home_score": hs,
        "away_score": as_,
        "time": time_field,  # live: period/clock text; prematch: scheduled start
        "period": status_text,
        "home_logo": None,
        "away_logo": None,
        "sport_logo": None,
        "league_logo": None,
        "markets": odds,
    }


def extract(doc):
    """Whole feed document → list of ingest match dicts."""
    out = []
    for sport in doc.get("feed") or []:
        sname = sport.get("sportName") or "Other"
        for m in sport.get("matches") or []:
            built = build_match(sname, m)
            if built:
                out.append(built)
    return out


def feed_tree(doc):
    """Whole feed → sports-tree (every sport + its leagues/categories), incl.
    sports whose individual matches were filtered out of `extract`."""
    tree = {}
    for sport in doc.get("feed") or []:
        sname = (sport.get("sportName") or "Other").strip()
        leagues = tree.setdefault(sname, set())
        for m in sport.get("matches") or []:
            lg = (m.get("categoryName") or m.get("tournamentName") or "").strip()
            if lg:
                leagues.add(lg)
    return [{"name": s, "leagues": [{"name": l} for l in sorted(ls)]}
            for s, ls in sorted(tree.items())]


def post_sidebar(client, tree):
    try:
        r = client.post(
            f"{BACKEND_URL}/api/ingest/snapshot",
            headers={"X-Ingest-Key": INGEST_KEY},
            json=sidebar_payload(PROVIDER, tree),
            timeout=30,
        )
        r.raise_for_status()
        b = r.json()
        return b.get("sports", 0), b.get("leagues", 0)
    except Exception as e:
        print(f"  sidebar POST failed: {e}", file=sys.stderr)
        return 0, 0


def post_chunks(client, source, matches):
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


def one_pass(client, dry_run):
    doc = fetch_feed(client)
    matches = extract(doc)
    tree = feed_tree(doc)
    total_odds = sum(len(m["markets"]) for m in matches)
    tree_leagues = sum(len(s["leagues"]) for s in tree)

    live = [m for m in matches if m["status"] == "live"]
    prematch = [m for m in matches if m["status"] != "live"]
    susp_matches = sum(1 for m in matches if m["suspended"])
    susp_odds = sum(1 for m in matches for o in m["markets"] if o["suspended"])

    if dry_run:
        print(f"[dry-run] extracted {len(matches)} matches "
              f"({len(live)} live / {len(prematch)} prematch), {total_odds} odds "
              f"({susp_odds} suspended in {susp_matches} fully-locked matches) "
              f"(feed sports: {len(doc.get('feed') or [])}); "
              f"sports-tree: {len(tree)} sports, {tree_leagues} leagues")
        for m in matches[:3]:
            ex = m["markets"][:3]
            print(f"  · [{m['sport']}] {m['home']} vs {m['away']} "
                  f"({m['league']}) [{m['status']}/{m['time']}] "
                  f"id={m['ext_id']} susp={m['suspended']} "
                  f"score={m['home_score']}-{m['away_score']} "
                  f"{len(m['markets'])} odds")
            for o in ex:
                print(f"        {o['market']} / {o['outcome']} = {o['value']}"
                      + (f" (line {o['param']})" if o['param'] is not None else "")
                      + (" [SUSPENDED]" if o['suspended'] else ""))
        return len(matches), total_odds

    lm, lo = post_chunks(client, "1win-live", live)
    pm, po = post_chunks(client, "1win-prematch", prematch)
    sp, lg = post_sidebar(client, tree)
    m, o = lm + pm, lo + po
    print(f"[1win] {len(matches)} matches extracted "
          f"({len(live)} live / {len(prematch)} prematch) → {m} upserted, {o} odds "
          f"({susp_odds} suspended); sidebar {sp} sports / {lg} leagues")
    return m, o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=float, default=0,
                    help="seconds between passes (0 = single pass)")
    ap.add_argument("--dry-run", action="store_true",
                    help="extract + print, do not POST to the backend")
    # --headed kept for CLI parity with the browser-based scrapers; this scraper
    # is pure HTTP (no browser), so it is accepted but has no effect.
    ap.add_argument("--headed", action="store_true",
                    help="(no-op: scrape_1win is a pure-HTTP scraper)")
    args = ap.parse_args()

    with httpx.Client(http2=False) as client:
        print(f"1win feed: {FEED} (limit {FEED_LIMIT}); provider={PROVIDER}")
        n = 0
        while True:
            t0 = time.monotonic()
            n += 1
            try:
                m, o = one_pass(client, args.dry_run)
                dt = (time.monotonic() - t0) * 1000
                print(f"pass {n}: {m} matches, {o} odds in {dt:.0f}ms\n")
            except Exception as e:
                print(f"pass {n} error: {e}", file=sys.stderr)
            if args.loop <= 0:
                break
            time.sleep(max(0, args.loop - (time.monotonic() - t0)))


if __name__ == "__main__":
    main()

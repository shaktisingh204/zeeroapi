#!/usr/bin/env python3
"""BC.Game sportsbook scraper → ZeroApi ingest, tagged provider=bcgame.

BC.Game's sportsbook is powered by **BetBy**, whose odds come from a public
**sptpub** JSON API keyed by a brand id — no login, no browser, no Cloudflare.
We follow BetBy's version-cursor protocol:

  GET /api/v4/{prematch|live}/brand/{BRAND}/en/0   -> {top_events_versions, rest_events_versions}
  GET /api/v4/{prematch|live}/brand/{BRAND}/en/{version}  -> {sports, tournaments, events{ desc, markets }}
  GET /api/v3/descriptions/brand/{BRAND}/markets/en  -> market + outcome name maps

Each event: desc.competitors[0/1] = home/away, desc.sport/tournament -> names,
markets[typeId][specifier][outcomeId] = {k: decimal_odds}.

    python scrape_bcgame.py            # one pass (prematch + live)
    python scrape_bcgame.py --loop 60

Env: BACKEND_URL, INGEST_KEY, BCGAME_BRAND, BCGAME_SPTPUB_API
"""
import argparse
import os
import re
import sys
import time

import httpx

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8081").rstrip("/")
INGEST_KEY = os.environ.get("INGEST_KEY", "dev-ingest-key")
PROVIDER = "bcgame"
BRAND = os.environ.get("BCGAME_BRAND", "2103509236163162112")
API = os.environ.get("BCGAME_SPTPUB_API", "https://api-k-c7818b61-623.sptpub.com").rstrip("/")
SPT_HEADERS = {"User-Agent": "Mozilla/5.0", "Origin": "https://bcigra.com", "Referer": "https://bcigra.com/"}
CHUNK = 80  # matches per ingest POST


def fetch(client, path):
    r = client.get(f"{API}{path}", headers=SPT_HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def _outcomes_from_variants(variants):
    """`variants` may be a dict{variantKey:[{outcomes}]} or a list[{outcomes}]."""
    omap = {}
    entries = variants.values() if isinstance(variants, dict) else (variants or [])
    for entry in entries:
        for e in (entry if isinstance(entry, list) else [entry]):
            if isinstance(e, dict):
                for o in e.get("outcomes", []) or []:
                    if isinstance(o, dict) and o.get("id") is not None:
                        omap[str(o["id"])] = o.get("name")
    return omap


def load_market_descriptions(client):
    """marketTypeId -> {name, outcomes:{outcomeId:name}}."""
    md = fetch(client, f"/api/v3/descriptions/brand/{BRAND}/markets/en")
    out = {}
    for mid, d in md.items():
        if not isinstance(d, dict):
            continue
        out[str(mid)] = {
            "name": d.get("name") or f"Market {mid}",
            "outcomes": _outcomes_from_variants(d.get("variants")),
        }
    return out


def collect(client, kind):
    """Follow the version cursors and merge all buckets for prematch|live."""
    head = fetch(client, f"/api/v4/{kind}/brand/{BRAND}/en/0")
    versions = (head.get("top_events_versions") or []) + (head.get("rest_events_versions") or [])
    sports, tours, events = {}, {}, {}
    for v in versions:
        try:
            bk = fetch(client, f"/api/v4/{kind}/brand/{BRAND}/en/{v}")
        except Exception as e:
            print(f"  [{kind}] bucket {v} failed: {e}", file=sys.stderr)
            continue
        sports.update(bk.get("sports", {}))
        tours.update(bk.get("tournaments", {}))
        events.update(bk.get("events", {}))
    return sports, tours, events


def spec_line(spec):
    """Pull a numeric line out of a specifier like 'total=8.5' or 'hcp=-1.5'."""
    m = re.search(r"=(-?\d+(?:\.\d+)?)", spec or "")
    return float(m.group(1)) if m else None


def spec_values(spec):
    """Parse a BetBy specifier 'inningnr=1|overnr=5|total=2.5' into a dict."""
    return dict(kv.split("=", 1) for kv in (spec or "").split("|") if "=" in kv)


_PLACEHOLDER = re.compile(r"\{([^}]+)\}")


def resolve_name(name, vals, home, away):
    """Fill BetBy name templates: {$competitor1/2} -> team names, {!key}/{key}/{+key}
    -> specifier values. Unknown placeholders are left intact."""
    if not name or "{" not in name:
        return name

    def repl(m):
        token = m.group(1)
        key = token.lstrip("!+-$")
        if key == "competitor1":
            return home
        if key == "competitor2":
            return away
        return vals.get(key, m.group(0))

    return _PLACEHOLDER.sub(repl, name).strip()


def _to_int(x):
    try:
        return int(str(x).strip())
    except (TypeError, ValueError):
        return None


def build_matches(events, sports, tours, markets, status):
    out = []
    for ev in events.values():
        d = ev.get("desc", {})
        comps = d.get("competitors", [])
        if d.get("type") != "match" or len(comps) != 2:
            continue  # skip outrights / stages / single-competitor
        home = (comps[0] or {}).get("name")
        away = (comps[1] or {}).get("name")
        if not home or not away:
            continue
        sport = (sports.get(str(d.get("sport"))) or {}).get("name") or "Other"
        league = (tours.get(str(d.get("tournament"))) or {}).get("name")

        # Live score + clock (powers auto-results: the last live score before the
        # match leaves the feed is its final score).
        hs = as_ = None
        match_time = None
        if status == "live":
            sc = ev.get("score") or {}
            hs, as_ = _to_int(sc.get("home_score")), _to_int(sc.get("away_score"))
            match_time = ((ev.get("state") or {}).get("clock") or {}).get("match_time")

        odds = []
        seen = set()
        for mtid, specs in (ev.get("markets") or {}).items():
            desc = markets.get(str(mtid), {})
            raw_mname = desc.get("name") or f"Market {mtid}"
            omap = desc.get("outcomes", {})
            for spec, outs in (specs or {}).items():
                vals = spec_values(spec)
                line = spec_line(spec)
                mname = resolve_name(raw_mname, vals, home, away)[:60]
                for oid, od in (outs or {}).items():
                    try:
                        val = float(od.get("k"))
                    except (TypeError, ValueError):
                        continue
                    if val < 1.0:
                        continue
                    oname = resolve_name(omap.get(str(oid)) or str(oid), vals, home, away)[:80]
                    key = (mname, oname, line)
                    if key in seen:
                        continue
                    seen.add(key)
                    odds.append({"market": mname, "outcome": oname,
                                 "value": round(val, 3), "param": line})
        if not odds:
            continue
        out.append({
            "ext_id": None,  # let the backend hash provider+sport+home+away (JS-safe id)
            "sport": sport, "league": league,
            "home": home, "away": away, "status": status,
            "home_score": hs, "away_score": as_,
            "time": match_time, "period": None, "markets": odds,
            "home_logo": None, "away_logo": None, "sport_logo": None, "league_logo": None,
        })
    return out


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


def one_pass(client, markets):
    grand_m = grand_o = 0
    for kind, status in (("prematch", "prematch"), ("live", "live")):
        sports, tours, events = collect(client, kind)
        matches = build_matches(events, sports, tours, markets, status)
        m, o = post_chunks(client, f"bcgame-{kind}", matches)
        print(f"  [{kind}] {len(events)} events → {len(matches)} matches, {m} upserted, {o} odds")
        grand_m += m
        grand_o += o
    return grand_m, grand_o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loop", type=float, default=0, help="seconds between passes (0 = single pass)")
    args = ap.parse_args()

    with httpx.Client(http2=False) as client:
        markets = load_market_descriptions(client)
        print(f"loaded {len(markets)} market descriptions; brand={BRAND}")
        n = 0
        while True:
            t0 = time.monotonic()
            n += 1
            try:
                m, o = one_pass(client, markets)
                dt = (time.monotonic() - t0) * 1000
                print(f"pass {n}: {m} matches, {o} odds in {dt:.0f}ms\n")
            except Exception as e:
                print(f"pass {n} error: {e}", file=sys.stderr)
            if args.loop <= 0:
                break
            time.sleep(max(0, args.loop - (time.monotonic() - t0)))


if __name__ == "__main__":
    main()

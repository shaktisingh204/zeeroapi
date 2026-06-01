#!/usr/bin/env python3
"""Confirm we can map a real 2-team match's markets/outcomes to readable names."""
import json, httpx

BRAND = "2103509236163162112"
API = "https://api-k-c7818b61-623.sptpub.com"
H = {"User-Agent": "Mozilla/5.0", "Origin": "https://bcigra.com", "Referer": "https://bcigra.com/"}


def get(path):
    r = httpx.get(f"{API}{path}", headers=H, timeout=25)
    r.raise_for_status()
    return r.json()


def all_events(kind):
    head = get(f"/api/v4/{kind}/brand/{BRAND}/en/0")
    vs = (head.get("top_events_versions") or []) + (head.get("rest_events_versions") or [])
    sports, tours, events = {}, {}, {}
    for v in vs:
        try:
            bk = get(f"/api/v4/{kind}/brand/{BRAND}/en/{v}")
        except Exception:
            continue
        sports.update(bk.get("sports", {}))
        tours.update(bk.get("tournaments", {}))
        events.update(bk.get("events", {}))
    return sports, tours, events


def main():
    md = get(f"/api/v3/descriptions/brand/{BRAND}/markets/en")
    print("market descriptions:", len(md))
    print("market '1' =", json.dumps(md.get("1", {}))[:300])

    sports, tours, events = all_events("prematch")
    print(f"\nprematch: sports={len(sports)} tournaments={len(tours)} events={len(events)}")
    print("sample sport:", json.dumps(list(sports.items())[0]) if sports else None)
    print("sample tournament:", json.dumps(list(tours.items())[0])[:120] if tours else None)

    # find first 2-competitor "match"
    match = None
    for eid, ev in events.items():
        d = ev.get("desc", {})
        comps = d.get("competitors", [])
        if d.get("type") == "match" and len(comps) == 2:
            match = (eid, ev); break
    if not match:
        print("no type=match found; types seen:", {ev.get('desc',{}).get('type') for ev in list(events.values())[:50]})
        return
    eid, ev = match
    d = ev["desc"]
    sport = sports.get(str(d.get("sport")), {})
    tour = tours.get(str(d.get("tournament")), {})
    print(f"\n=== MATCH {eid} ===")
    print("sport:", sport.get("name") if isinstance(sport, dict) else sport)
    print("tournament:", tour.get("name") if isinstance(tour, dict) else tour)
    print("teams:", [c.get("name") for c in d["competitors"]])
    print("scheduled:", d.get("scheduled"))
    print("market type ids on event:", list(ev.get("markets", {}).keys())[:15])

    # map market '1' (match winner) outcomes
    for mtid in ("1", "186", "219"):
        if mtid in ev.get("markets", {}):
            desc = md.get(mtid, {})
            print(f"\n--- market {mtid}: {desc.get('name')!r} ---")
            # outcome id -> name from description variants
            omap = {}
            for var in desc.get("variants", []):
                for o in var.get("outcomes", []):
                    omap[str(o["id"])] = o["name"]
            for spec, outs in ev["markets"][mtid].items():
                print(f"  specifier={spec!r}")
                for oid, od in outs.items():
                    print(f"    {omap.get(str(oid), oid)} = {od.get('k')}")
            break


main()

#!/usr/bin/env python3
"""Find the score/status fields in BetBy live events (for auto-results)."""
import json, httpx

BRAND = "2103509236163162112"
API = "https://api-k-c7818b61-623.sptpub.com"
H = {"User-Agent": "Mozilla/5.0", "Origin": "https://bcigra.com", "Referer": "https://bcigra.com/"}


def get(p):
    r = httpx.get(f"{API}{p}", headers=H, timeout=25); r.raise_for_status(); return r.json()


def main():
    head = get(f"/api/v4/live/brand/{BRAND}/en/0")
    vs = (head.get("top_events_versions") or []) + (head.get("rest_events_versions") or [])
    events = {}
    for v in vs:
        try:
            events.update(get(f"/api/v4/live/brand/{BRAND}/en/{v}").get("events", {}))
        except Exception:
            pass
    print("live events:", len(events))
    # dump a couple of live match events fully (desc + non-market keys)
    shown = 0
    for eid, ev in events.items():
        d = ev.get("desc", {})
        if d.get("type") == "match" and len(d.get("competitors", [])) == 2:
            print(f"\n=== event {eid}: {[c.get('name') for c in d['competitors']]} ===")
            print("event top-level keys:", list(ev.keys()))
            # everything except the big 'markets' blob
            slim = {k: v for k, v in ev.items() if k != "markets"}
            print(json.dumps(slim, indent=2)[:1800])
            shown += 1
            if shown >= 2:
                break
    # also check the live head 'status' map meaning
    print("\nstatus map sample:", dict(list(head.get("status", {}).items())[:3]))


main()

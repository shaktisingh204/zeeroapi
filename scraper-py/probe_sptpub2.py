#!/usr/bin/env python3
"""Follow the BetBy/sptpub version cursors to the real event/market/outcome data."""
import json, httpx

BRAND = "2103509236163162112"
API = "https://api-k-c7818b61-623.sptpub.com"
H = {"User-Agent": "Mozilla/5.0", "Origin": "https://bcigra.com", "Referer": "https://bcigra.com/"}


def get(path):
    r = httpx.get(f"{API}{path}", headers=H, timeout=25)
    r.raise_for_status()
    return r.json()


def main():
    head = get(f"/api/v4/prematch/brand/{BRAND}/en/0")
    versions = (head.get("top_events_versions") or []) + (head.get("rest_events_versions") or [])
    print("versions to fetch:", versions[:5])
    bucket = get(f"/api/v4/prematch/brand/{BRAND}/en/{versions[0]}")
    print("=== bucket top-level keys ===", list(bucket.keys()))
    for k, v in bucket.items():
        if isinstance(v, dict):
            print(f"  {k}: dict[{len(v)}] sampleKey={next(iter(v), None)}")
        elif isinstance(v, list):
            print(f"  {k}: list[{len(v)}]")
        else:
            print(f"  {k}: {str(v)[:60]}")

    # Find the events container and dump one fully.
    for ek in ("events", "event", "matches"):
        if isinstance(bucket.get(ek), dict) and bucket[ek]:
            eid, ev = next(iter(bucket[ek].items()))
            print(f"\n=== sample event [{eid}] ===")
            print(json.dumps(ev, indent=2)[:2500])
            break
    else:
        # maybe events are a list
        print("\nNo dict events; full sample (2KB):")
        print(json.dumps(bucket, indent=2)[:2000])


main()

#!/usr/bin/env python3
"""Inspect the BetBy/sptpub JSON feed structure that powers BC.Game."""
import json, httpx

BRAND = "2103509236163162112"
API = "https://api-k-c7818b61-623.sptpub.com"
H = {"User-Agent": "Mozilla/5.0", "Origin": "https://bcigra.com", "Referer": "https://bcigra.com/"}


def get(path):
    r = httpx.get(f"{API}{path}", headers=H, timeout=25)
    r.raise_for_status()
    return r.json()


def main():
    live = get(f"/api/v4/live/brand/{BRAND}/en/0")
    pre = get(f"/api/v4/prematch/brand/{BRAND}/en/0")
    print("=== LIVE top-level keys ===", list(live.keys()))
    print("=== PREMATCH top-level keys ===", list(pre.keys()))

    snap = live if any(k not in ("epoch", "version", "status", "generated",
            "top_events_versions", "rest_events_versions") for k in live) else pre
    for name, snap in (("LIVE", live), ("PREMATCH", pre)):
        print(f"\n########## {name} ##########")
        for k, v in snap.items():
            if isinstance(v, dict):
                print(f"  {k}: dict[{len(v)}]  sampleKey={next(iter(v), None)}")
            elif isinstance(v, list):
                print(f"  {k}: list[{len(v)}]")
            else:
                print(f"  {k}: {v}")
        # dump one event + related
        for ek in ("events", "event", "matches"):
            if ek in snap and isinstance(snap[ek], dict) and snap[ek]:
                eid, ev = next(iter(snap[ek].items()))
                print(f"\n  --- sample event [{eid}] ---")
                print("  ", json.dumps(ev, indent=2)[:1200])
                break
        # markets / outcomes containers
        for mk in ("markets", "market", "odds", "selections", "outcomes"):
            if mk in snap and isinstance(snap[mk], dict) and snap[mk]:
                mid, mv = next(iter(snap[mk].items()))
                print(f"\n  --- sample {mk} [{mid}] ---")
                print("  ", json.dumps(mv, indent=2)[:900])
        if name == "PREMATCH":
            break

    # competitor / sport name sources
    for path, label in [
        (f"/api/v1/descriptions/statuses/en", "statuses"),
    ]:
        try:
            d = get(path)
            print(f"\n=== {label} keys: {list(d)[:6]} (n={len(d)}) ===")
        except Exception as e:
            print(label, "err", e)


main()

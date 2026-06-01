#!/usr/bin/env python3
"""Network/feed discovery probe for 1win's sportsbook.

1win runs its OWN platform (not a 1xbet skin), so we don't know its API host
or feed shape up front. This loads the live sportsbook in real Chrome and logs
every XHR/fetch response so we can locate the live/prematch odds feed and the
market/outcome name maps.

    python probe_1win.py                       # default 1win.pro/en/sport
    python probe_1win.py --url https://1win.fyi/en/sport
    python probe_1win.py --headed

Env: ONEWIN_BASE_URL (default https://1win.pro)
"""
import argparse
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("ONEWIN_BASE_URL", "https://1win.pro").rstrip("/")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Words that hint a response carries sportsbook data.
HINT = re.compile(r"(sport|bet|odd|event|match|live|prematch|line|market|fixture|tournament|champ)", re.I)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=f"{BASE}/en/sport")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--wait", type=float, default=20, help="seconds to sit on the page")
    args = ap.parse_args()

    seen = []  # (method, url, status, ctype, body_preview, is_json, json_keys)

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=not args.headed)
        ctx = browser.new_context(user_agent=UA, locale="en-US",
                                  viewport={"width": 1400, "height": 900})
        page = ctx.new_page()

        def on_response(resp):
            try:
                url = resp.url
                req = resp.request
                ctype = resp.headers.get("content-type", "")
                if req.resource_type not in ("xhr", "fetch") and "json" not in ctype:
                    return
                is_json = "json" in ctype
                keys = None
                preview = ""
                if is_json:
                    try:
                        data = resp.json()
                        if isinstance(data, dict):
                            keys = list(data.keys())[:25]
                        elif isinstance(data, list):
                            keys = [f"<list len={len(data)}>"]
                            if data and isinstance(data[0], dict):
                                keys += list(data[0].keys())[:25]
                        preview = json.dumps(data)[:400]
                    except Exception:
                        preview = (resp.text() or "")[:200]
                seen.append((req.method, url, resp.status, ctype, preview, is_json, keys))
            except Exception:
                pass

        page.on("response", on_response)

        print(f"loading {args.url} ...", file=sys.stderr)
        try:
            page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            print(f"goto warn: {e}", file=sys.stderr)
        page.wait_for_timeout(int(args.wait * 1000))

        # Try clicking through to live if there's an obvious link.
        for sel in ["text=Live", "text=LIVE", "a[href*='live']", "[href*='/sport']"]:
            try:
                el = page.query_selector(sel)
                if el:
                    el.click(timeout=3000)
                    page.wait_for_timeout(6000)
                    break
            except Exception:
                pass

        try:
            print(f"final url: {page.url}", file=sys.stderr)
        except Exception:
            pass
        browser.close()

    # Report
    hosts = {}
    for m, url, st, ct, pv, isj, keys in seen:
        host = re.sub(r"https?://([^/]+)/.*", r"\1", url)
        hosts.setdefault(host, 0)
        hosts[host] += 1

    print("\n=== HOSTS that returned XHR/fetch/json ===")
    for h, c in sorted(hosts.items(), key=lambda x: -x[1]):
        print(f"  {c:4d}  {h}")

    print("\n=== JSON responses whose URL looks sportsbook-related ===")
    shown = 0
    for m, url, st, ct, pv, isj, keys in seen:
        if isj and HINT.search(url):
            print(f"\n[{st}] {m} {url}")
            if keys:
                print(f"   keys: {keys}")
            print(f"   body: {pv}")
            shown += 1
            if shown >= 40:
                break

    if not shown:
        print("  (none matched the hint regex — dumping ALL json responses)")
        for m, url, st, ct, pv, isj, keys in seen:
            if isj:
                print(f"\n[{st}] {m} {url}")
                if keys:
                    print(f"   keys: {keys}")
                print(f"   body: {pv}")

    print(f"\ntotal captured XHR/fetch/json responses: {len(seen)}")


if __name__ == "__main__":
    main()

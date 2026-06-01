#!/usr/bin/env python3
"""Scratch probe: try candidate BetWinner mirror domains in real Chrome and
report which ones load the live SPA and render `.dashboard-game`.

These mirrors often bounce through several redirects to a regional skin, so we
goto the root, let redirects settle, then navigate to /en/live on the *landed*
origin and probe the DOM."""
import sys
from playwright.sync_api import sync_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

CANDIDATES = [
    "https://betwinner.com", "https://betwinner1.com", "https://betwinner.team",
    "https://betwinner.plus", "https://betwinner.win", "https://betwinner.casino",
    "https://betwinner.cm", "https://betwinnerug.com",
]


def settle(page, url, timeout=45000):
    """goto tolerant of redirect interruptions; return final origin or None."""
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    except Exception as e:
        msg = str(e)
        if "interrupted by another navigation" not in msg and "ERR_ABORTED" not in msg:
            return None, f"GOTO-FAIL {type(e).__name__}: {msg[:70]}"
    page.wait_for_timeout(4000)
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    return page.url, None


def probe(page, base):
    landed, err = settle(page, base)
    if err:
        return f"{base:28} {err}"
    # derive origin then go to /en/live there
    origin = "/".join(landed.split("/")[:3])
    live = f"{origin}/en/live"
    _, err2 = settle(page, live, timeout=45000)
    try:
        page.wait_for_selector(".dashboard-game", timeout=12000)
    except Exception:
        pass
    c = page.evaluate("""() => ({
        game: document.querySelectorAll('.dashboard-game').length,
        champ: document.querySelectorAll('.dashboard-champ').length,
        market: document.querySelectorAll('.ui-market').length,
        team: document.querySelectorAll("[class*='team-score-name']").length,
        landed: location.href,
    })""")
    return (f"{base:28} -> {origin:30} games={c['game']} champs={c['champ']} "
            f"markets={c['market']} teams={c['team']} | {c['landed'][:60]}")


def main():
    only = sys.argv[1:] or CANDIDATES
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context(locale="en-US",
                                  viewport={"width": 1600, "height": 1200}, user_agent=UA)
        page = ctx.new_page()
        for base in only:
            try:
                print(probe(page, base), flush=True)
            except Exception as e:
                print(f"{base:28} PROBE-ERR {type(e).__name__}: {str(e)[:70]}", flush=True)
        browser.close()


if __name__ == "__main__":
    main()

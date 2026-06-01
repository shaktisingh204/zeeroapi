#!/usr/bin/env python3
"""Scratch probe: which 1xbet mirror loads the live SPA + renders .dashboard-game?"""
import sys
from playwright.sync_api import sync_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

CANDIDATES = [
    "https://1xbet.ng/en/live",
    "https://1x001.com/en/live",
    "https://1xbet.com/en/live",
    "https://1xlite-1.com/en/live",
]


def main():
    cands = sys.argv[1:] or CANDIDATES
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        for url in cands:
            ctx = browser.new_context(locale="en-US",
                                      viewport={"width": 1600, "height": 1200}, user_agent=UA)
            page = ctx.new_page()
            try:
                resp = page.goto(url, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(6000)
                status = resp.status if resp else None
                final = page.url
                try:
                    page.wait_for_selector(".dashboard-game", timeout=15000)
                except Exception:
                    pass
                games = page.eval_on_selector_all(".dashboard-game", "els => els.length")
                champs = page.eval_on_selector_all(".dashboard-champ", "els => els.length")
                markets = page.eval_on_selector_all(".ui-market", "els => els.length")
                teams = page.eval_on_selector_all("[class*='team-score-name']",
                                                  "els => els.slice(0,4).map(e=>e.innerText.trim())")
                print(f"{url}")
                print(f"  http={status} final={final}")
                print(f"  dashboard-game={games} dashboard-champ={champs} ui-market={markets}")
                print(f"  sample teams={teams}")
            except Exception as e:
                print(f"{url} -> ERROR {e}")
            finally:
                ctx.close()
        browser.close()


if __name__ == "__main__":
    main()

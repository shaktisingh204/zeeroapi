"""Probe: can a real Chrome render melbet odds, and what's the DOM shape?"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://india.melbet.com/en/live"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    ctx = browser.new_context(
        locale="en-US",
        viewport={"width": 1440, "height": 900},
        user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    )
    page = ctx.new_page()
    print("navigating:", URL)
    try:
        page.goto(URL, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        print("goto error:", e)
    page.wait_for_timeout(7000)  # let the SPA + XHR render

    print("final url:", page.url)
    print("title:", page.title())
    html = page.content()
    print("html bytes:", len(html))

    # Heuristic: find elements whose text looks like decimal odds (e.g. 1.85)
    import re
    txt = page.inner_text("body")[:4000]
    odds_like = re.findall(r"\b\d\.\d{1,3}\b", txt)
    print("decimal-odds tokens visible (sample):", odds_like[:20], "...total", len(odds_like))

    # Dump candidate class names that repeat a lot (likely the odds/cards grid)
    classes = page.eval_on_selector_all(
        "[class]",
        "els => els.map(e => e.getAttribute('class')).filter(Boolean)",
    )
    from collections import Counter
    flat = Counter()
    for c in classes:
        for token in c.split():
            flat[token] += 1
    print("\ntop repeated class tokens:")
    for cls, n in flat.most_common(30):
        print(f"  {n:4d}  {cls}")

    browser.close()

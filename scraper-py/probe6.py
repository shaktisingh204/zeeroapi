from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(locale="en-US", viewport={"width": 1600, "height": 1400},
        user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"))
    page = ctx.new_page()
    page.goto("https://india.melbet.com/en/line/football", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(8000)
    # scroll to trigger lazy rendering
    for _ in range(5):
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(800)

    cands = ["[class*='dashboard-game']","[class*='game-block']","[class*='c-events__item']",
             "[class*='ui-game']","[class*='line-champ']","[class*='dashboard-champ']",
             "[class*='event-block']","[class*='ui-table-row']","[class*='dashboard-event']"]
    print("counts after scroll:")
    best = None
    for s in cands:
        n = page.eval_on_selector_all(s, "e=>e.length")
        print(f"  {n:5d}  {s}")

    # For game-block, dump first 2 elements' text + whether they contain ui-market
    info = page.evaluate(r"""() => {
        const probe = (sel) => {
            const els=[...document.querySelectorAll(sel)];
            return els.slice(0,2).map(e=>({
                cls:e.className.slice(0,60),
                hasMarket: !!e.querySelector('.ui-market'),
                nMarket: e.querySelectorAll('.ui-market').length,
                text: e.innerText.replace(/\n+/g,' | ').slice(0,180)
            }));
        };
        return {gameblock: probe("[class*='game-block']"), dashgame: probe("[class*='dashboard-game']")};
    }""")
    import json
    print(json.dumps(info, indent=2, ensure_ascii=False))
    b.close()

from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(locale="en-US", viewport={"width": 1600, "height": 1400},
        user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"))
    page = ctx.new_page()
    page.goto("https://india.melbet.com/en/line/football", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(8000)

    data = page.evaluate(r"""() => {
        const rows=[...document.querySelectorAll('.dashboard-game')];
        const sample = rows.slice(0,3).map(e=>{
            // candidate team-name nodes
            const nameNodes = {};
            ["[class*='team']","[class*='opponent']","[class*='competitor']","[class*='__name']","[class*='caption__label']","[class*='game-info']"]
              .forEach(s=>{ nameNodes[s]=[...e.querySelectorAll(s)].map(n=>n.innerText.trim()).filter(Boolean).slice(0,4); });
            const markets=[...e.querySelectorAll('.ui-market')].map(m=>({
                aria:m.getAttribute('aria-label'),
                title:m.getAttribute('data-original-title'),
                value:m.querySelector('.ui-market__value')?.innerText.trim(),
            }));
            // market group headers (column titles) at champ level
            return {rowClass:e.className.slice(0,40), nameNodes, markets, text:e.innerText.replace(/\n+/g,' | ').slice(0,160)};
        });
        // champ-level market headers
        const headers=[...document.querySelectorAll("[class*='dashboard-market-group__label'],[class*='market-group__label'],[class*='dashboard-champ__market']")]
            .map(n=>n.innerText.trim()).filter(Boolean).slice(0,12);
        return {count:rows.length, sample, headers};
    }""")
    print("dashboard-game count:", data["count"])
    print("market group headers:", data["headers"])
    print(json.dumps(data["sample"], indent=2, ensure_ascii=False))
    b.close()

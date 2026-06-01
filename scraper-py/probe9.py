from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(locale="en-US", viewport={"width": 1600, "height": 1400},
        user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"))
    page = ctx.new_page()
    page.goto("https://india.melbet.com/en/line/football", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(7000)
    info = page.evaluate(r"""() => {
        // first dashboard-game that actually has team text
        const games=[...document.querySelectorAll('.dashboard-game')];
        for(const g of games){
            const nameNodes=[...g.querySelectorAll("[class*='__name']")].map(n=>({cls:n.className, text:n.innerText.trim().slice(0,30)}));
            const teamNodes=[...g.querySelectorAll("[class*='team'],[class*='opponent'],[class*='competitor']")].map(n=>({cls:n.className.slice(0,50), text:n.innerText.replace(/\n/g,'/').slice(0,40)}));
            if(nameNodes.length) return {rowClass:g.className.slice(0,50), nameNodes, teamNodes};
        }
        return {};
    }""")
    print(json.dumps(info, indent=2, ensure_ascii=False))
    b.close()

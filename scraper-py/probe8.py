from playwright.sync_api import sync_playwright
import json

for URL in ["https://india.melbet.com/en/line/football", "https://india.melbet.com/en/live"]:
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        ctx = b.new_context(locale="en-US", viewport={"width": 1600, "height": 1400},
            user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"))
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(8000)
        data = page.evaluate(r"""() => {
            const champs=[...document.querySelectorAll('.dashboard-champ')];
            return champs.slice(0,2).map(c=>{
                const labels=[...c.querySelectorAll("[class*='market-group__label']")].map(n=>n.innerText.trim());
                const title=c.querySelector("[class*='title'],[class*='caption__label'],[class*='champ__name']")?.innerText.trim();
                const g=c.querySelector('.dashboard-game');
                const cells=g?[...g.querySelectorAll('.ui-market__value')].map(v=>v.innerText.trim()):[];
                const names=g?[...g.querySelectorAll("[class*='__name']")].map(n=>n.innerText.trim()):[];
                return {title, labels, gameTeams:names, gameCells:cells, nGames:c.querySelectorAll('.dashboard-game').length};
            });
        }""")
        print(f"\n##### {URL}  (champs sampled: {len(data)}) #####")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        b.close()

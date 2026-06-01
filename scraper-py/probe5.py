from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(locale="en-US", viewport={"width": 1600, "height": 1200},
        user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"))
    page = ctx.new_page()
    page.goto("https://india.melbet.com/en/live", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(7000)

    data = page.evaluate(r"""() => {
        const pick = (el, sels) => { for (const s of sels){const n=el.querySelector(s); if(n&&n.innerText.trim()) return n.innerText.trim();} return null; };
        const out=[];
        document.querySelectorAll('.ui-sports-event').forEach((e,i)=>{
            if(i>2) return;
            // team names
            const teams=[...e.querySelectorAll("[class*='team'] [class*='name'], [class*='opponent'] , [class*='ui-sports-event__name'], [class*='event-team']")].map(n=>n.innerText.trim()).filter(Boolean);
            // scores
            const scores=[...e.querySelectorAll('.ui-game-scores__num')].map(n=>n.innerText.trim());
            // markets: each ui-market has a label + value
            const markets=[...e.querySelectorAll('.ui-market')].map(m=>({
                label: m.getAttribute('aria-label') || m.getAttribute('data-original-title') || (m.querySelector("[class*='name'],[class*='label'],[class*='caption']")?.innerText.trim()) || null,
                value: m.querySelector('.ui-market__value')?.innerText.trim() || null,
                full: m.innerText.replace(/\n+/g,' ').trim().slice(0,40),
            }));
            // any market-group header labels (column headers like 1 X 2)
            const headers=[...e.querySelectorAll("[class*='market-group__label'],[class*='market-group__trigger']")].map(n=>n.innerText.trim()).filter(Boolean);
            out.push({teams, scores, headers, markets});
        });
        return out;
    }""")
    print(json.dumps(data, indent=2, ensure_ascii=False))
    b.close()

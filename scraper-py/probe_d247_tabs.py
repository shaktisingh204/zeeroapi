#!/usr/bin/env python3
"""Find d247's main-content sport tab strip + confirm a tab click filters events."""
import asyncio, json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
SPORTS_RE = "cricket|football|soccer|tennis|kabaddi|basketball|volleyball|badminton|snooker|hockey|boxing|golf|rugby|baseball|darts|futsal|handball|esoccer|wrestling|politics|table tennis|mixed martial"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await browser.new_context(locale="en-US", user_agent=UA,
                                        viewport={"width": 1440, "height": 1200})
        page = await ctx.new_page()
        await page.goto("https://d247.com/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(9000)
        await page.click("text=Login with demo ID", timeout=12000)
        await page.wait_for_timeout(11000)

        info = await page.evaluate(r"""(re) => {
            const rx = new RegExp('^('+re+')$','i');
            const clean = s => (s||'').replace(/\s+/g,' ').trim();
            // candidate tab elements: small clickable nodes whose text is exactly a sport
            const cands = [...document.querySelectorAll('a,button,li,span,div')].filter(e => {
                const t = clean(e.innerText);
                return rx.test(t) && e.children.length <= 1;
            });
            // group by parent to find the tab strip (parent with many sport children)
            const byParent = new Map();
            for (const c of cands) {
                const p = c.parentElement;
                if (!p) continue;
                if (!byParent.has(p)) byParent.set(p, []);
                byParent.get(p).push(c);
            }
            let best = null, bestN = 0;
            for (const [p, kids] of byParent) {
                if (kids.length > bestN) { bestN = kids.length; best = p; }
            }
            if (!best) return { found: false };
            const tabs = [...best.children].map(c => ({
                tag: c.tagName, cls: c.className,
                text: clean(c.innerText).slice(0,24),
            })).filter(t => t.text);
            return {
                found: true, stripTag: best.tagName, stripClass: best.className,
                childCls: best.firstElementChild ? best.firstElementChild.className : null,
                count: tabs.length, tabs: tabs.slice(0, 30),
            };
        }""", SPORTS_RE)
        print(json.dumps(info, indent=2, ensure_ascii=False)[:3000])
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

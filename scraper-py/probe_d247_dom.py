#!/usr/bin/env python3
"""After demo-login, discover d247's match-row + odds DOM selectors so we can
write a reliable scraper. Walks up from team-name text nodes to the repeating
event container, and finds the odds cells within."""
import asyncio
import json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await browser.new_context(locale="en-US", user_agent=UA,
                                        viewport={"width": 1440, "height": 1100})
        page = await ctx.new_page()
        await page.goto("https://d247.com/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(9000)
        try:
            await page.click("text=Login with demo ID", timeout=8000)
        except Exception as e:
            print("demo click failed:", e)
        await page.wait_for_timeout(12000)
        # Stay in the SPA (no hard navigation — that drops the demo session).
        # Scroll to load the event list, then inspect in place.
        for _ in range(5):
            await page.mouse.wheel(0, 2500)
            await page.wait_for_timeout(400)
        n = await page.evaluate("() => document.querySelectorAll('*').length")
        print(f"in-place: {n} nodes, url={page.url}")

        # Anchor on the event date pattern "DD/MM/YYYY HH:MM:SS" to find real
        # event rows, then dump the row's class + HTML so we can read the markup.
        struct = await page.evaluate(r"""() => {
            const txt = el => (el.innerText || '').trim();
            const DATE = /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/;
            // Leaf elements whose text contains an event date.
            const dated = [...document.querySelectorAll('*')].filter(el =>
                DATE.test(txt(el)) && el.children.length <= 4 && txt(el).length < 120);
            const out = [];
            const seen = new Set();
            for (const d of dated) {
                // climb to a container with several children (the event row)
                let row = d;
                for (let i = 0; i < 5 && row.parentElement; i++) {
                    if (row.querySelectorAll('*').length > 8) break;
                    row = row.parentElement;
                }
                const key = row.className + '|' + row.children.length;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    rowTag: row.tagName,
                    rowClass: row.className,
                    childCount: row.children.length,
                    html: row.outerHTML.replace(/\s+/g, ' ').slice(0, 900),
                });
                if (out.length >= 3) break;
            }
            return out;
        }""")
        print("\n=== EVENT ROW SAMPLES ===")
        for i, s in enumerate(struct):
            print(f"\n--- sample {i} | <{s['rowTag']} class='{s['rowClass']}'> children={s['childCount']} ---")
            print(s["html"])

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

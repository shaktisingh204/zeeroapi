#!/usr/bin/env python3
"""Find d247 sport-nav links + whether the demo session survives reload."""
import asyncio, json
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
        await page.click("text=Login with demo ID", timeout=8000)
        await page.wait_for_timeout(11000)

        # All anchor hrefs that look sport-related
        links = await page.evaluate(r"""() => {
            const seen = {};
            for (const a of document.querySelectorAll('a[href]')) {
                const h = a.getAttribute('href');
                const t = (a.innerText||'').trim();
                if (!h) continue;
                if (/sport|cricket|football|soccer|tennis|list|game-list|inplay|^\/d\//i.test(h) && t)
                    seen[h] = t.slice(0, 30);
            }
            return seen;
        }""")
        print("=== sport-ish links (href -> text) ===")
        print(json.dumps(links, indent=2)[:2500])

        # localStorage/session keys (does demo token persist?)
        store = await page.evaluate("""() => ({
            ls: Object.keys(localStorage), ss: Object.keys(sessionStorage)
        })""")
        print("\n=== storage keys ===")
        print(json.dumps(store, indent=2))

        # Count event rows currently on home
        cnt = await page.evaluate("() => document.querySelectorAll('.bet-table-row').length")
        print("\n.bet-table-row count on home:", cnt)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

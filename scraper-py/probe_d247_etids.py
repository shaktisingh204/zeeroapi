#!/usr/bin/env python3
"""Collect distinct etids present on d247 (from event hrefs) + the sport-name
header shown on each /all-sports/{etid} page, so the scraper can cover every
sport that actually has events."""
import asyncio, json, re
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


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
        for _ in range(6):
            await page.mouse.wheel(0, 3000); await page.wait_for_timeout(300)

        # Distinct etids from every event href on the home page.
        etids = await page.evaluate(r"""() => {
            const ids = {};
            for (const a of document.querySelectorAll('a[href]')) {
                const m = (a.getAttribute('href')||'').match(/\/(?:game-details|cricketv|virtual-cricket|tp-virtual-cricket)\/(\d+)\//);
                if (m) ids[m[1]] = (ids[m[1]]||0) + 1;
            }
            return ids;
        }""")
        print("=== etids found on home (etid -> #events) ===")
        print(json.dumps(etids, indent=2))

        # For each etid, open /all-sports/{etid} and read the sport-name header.
        names = {}
        for etid in sorted(etids, key=lambda k: -etids[k]):
            try:
                await page.click(f"a[href='/all-sports/{etid}']", timeout=2500)
            except Exception:
                # not in quick-nav; navigate via in-app click fallback
                await page.evaluate("(id)=>{const a=document.createElement('a');a.href='/all-sports/'+id;document.body.appendChild(a);a.click();}", etid)
            await page.wait_for_timeout(3500)
            info = await page.evaluate(r"""() => {
                const clean = s => (s||'').replace(/\s+/g,' ').trim();
                const h = document.querySelector("h1,h2,.page-title,.sports-title,[class*='title']");
                const rows = document.querySelectorAll('.bet-table-row').length;
                return { header: h ? clean(h.innerText).slice(0,40) : null, rows };
            }""")
            names[etid] = info
            print(f"etid {etid}: header={info['header']!r} rows={info['rows']} url={page.url}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

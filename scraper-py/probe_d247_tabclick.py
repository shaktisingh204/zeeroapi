#!/usr/bin/env python3
import asyncio
from playwright.async_api import async_playwright
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

async def count_names(page):
    return await page.evaluate(r"""() => {
        const rows = [...document.querySelectorAll('.bet-table-row')];
        const names = rows.map(r => { const a=r.querySelector('a.bet-nation-game-name'); return a?(a.innerText||'').replace(/\s+/g,' ').trim().slice(0,40):null; }).filter(Boolean);
        return { rows: rows.length, sample: names.slice(0,4) };
    }""")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await b.new_context(locale="en-US", user_agent=UA, viewport={"width":1440,"height":1200})
        page = await ctx.new_page()
        await page.goto("https://d247.com/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(9000)
        await page.click("text=Login with demo ID", timeout=12000)
        await page.wait_for_timeout(11000)
        print("default:", await count_names(page))

        # inner structure of a tab li
        inner = await page.evaluate("""() => {
            const li = document.querySelector('ul.sports-tab li.nav-item');
            return li ? li.outerHTML.replace(/\\s+/g,' ').slice(0,200) : 'none';
        }""")
        print("tab li html:", inner)

        # try clicking inner <a>/<button> of Football (nth 1)
        for sel in ["ul.sports-tab li.nav-item:nth-child(2) a",
                    "ul.sports-tab li.nav-item:nth-child(2) button",
                    "ul.sports-tab li.nav-item:nth-child(2)"]:
            try:
                await page.click(sel, timeout=4000)
                await page.wait_for_timeout(3500)
                c = await count_names(page)
                print(f"after click '{sel}':", c)
                if c["rows"] > 0:
                    break
            except Exception as e:
                print(f"click '{sel}' failed: {e}")
        await b.close()

asyncio.run(main())

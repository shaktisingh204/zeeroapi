#!/usr/bin/env python3
"""Dump the FULL d247 event row (name + back/lay odds cells) to read odds markup."""
import asyncio
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
        await page.wait_for_timeout(12000)
        for _ in range(4):
            await page.mouse.wheel(0, 2500)
            await page.wait_for_timeout(400)

        rows = await page.evaluate(r"""() => {
            const clean = s => s.replace(/\s+/g, ' ').trim();
            const names = [...document.querySelectorAll('a.bet-nation-game-name')];
            const out = [];
            const seen = new Set();
            for (const a of names) {
                // climb to the widest row container (holds name + odds)
                let row = a;
                for (let i = 0; i < 6 && row.parentElement; i++) {
                    const cls = row.className || '';
                    if (/row|table|event|match|game-list|bet-table/i.test(cls) && row.querySelectorAll('a,button,span,div').length > 10) break;
                    row = row.parentElement;
                }
                if (seen.has(row)) continue;
                seen.add(row);
                out.push({
                    href: a.getAttribute('href'),
                    name: clean(a.innerText),
                    rowClass: row.className,
                    html: clean(row.outerHTML).slice(0, 1600),
                });
                if (out.length >= 3) break;
            }
            return out;
        }""")
        for i, r in enumerate(rows):
            print(f"\n=== ROW {i} | href={r['href']} | name='{r['name']}' ===")
            print("rowClass:", r["rowClass"])
            print(r["html"])

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

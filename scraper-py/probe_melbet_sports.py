#!/usr/bin/env python3
"""Discover melbet's full set of /line/<slug> prematch sports from the sports menu."""
import asyncio, json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


async def block_assets(route):
    if route.request.resource_type in ("image", "font", "media"):
        await route.abort()
    else:
        await route.continue_()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await b.new_context(locale="en-US", user_agent=UA, viewport={"width": 1600, "height": 1200})
        page = await ctx.new_page()
        await page.route("**/*", block_assets)
        await page.goto("https://india.melbet.com/en/line/football", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(5000)
        try:
            await page.wait_for_selector("a[href*='/line/']", timeout=15000)
        except Exception:
            pass
        slugs = await page.evaluate(r"""() => {
            const out = {};
            for (const a of document.querySelectorAll("a[href*='/line/']")) {
                const m = (a.getAttribute('href')||'').match(/\/line\/([a-z0-9-]+)/i);
                if (m && m[1] && !/^\d/.test(m[1])) {
                    const t = (a.innerText||'').replace(/\s+/g,' ').trim();
                    if (!out[m[1]] || (t && t.length < out[m[1]].length)) out[m[1]] = t.slice(0,28);
                }
            }
            return out;
        }""")
        print("melbet line sports (slug -> label):")
        print(json.dumps(slugs, indent=2, ensure_ascii=False))
        print("\ncount:", len(slugs))
        await b.close()


asyncio.run(main())

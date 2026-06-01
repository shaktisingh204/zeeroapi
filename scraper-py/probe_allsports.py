#!/usr/bin/env python3
"""Enumerate ALL sports for both providers:
  - d247: every /all-sports/{etid} link (etid + name)
  - melbet: every /en/line/<slug> sport in the left sports menu
"""
import asyncio, json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


async def d247(ctx):
    page = await ctx.new_page()
    await page.goto("https://d247.com/", wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(9000)
    try:
        await page.click("text=Login with demo ID", timeout=12000)
    except Exception as e:
        print("d247 demo click:", e)
    await page.wait_for_timeout(11000)
    links = await page.evaluate(r"""() => {
        const m = {};
        for (const a of document.querySelectorAll("a[href^='/all-sports/']")) {
            const id = a.getAttribute('href').split('/').pop();
            const t = (a.innerText||'').trim();
            if (id && t) m[id] = t;
        }
        return m;
    }""")
    await page.close()
    return links


async def melbet(ctx):
    page = await ctx.new_page()
    await page.goto("https://india.melbet.com/en/line/football", wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(8000)
    slugs = await page.evaluate(r"""() => {
        const out = {};
        for (const a of document.querySelectorAll("a[href*='/line/']")) {
            const m = (a.getAttribute('href')||'').match(/\/line\/([a-z0-9-]+)/i);
            if (m) { const t=(a.innerText||'').trim(); if (m[1] && !/^\d+$/.test(m[1])) out[m[1]] = t.slice(0,30); }
        }
        return out;
    }""")
    await page.close()
    return slugs


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await browser.new_context(locale="en-US", user_agent=UA,
                                        viewport={"width": 1440, "height": 1100})
        d = await d247(ctx)
        print("=== d247 /all-sports/{etid} ===")
        print(json.dumps(d, indent=2, ensure_ascii=False))
        try:
            mb = await melbet(ctx)
            print("\n=== melbet /line/<slug> ===")
            print(json.dumps(mb, indent=2, ensure_ascii=False))
        except Exception as e:
            print("melbet probe failed:", e)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

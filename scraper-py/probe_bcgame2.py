#!/usr/bin/env python3
"""Confirm BC.Game sportsbook gating + odds source (BetBy iframe? guest access?)."""
import asyncio
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
THIRD_PARTY = []


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await b.new_context(locale="en-US", user_agent=UA, viewport={"width": 1440, "height": 1000})
        page = await ctx.new_page()
        page.on("request", lambda r: THIRD_PARTY.append(r.url) if any(
            k in r.url.lower() for k in ("betby", "sportradar", "digitain", "altenar", "betradar", "sportsbook")) else None)

        await page.goto("https://bcgame.im/", wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(6000)
        # try clicking Sports nav
        for sel in ["a[href*='sport']", "text=Sports", "text=Sports Home"]:
            try:
                await page.click(sel, timeout=3000)
                break
            except Exception:
                pass
        await page.wait_for_timeout(9000)
        print("url after Sports:", page.url)
        # iframes present?
        frames = [f.url for f in page.frames if f.url and "bcgame" not in f.url]
        print("non-site iframes:", frames[:8])
        # any betby/sportradar requests?
        tp = sorted(set(u.split("?")[0] for u in THIRD_PARTY))
        print("third-party sportsbook requests:")
        for u in tp[:15]:
            print("  ", u[:120])
        login = "/login" in page.url or "signin" in page.url
        print("REQUIRES LOGIN for sports:", login)
        await b.close()


asyncio.run(main())

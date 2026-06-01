#!/usr/bin/env python3
"""Reproduce the admin provider-filter flow in a real browser and capture the
actual /api/matches request + the providers present in the response."""
import asyncio
from playwright.async_api import async_playwright

CALLS = []

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await b.new_context(viewport={"width": 1400, "height": 1000})
        page = await ctx.new_page()
        page.on("request", lambda r: CALLS.append(r.url) if "/api/matches" in r.url or "/api/admin/stats" in r.url else None)

        await page.goto("http://localhost:3000/superadmin", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        # login
        await page.fill("input[type=email], input[name=email]", "admin@melbet-saas.local")
        await page.fill("input[type=password]", "admin12345")
        await page.click("button[type=submit], button:has-text('Sign in'), button:has-text('Log in')")
        await page.wait_for_timeout(3000)
        print("after login url:", page.url)

        # provider gate?
        body = await page.evaluate("() => document.body.innerText.slice(0,300)")
        print("screen:", body.replace("\n", " | ")[:200])
        # pick Diamond Exch if gate present
        try:
            await page.click("button:has-text('Diamond Exch')", timeout=4000)
            print(">> picked Diamond Exch on gate")
        except Exception:
            print(">> no gate; setting localStorage directly")
            await page.evaluate("() => localStorage.setItem('zeroapi_admin_provider','diamondexch')")
        await page.wait_for_timeout(2000)

        # go to matches
        await page.goto("http://localhost:3000/app/matches", wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)

        # what providers are rendered? read sport/league cells won't show provider; query API state via the rows count
        rows = await page.evaluate("() => document.querySelectorAll('tbody tr').length")
        print("matches rows rendered:", rows)
        print("=== captured /api/matches & /api/admin/stats requests ===")
        for u in CALLS:
            print(" ", u)
        await b.close()

asyncio.run(main())

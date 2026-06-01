#!/usr/bin/env python3
"""d247 demo-login discovery: click 'Login with demo ID', then capture the
sportsbook's JSON API endpoints + the in-play / sports DOM structure."""
import asyncio
import json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

API_HITS = []


async def on_response(resp):
    try:
        url = resp.url
        ct = resp.headers.get("content-type", "")
        if "application/json" in ct or any(k in url.lower() for k in
                ("market", "odds", "sport", "match", "event", "game", "inplay", "fixture", "list", "competition")):
            body = ""
            try:
                if "json" in ct:
                    body = (await resp.text())[:600]
            except Exception:
                body = "<unreadable>"
            API_HITS.append((resp.status, url, ct, body))
    except Exception:
        pass


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await browser.new_context(locale="en-US", user_agent=UA,
                                        viewport={"width": 1440, "height": 1000})
        page = await ctx.new_page()
        page.on("response", on_response)

        await page.goto("https://d247.com/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(10000)

        # Click "Login with demo ID"
        clicked = False
        for sel in ["text=Login with demo ID", "text=demo", "button:has-text('demo')", "a:has-text('demo')"]:
            try:
                el = await page.query_selector(sel)
                if el:
                    await el.click()
                    clicked = True
                    print(f">> clicked demo via: {sel}")
                    break
            except Exception:
                pass
        print(">> demo clicked:", clicked)
        await page.wait_for_timeout(12000)  # let dashboard + feeds load

        print("FINAL URL:", page.url)
        print("TITLE:", await page.title())

        try:
            txt = await page.evaluate("() => document.body.innerText.slice(0, 2000)")
        except Exception:
            txt = ""
        print("\n=== VISIBLE TEXT ===\n", txt)

        # Try to surface the sportsbook nav + any event rows
        try:
            struct = await page.evaluate("""() => {
                const navTexts = [...document.querySelectorAll('a,li,span,div')]
                  .map(n => (n.innerText||'').trim())
                  .filter(t => /cricket|football|soccer|tennis|kabaddi|basketball|in-?play|sports/i.test(t) && t.length < 30);
                return { navSample: [...new Set(navTexts)].slice(0, 25) };
            }""")
        except Exception:
            struct = {}
        print("\n=== NAV / SPORT HINTS ===\n", json.dumps(struct, indent=2))

        print("\n=== JSON / API ENDPOINTS ===")
        seen = set()
        for status, url, ct, body in API_HITS:
            base = url.split("?")[0]
            if base in seen:
                continue
            seen.add(base)
            print(f"[{status}] {url[:160]}")
            if body:
                print(f"    {body[:300]}")
        print(f"\n({len(API_HITS)} responses, {len(seen)} distinct)")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

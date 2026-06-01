#!/usr/bin/env python3
"""Discovery probe for BC.Game sportsbook. Tries the primary + mirror domains,
renders in real Chrome, and reports: reachable URL, whether sports are visible
without login, JSON/API endpoints (odds feeds), and DOM hints."""
import asyncio, json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

DOMAINS = ["https://bc.game", "https://bcgame.im", "https://bc.fun", "https://bcga.me"]
SPORT_PATHS = ["/sports", "/sports?bt-path=%2Flive", "/sportsbook", "/sport"]
API_HITS = []


async def on_response(resp):
    try:
        url = resp.url
        ct = resp.headers.get("content-type", "")
        if ("application/json" in ct or any(k in url.lower() for k in
                ("sport", "odds", "market", "event", "match", "fixture", "live", "betby", "bt-", "outcome", "tournament"))):
            body = ""
            try:
                if "json" in ct:
                    body = (await resp.text())[:300]
            except Exception:
                body = "<unreadable>"
            API_HITS.append((resp.status, url, body))
    except Exception:
        pass


async def try_domain(ctx, base):
    page = await ctx.new_page()
    page.on("response", on_response)
    try:
        await page.goto(base, wait_until="domcontentloaded", timeout=45000)
    except Exception as e:
        print(f"  {base} goto: {e}")
        await page.close()
        return None
    await page.wait_for_timeout(8000)
    title = await page.title()
    txt = await page.evaluate("() => document.body.innerText.slice(0,200)")
    print(f"  {base} -> url={page.url} title={title[:50]!r}")
    print(f"     text: {txt.replace(chr(10),' ')[:140]}")
    blocked = any(w in (title + txt).lower() for w in ("just a moment", "access denied", "blocked", "not available", "restricted", "captcha"))
    return page if not blocked else None


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await b.new_context(locale="en-US", user_agent=UA, viewport={"width": 1440, "height": 1000})
        page = None
        base = None
        for d in DOMAINS:
            print(f"trying {d} ...")
            pg = await try_domain(ctx, d)
            if pg:
                page, base = pg, d
                break
        if not page:
            print("\nAll domains blocked/unreachable from this environment.")
            await b.close()
            return

        # Navigate to a sports section
        for sp in SPORT_PATHS:
            try:
                await page.goto(base + sp, wait_until="domcontentloaded", timeout=40000)
                await page.wait_for_timeout(9000)
                n = await page.evaluate("() => document.querySelectorAll('*').length")
                print(f"  {sp}: {n} nodes, url={page.url}")
                if n > 800:
                    break
            except Exception as e:
                print(f"  {sp}: {e}")

        txt = await page.evaluate("() => document.body.innerText.slice(0,800)")
        print("\n=== SPORTS PAGE TEXT ===\n", txt)
        print("\n=== JSON / API ENDPOINTS ===")
        seen = set()
        for status, url, body in API_HITS:
            key = url.split("?")[0]
            if key in seen:
                continue
            seen.add(key)
            print(f"[{status}] {url[:150]}")
            if body:
                print(f"    {body[:200]}")
        print(f"\n({len(API_HITS)} responses, {len(seen)} distinct)")
        await b.close()


asyncio.run(main())

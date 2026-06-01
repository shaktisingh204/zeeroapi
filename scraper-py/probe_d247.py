#!/usr/bin/env python3
"""Discovery probe for d247.com (Diamond Exch).

Renders the site in real Chrome (Cloudflare-challenged), passes the JS check,
then reports: final URL, title, any JSON/XHR API endpoints it calls (exchanges
serve odds via JSON), and a sample of visible sport/market text. This tells us
what is scrapeable without an account before we commit to a scraper design.
"""
import asyncio
import json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

API_HITS = []  # (status, url, content_type, body_preview)


async def on_response(resp):
    try:
        ct = resp.headers.get("content-type", "")
        url = resp.url
        if "application/json" in ct or any(k in url for k in ("/api/", "/apie/", "list", "market", "odds", "sport", "match", "event", "game")):
            body = ""
            try:
                if "application/json" in ct:
                    body = (await resp.text())[:400]
            except Exception:
                body = "<unreadable>"
            API_HITS.append((resp.status, url, ct, body))
    except Exception:
        pass


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await browser.new_context(locale="en-US", user_agent=UA,
                                        viewport={"width": 1440, "height": 900})
        page = await ctx.new_page()
        page.on("response", on_response)

        print(">> navigating to https://d247.com/ ...")
        try:
            await page.goto("https://d247.com/", wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            print("goto error:", e)
        # Give Cloudflare's JS challenge time to clear + SPA to boot.
        await page.wait_for_timeout(12000)

        print("FINAL URL:", page.url)
        print("TITLE:", await page.title())

        # Visible text sample
        try:
            txt = await page.evaluate("() => document.body.innerText.slice(0, 1500)")
        except Exception:
            txt = ""
        print("\n=== VISIBLE TEXT (first 1500 chars) ===")
        print(txt)

        # Look for obvious sport/market structures
        try:
            counts = await page.evaluate("""() => ({
                links: document.querySelectorAll('a').length,
                inputs: document.querySelectorAll('input').length,
                hasLogin: !!document.querySelector('input[type=password]'),
                bodyClass: document.body.className,
            })""")
        except Exception:
            counts = {}
        print("\n=== DOM SUMMARY ===")
        print(json.dumps(counts, indent=2))

        print("\n=== JSON / API ENDPOINTS OBSERVED ===")
        seen = set()
        for status, url, ct, body in API_HITS:
            base = url.split("?")[0]
            if base in seen:
                continue
            seen.add(base)
            print(f"[{status}] {url[:140]}")
            if body:
                print(f"    body: {body[:200]}")
        print(f"\n({len(API_HITS)} total API responses, {len(seen)} distinct paths)")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

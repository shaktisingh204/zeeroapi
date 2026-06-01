#!/usr/bin/env python3
import asyncio, re
from playwright.async_api import async_playwright
import scrape_d247 as S

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await b.new_context(locale="en-US", user_agent=S.UA, viewport={"width":1440,"height":1200})
        page = await ctx.new_page()
        await S.demo_login(page)
        labels = await S.tab_labels(page)
        print("tabs:", labels[:6])
        # find Football index
        idx = labels.index("Football") if "Football" in labels else 1
        await S.open_tab(page, idx)
        cards = await page.evaluate(S.EXTRACT_JS)
        live = [c for c in cards if c.get("live")]
        print(f"football cards={len(cards)} live={len(live)}")
        if live:
            c = live[0]
            print("sample live href:", c.get("href"), "name:", c.get("name"))
        # try enrich flow on first live
        target = None
        for c in cards:
            h = c.get("href") or ""
            if c.get("live") and re.search(r"/(game-details|cricketv|virtual-cricket)/\d+/\d+", h) and S.split_teams(c.get("name","")):
                target = c; break
        if not target:
            print("no live target"); await b.close(); return
        href = target["href"]
        await S.open_tab(page, idx, light=True)
        el = await page.query_selector(f"a[href='{href}']")
        print("el found:", bool(el))
        if el:
            await el.evaluate("e=>e.scrollIntoView()")
            await el.evaluate("e=>e.click()")
            await page.wait_for_timeout(4000)
            await S.dismiss_modal(page)
            print("url after click:", page.url)
            gm = await page.evaluate("()=>document.querySelectorAll('.game-market').length")
            rows = await page.evaluate("()=>document.querySelectorAll('.market-row').length")
            print("game-market count:", gm, "market-row count:", rows)
            detail = await page.evaluate(S.EXTRACT_DETAIL_JS)
            print("detail score:", (detail or {}).get("score"))
            print("detail markets:", [(m['title'], len(m['rows'])) for m in (detail or {}).get('markets',[])][:6])
            print("mapped odds count:", len(S.detail_to_odds(detail or {})))
        await b.close()

asyncio.run(main())

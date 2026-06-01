#!/usr/bin/env python3
"""Inspect a d247 match DETAIL page (/game-details/{etid}/{id}) to learn the
market / selection / back-lay / fancy / score DOM so we can scrape full markets."""
import asyncio, json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


async def dismiss_modal(page):
    for sel in [".modal.show .btn-close", ".modal.show button.close", ".modal.show .close"]:
        try:
            el = await page.query_selector(sel)
            if el:
                await el.click(timeout=1500); await page.wait_for_timeout(300); return
        except Exception:
            pass
    try:
        await page.keyboard.press("Escape")
    except Exception:
        pass


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await b.new_context(locale="en-US", user_agent=UA, viewport={"width": 1440, "height": 1200})
        page = await ctx.new_page()
        await page.goto("https://d247.com/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(9000)
        await page.click("text=Login with demo ID", timeout=12000)
        await page.wait_for_timeout(11000)
        await dismiss_modal(page)

        # Open the first cricket match detail (etid 4) via in-SPA click.
        link = await page.query_selector("a[href^='/game-details/4/']")
        if not link:
            link = await page.query_selector("a[href^='/game-details/']")
        href = await link.get_attribute("href")
        print("opening detail (in-SPA JS click):", href)
        await link.evaluate("el => el.scrollIntoView()")
        await dismiss_modal(page)
        await link.evaluate("el => el.click()")  # JS click → React Router, keeps session
        await page.wait_for_timeout(9000)
        await dismiss_modal(page)
        for _ in range(4):
            await page.mouse.wheel(0, 2500); await page.wait_for_timeout(400)

        print("URL:", page.url)

        # Dump class-name landscape + a few market section samples.
        struct = await page.evaluate(r"""() => {
            const clean = s => (s||'').replace(/\s+/g,' ').trim();
            // candidate market containers: elements whose header text is a market name
            const out = { classes: {}, markets: [], score: null };
            // tally class names of repeated structures
            for (const el of document.querySelectorAll('div,section')) {
                const c = el.className;
                if (typeof c === 'string' && /market|odd|bet|fancy|runner|selection|game-|score|nation/i.test(c)) {
                    const key = c.split(' ').filter(x=>/market|odd|bet|fancy|runner|selection|game-|score|nation/i.test(x)).join(' ');
                    if (key) out.classes[key] = (out.classes[key]||0)+1;
                }
            }
            // score block
            const sc = document.querySelector("[class*='score'], [class*='Score']");
            if (sc) out.score = clean(sc.innerText).slice(0,200);
            // market sections: find headers then dump the section HTML
            const heads = [...document.querySelectorAll('*')].filter(e => {
                const t = clean(e.innerText);
                return /^(MATCH[_ ]?ODDS|Match Odds|Bookmaker|Normal|oddeven|Fancy|Tied Match|Completed Match|To Win the Toss|Over)/i.test(t) && e.children.length <= 3 && t.length < 40;
            });
            const seen = new Set();
            for (const h of heads.slice(0, 6)) {
                let box = h;
                for (let i=0;i<5 && box.parentElement;i++){ if (box.querySelectorAll('*').length>15) break; box = box.parentElement; }
                if (seen.has(box)) continue; seen.add(box);
                out.markets.push({ header: clean(h.innerText).slice(0,30), cls: box.className, html: clean(box.outerHTML).slice(0, 1100) });
            }
            return out;
        }""")
        print("\n=== repeated class names ===")
        print(json.dumps(struct["classes"], indent=2)[:1500])
        print("\n=== score block ===\n", struct["score"])
        print("\n=== market section samples ===")
        for m in struct["markets"]:
            print(f"\n--- header={m['header']!r} cls={m['cls']!r} ---")
            print(m["html"])
        await b.close()


asyncio.run(main())

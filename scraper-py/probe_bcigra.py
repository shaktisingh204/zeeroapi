#!/usr/bin/env python3
"""Map the BC.Game sportsbook via the guest-accessible bcigra.com/sports:
iframes, odds API/websocket feeds, and event DOM structure."""
import asyncio, json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
REQ = []


def note(r):
    u = r.url
    if any(k in u.lower() for k in ("betby", "sportradar", "betradar", "digitain", "altenar",
            "sportsbook", "odds", "/api/", "event", "market", "sport", "wss", "socket")):
        REQ.append((r.method, u))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await b.new_context(locale="en-US", user_agent=UA, viewport={"width": 1500, "height": 1100})
        page = await ctx.new_page()
        page.on("request", note)
        await page.goto("https://bcigra.com/sports", wait_until="domcontentloaded", timeout=50000)
        await page.wait_for_timeout(12000)
        print("url:", page.url)
        print("title:", await page.title())

        # frames (the sportsbook widget is usually an iframe)
        print("\n=== FRAMES ===")
        for f in page.frames:
            print(f"  url={f.url[:120]!r}")

        # visible text of main content
        txt = await page.evaluate("() => document.body.innerText.slice(0, 600)")
        print("\n=== TEXT ===\n", txt.replace("\n", " | ")[:500])

        # try to read event rows in the largest frame
        print("\n=== FRAME EVENT HINTS ===")
        for f in page.frames:
            try:
                info = await f.evaluate(r"""() => {
                    const t = document.body ? document.body.innerText : '';
                    const hasOdds = /\d+\.\d{2}/.test(t);
                    const cls = {};
                    for (const e of document.querySelectorAll('[class]')) {
                        const c = (e.className.baseVal||e.className||'')+'';
                        for (const x of c.split(' ')) if (/event|market|odd|outcome|sport|league|competitor|bet/i.test(x)) cls[x]=(cls[x]||0)+1;
                    }
                    const top = Object.entries(cls).sort((a,b)=>b[1]-a[1]).slice(0,12);
                    return { len: t.length, hasOdds, sample: t.slice(0,160), top };
                }""")
                if info["len"] > 200:
                    print(f"  frame {f.url[:70]!r}: len={info['len']} odds={info['hasOdds']}")
                    print(f"     text: {info['sample']!r}")
                    print(f"     classes: {info['top']}")
            except Exception:
                pass

        print("\n=== SPORTSBOOK / API REQUESTS ===")
        seen = set()
        for m, u in REQ:
            k = u.split("?")[0]
            if k in seen:
                continue
            seen.add(k)
            print(f"  {m} {u[:130]}")
        print(f"({len(REQ)} reqs, {len(seen)} distinct)")
        await b.close()


asyncio.run(main())

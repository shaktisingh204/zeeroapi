#!/usr/bin/env python3
"""Find d247's full 'All Sports' list and how each item navigates (href / etid)."""
import asyncio, json
from playwright.async_api import async_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True)
        ctx = await browser.new_context(locale="en-US", user_agent=UA,
                                        viewport={"width": 1440, "height": 1200})
        page = await ctx.new_page()
        await page.goto("https://d247.com/", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(9000)
        await page.click("text=Login with demo ID", timeout=12000)
        await page.wait_for_timeout(11000)

        # The "All Sports" panel: find the heading then enumerate its sibling items.
        data = await page.evaluate(r"""() => {
            const clean = s => (s||'').replace(/\s+/g,' ').trim();
            // any element whose text is exactly a sport label inside the left menu
            const result = { anchors: {}, items: [] };
            // 1) all anchors that look like sport routes
            for (const a of document.querySelectorAll('a[href]')) {
                const h = a.getAttribute('href');
                if (/^\/(all-sports|sports-book|sportsbook|sportbook)\//.test(h)) {
                    result.anchors[h] = clean(a.innerText).slice(0,30);
                }
            }
            // 2) find the "All Sports" header and dump nearby clickable items' markup
            const heads = [...document.querySelectorAll('*')].filter(e =>
                clean(e.innerText) === 'All Sports' && e.children.length <= 2);
            if (heads.length) {
                let box = heads[0];
                for (let i=0;i<4 && box.parentElement;i++) box = box.parentElement;
                const items = [...box.querySelectorAll('a,li,div')].filter(e =>
                    /cricket|football|soccer|tennis|kabaddi|basketball|volleyball|badminton|snooker|hockey|boxing|golf|rugby|baseball|darts|futsal|handball|esoccer|politics|wrestling/i
                      .test(clean(e.innerText)) && clean(e.innerText).length < 30);
                const seen = new Set();
                for (const it of items.slice(0, 60)) {
                    const key = clean(it.innerText);
                    if (seen.has(key)) continue; seen.add(key);
                    result.items.push({
                        text: key,
                        tag: it.tagName,
                        href: it.getAttribute('href'),
                        html: it.outerHTML.replace(/\s+/g,' ').slice(0, 160),
                    });
                }
            }
            return result;
        }""")
        print("=== sport-route anchors ===")
        print(json.dumps(data["anchors"], indent=2, ensure_ascii=False))
        print("\n=== All Sports items (sample markup) ===")
        for it in data["items"][:30]:
            print(f"- {it['text']:<20} href={it['href']}  <{it['tag']}> {it['html'][:110]}")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

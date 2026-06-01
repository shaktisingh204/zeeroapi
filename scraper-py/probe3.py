"""Probe 3: extract match cards + links from a list page, then map a match
detail page's full market list (names + outcomes + odds)."""
from playwright.sync_api import sync_playwright

def setup(p):
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(locale="en-US", viewport={"width": 1440, "height": 1200},
        user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"))
    return b, ctx

with sync_playwright() as p:
    b, ctx = setup(p)
    page = ctx.new_page()
    page.goto("https://india.melbet.com/en/live", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(7000)

    cards = page.evaluate("""() => {
        const out=[];
        document.querySelectorAll('.ui-sports-event').forEach((e,i)=>{
            if(i>4) return;
            const a = e.querySelector("a[href*='/live/'], a[href*='/line/']");
            out.push({
                href: a ? a.getAttribute('href') : null,
                text: e.innerText.replace(/\\n+/g,' | ').slice(0,200),
            });
        });
        return out;
    }""")
    print("=== LIST: .ui-sports-event cards ===")
    match_url = None
    for c in cards:
        print(" href:", c["href"])
        print(" text:", c["text"])
        if c["href"] and not match_url and c["href"].count("/") >= 4:
            match_url = c["href"]

    if not match_url:
        # fall back: any anchor that looks like a match (has a numeric-id last seg)
        match_url = page.evaluate("""() => {
            for (const a of document.querySelectorAll("a[href*='/live/'],a[href*='/line/']")){
              const h=a.getAttribute('href'); const segs=h.split('/').filter(Boolean);
              if(segs.length>=4 && /^\\d+-/.test(segs[segs.length-1])) return h;
            } return null;
        }""")
    print("\n>>> chosen match url:", match_url)

    if match_url:
        full = "https://india.melbet.com" + match_url if match_url.startswith("/") else match_url
        page.goto(full, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(8000)
        print("detail title:", page.title())

        markets = page.evaluate("""() => {
            const out=[];
            // each market block usually has a title + a row of outcomes(name+coef)
            const blocks = document.querySelectorAll("[class*='market-block'], [class*='bet-block'], [class*='dashboard-markets__market'], [class*='markets-group']");
            blocks.forEach((bl,i)=>{
                if(i>8) return;
                const title = bl.querySelector("[class*='title'],[class*='caption'],[class*='name']");
                out.push({cls: bl.className.slice(0,50), title: title?title.innerText.trim():null, text: bl.innerText.replace(/\\n+/g,' | ').slice(0,220)});
            });
            return out;
        }""")
        print("\n=== DETAIL: market blocks ===")
        for m in markets:
            print(" -", m["cls"], "| title:", repr(m["title"]))
            print("    text:", m["text"])
    b.close()

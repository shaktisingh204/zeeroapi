"""Probe 2: map the match-card DOM structure so we know what to extract."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://india.melbet.com/en/live"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    ctx = browser.new_context(
        locale="en-US", viewport={"width": 1440, "height": 1200},
        user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"))
    page = ctx.new_page()
    page.goto(URL, wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(7000)

    # Find the repeating game container. Try common 1xbet SPA selectors.
    candidates = [
        "[class*='dashboard-game']", "[class*='c-events__item']",
        "[class*='game-block']", "[class*='ui-game']", "[class*='line-event']",
        "[class*='dashboard-event']", "[class*='event-block']",
    ]
    for sel in candidates:
        n = page.eval_on_selector_all(sel, "els => els.length")
        if n:
            print(f"SELECTOR {sel} -> {n} elements")

    # Dump the outerHTML of the first element that contains a .ui-market, walking
    # up a few levels to capture the whole card.
    sample = page.evaluate("""() => {
        const mk = document.querySelector('.ui-market');
        if (!mk) return 'NO .ui-market';
        let el = mk;
        for (let i=0;i<6;i++){ if(el.parentElement) el=el.parentElement; }
        return el.outerHTML.slice(0, 4000);
    }""")
    print("\n===== CARD OUTER HTML (truncated) =====\n", sample)

    # Also: the text content of the first 3 'market' headers and their values
    info = page.evaluate("""() => {
        const out=[];
        document.querySelectorAll('.dashboard-markets__market, [class*=market-group], [class*=markets__market]').forEach((g,i)=>{
            if(i>4) return;
            out.push({cls:g.className, text:g.innerText.slice(0,160)});
        });
        return out;
    }""")
    print("\n===== MARKET GROUP SAMPLES =====")
    for r in info:
        print(" -", r["cls"][:60], "=>", repr(r["text"]))

    browser.close()

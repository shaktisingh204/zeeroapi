from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(locale="en-US", viewport={"width": 1440, "height": 1200},
        user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"))
    page = ctx.new_page()
    page.goto("https://india.melbet.com/en/live", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(7000)

    # Collect every match-like URL anywhere on the page
    urls = page.evaluate("""() => {
        const s=new Set();
        document.querySelectorAll("a[href]").forEach(a=>{
            const h=a.getAttribute('href')||'';
            const segs=h.split('/').filter(Boolean);
            if((h.includes('/live/')||h.includes('/line/')) && segs.length>=5 && /^\\d+-/.test(segs[segs.length-1]))
                s.add(h);
        });
        return [...s];
    }""")
    print("match-like URLs found:", len(urls))
    for u in urls[:8]:
        print("  ", u)

    if urls:
        full = "https://india.melbet.com" + urls[0]
        print("\n>>> opening:", full)
        page.goto(full, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(9000)
        print("title:", page.title())
        body = page.inner_text("body")
        # Print the middle section where markets live
        lines = [l.strip() for l in body.split("\n") if l.strip()]
        print("total non-empty lines:", len(lines))
        print("\n===== BODY TEXT (lines 30..130) =====")
        for l in lines[30:130]:
            print(l)
    b.close()

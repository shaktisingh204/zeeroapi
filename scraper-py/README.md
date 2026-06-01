# melbet page scraper (Python + Playwright)

Renders melbet's pages in **real Chrome** (via Playwright) and extracts matches +
markets **with their real human-readable names** — then POSTs them to the Rust
backend's ingest API.

## Why a browser (not plain HTTP)

melbet is a JavaScript SPA behind an anti-bot layer:

- Plain HTTP requests to its HTML routes are reset (HTTP 000).
- Even if fetched, the raw HTML has **no odds** — they load over XHR.
- The XHR feeds return **numeric codes** (`G=101`, `T=401`) with no names.

A real browser solves all three: it passes the anti-bot check, runs the JS so the
odds render, and the page itself resolves the codes into names like
`Match Result → W1`, `Total → Over`, `Double Chance → 1X`. We read those rendered
names straight from the DOM — no code-guessing, no dictionary to maintain.

## What it extracts

For every match row (`.dashboard-game`) on the live page and each `/line/<sport>`
page: teams, score, kickoff/period, league (`.dashboard-champ` title), and each
market column (named from the champ header labels + per-cell `aria-label`).

## Setup

```bash
cd scraper-py
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium   # or rely on installed Google Chrome (channel="chrome")
```

## Run

### Real-time mode (recommended) — `realtime.py`

Opens **one persistent tab per sport** and keeps them open. melbet's own SPA
streams odds into those tabs over its WebSocket, so each DOM stays live. Every
second we read **all tabs in parallel** (a fast DOM eval — no navigation) and
POST concurrently. Result: ~1 s cadence, all sports at once, each pass ~40 ms,
odds in the DB <1 s behind the live site.

```bash
.venv/bin/python realtime.py              # 1s cadence, all sports in parallel
.venv/bin/python realtime.py --interval 1
.venv/bin/python realtime.py --headed     # watch it
```

Steady state is gentle on melbet: after the one-time warm-up it does **not**
re-navigate pages — melbet only sees the persistent WebSocket per tab, not page
loads every second. Add/remove sports in the `TARGETS` list.

> On "0 ms": truly zero is physical impossibility. We read whatever the live SPA
> currently shows, so our lag = melbet's own push interval + the ~1 s poll —
> sub-second in practice. For exact tick-level parity you'd tap the WebSocket.

### One-shot / fixed-interval mode — `scrape.py`

Navigates each page fresh (heavier). Good for prematch snapshots.

```bash
.venv/bin/python scrape.py            # one pass
.venv/bin/python scrape.py --loop 30  # every 30s
```

Config via env:

| Var          | Default                  | Meaning                              |
|--------------|--------------------------|--------------------------------------|
| `BACKEND_URL`| `http://localhost:8081`  | Rust backend base URL                |
| `INGEST_KEY` | `dev-ingest-key`         | must match the backend's `INGEST_KEY`|

Add or remove sports by editing the `TARGETS` list at the top of `scrape.py`.

## How it connects

```
Chrome (Playwright)  ->  scrape.py  ->  POST /api/ingest/snapshot  ->  Postgres  ->  dashboard
        renders             extracts        (X-Ingest-Key auth)         upsert        live UI
```

The backend upserts into the same `sports / leagues / matches / odds` tables the
dashboard already reads, tagging rows `source = 'page-*'`.

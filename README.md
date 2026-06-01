# ZeroApi — Multi-Provider Sports Odds & Live-Score Data API

ZeroApi scrapes **sports, leagues, matches, live scores and odds** from multiple
bookmakers/exchanges, normalizes them into one schema, and serves them through a
**provider-scoped public REST API** with API-key auth, rate limits, monthly quotas,
usage analytics, billing, and auto-derived results. It ships with a developer
**portal** (`/portal`) and an operator **admin console** (`/app`).

**Providers:** `melbet` · `1xbet` · `betwinner` · `megapari` (1xbet-family SPAs, real-Chrome
Playwright DOM) · `diamondexch` / d247 (Playwright, demo-login) · `bcgame` (BetBy/sptpub JSON
API) · `1win` (top-parser JSON feed, no browser). More can be added.

```
   bookmakers / exchanges
   ┌─────────┬───────────┬──────────┐
   │ melbet  │  d247     │ bc.game  │
   └────┬────┴─────┬─────┴────┬─────┘
   Playwright   Playwright   httpx (BetBy JSON)
        │           │           │   scrapers POST → /api/ingest/snapshot (X-Ingest-Key)
        └───────────┴───────────┴──────────────┐
                                                ▼
                          ┌─────────────────────────────────┐
                          │  Rust backend (axum, port 8081)  │
                          │  • Postgres 16 (sqlx)            │
                          │  • Redis (rate-limit/quota/cache)│
                          │  • public API  /api/v1/*         │
                          │  • portal API  /api/portal/*     │
                          │  • admin API   /api/admin/*      │
                          │  • auto-result settler           │
                          └───────────────┬─────────────────┘
                                          │ JSON
                          ┌───────────────▼─────────────────┐
                          │  Next.js 16 frontend (port 3000) │
                          │  /  landing · /docs · /status    │
                          │  /portal  developer portal       │
                          │  /app     admin console          │
                          └──────────────────────────────────┘
```

> ⚖️ **Legal note:** the provider endpoints are undocumented; scraping may conflict
> with their Terms of Service and with local gambling-data regulations. Scrapers are
> rate-limited and configurable. Ensure you are authorized to collect and use this
> data in your jurisdiction.

---

## Tech stack

| Layer     | Choice                                                                 |
|-----------|------------------------------------------------------------------------|
| Backend   | Rust · axum · tokio · sqlx (Postgres) · reqwest · Redis · JWT (argon2)  |
| Scrapers  | Python · Playwright (real Chrome) · httpx                              |
| Frontend  | Next.js 16 (App Router) · TypeScript · Tailwind · Recharts             |
| Data      | PostgreSQL 16 · Redis                                                   |

---

## Prerequisites

- **Rust** (stable) + Cargo
- **Node.js 20+** and npm
- **Python 3.10+**
- **PostgreSQL 16** (running locally)
- **Redis** (optional but recommended — rate-limit, quota, usage counters)
- **Google Chrome** (the melbet & d247 scrapers drive real Chrome via Playwright)

Default local ports: **backend 8081**, **frontend 3000**, **Postgres 5432**, **Redis 6379**.
(8081 not 8080 — VLC commonly squats 8080.)

---

## 1. Database & Redis

```bash
# Postgres 16 — create role + db, both named "melbet"
createuser melbet --createdb 2>/dev/null || true
psql postgres -c "ALTER USER melbet WITH PASSWORD 'melbet';"
createdb -O melbet melbet

# Redis
redis-server --daemonize yes
```

Migrations run automatically on backend boot (`sqlx::migrate!`) — no manual step.

---

## 2. Backend (Rust API, port 8081)

```bash
cd backend
# create .env with the keys below
cargo run     # runs migrations, seeds an admin, serves /api, starts the melbet
              # page-scraper supervisor + the auto-result settler
```

**`backend/.env`:**

```ini
BIND_ADDR=0.0.0.0:8081
DATABASE_URL=postgres://melbet:melbet@localhost:5432/melbet
REDIS_URL=redis://127.0.0.1:6379
INGEST_KEY=dev-ingest-key                 # scrapers authenticate with this
JWT_SECRET=change-me
BOOTSTRAP_ADMIN_EMAIL=admin@melbet-saas.local
BOOTSTRAP_ADMIN_PASSWORD=admin12345
# Stripe (optional — billing endpoints 404 until set)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PORTAL_BASE_URL=http://localhost:3000
# melbet scraper supervision
PAGE_SCRAPER_PYTHON=../scraper-py/.venv/bin/python
PAGE_SCRAPER_SCRIPT=../scraper-py/realtime.py
CORS_ORIGINS=http://localhost:3000
```

The backend **supervises the melbet scraper** automatically (toggle on the admin
Settings tab via `page_sync_enabled`). The d247 and bc.game scrapers run standalone
(step 4).

---

## 3. Frontend (Next.js, port 3000)

```bash
cd frontend
npm install
echo 'NEXT_PUBLIC_API_URL=http://localhost:8081/api' > .env.local
npm run dev          # http://localhost:3000
```

- **Landing:** `/`  ·  **API docs:** `/docs`  ·  **Status:** `/status`  ·  **Changelog:** `/changelog`
- **Developer portal:** `/portal` (sign up `/signup` · sign in `/login`)
- **Admin console:** `/app` (sign in at `/login`; one login routes admins → `/app`,
  customers → `/portal`). Seeded admin: `admin@melbet-saas.local` / `admin12345`.

---

## 4. Scrapers (Python / Playwright)

```bash
cd scraper-py
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chrome
```

| Provider | Command | Notes |
|----------|---------|-------|
| **melbet** | *(auto)* | Supervised by the backend. Override sports with `MELBET_LINE_SPORTS`. |
| **1xbet** | `.venv/bin/python scrape_1xbet.py --loop 30` | 1xbet-family SPA, real Chrome. Rotating mirrors — override entry domain with `ONEXBET_BASE_URL` (default `https://1x001.com`). |
| **betwinner** | `.venv/bin/python scrape_betwinner.py --loop 30` | 1xbet-family SPA, real Chrome. `BETWINNER_BASE_URL` (default `https://betwinner1.com`; fallback `https://betwinner.cm`). |
| **megapari** | `.venv/bin/python scrape_megapari.py --loop 30` | 1xbet-family SPA, real Chrome. `MEGAPARI_BASE_URL` (default `https://megapari.com`). |
| **1win** | `.venv/bin/python scrape_1win.py --loop 20` | Pure JSON (no browser) via top-parser `lp-feed` (live only). `ONEWIN_BASE_URL` / `ONEWIN_FEED` / `ONEWIN_FEED_LIMIT` overridable. |
| **diamondexch (d247)** | `.venv/bin/python scrape_d247.py --loop 150` | Real Chrome + demo login; `D247_DETAIL_CAP=15` controls live-match market enrichment. |
| **bc.game** | `.venv/bin/python scrape_bcgame.py --loop 30` | Pure JSON (no browser). `BCGAME_BRAND` / `BCGAME_SPTPUB_API` overridable. |

All scrapers POST to `POST /api/ingest/snapshot` with header `X-Ingest-Key: $INGEST_KEY`,
tagging every row with its `provider`. New providers start **disabled** — enable them
on the admin **Providers** tab.

---

## 5. Use the API

1. Sign up at `/signup` → developer portal `/portal`.
2. **Create an API key** (Overview tab) → "Test now" opens the Playground prefilled.
3. Call the provider-scoped API:

```bash
# provider in the path (canonical)
curl -H "X-API-Key: YOUR_KEY" "http://localhost:8081/api/v1/melbet/live"

# or provider as a query param (equivalent)
curl -H "X-API-Key: YOUR_KEY" "http://localhost:8081/api/v1/live?provider=melbet"
```

Full reference with copy-paste examples: **http://localhost:3000/docs**.

---

## Auto-results

A backend settler marks a live match `finished` once it stops updating (it left the
live feed = it ended) and derives the winner (`W1`/`Draw`/`W2`) from the last-known
score. Tunable on the admin **Settings** tab (`result_enabled`, `result_stale_minutes`).
Surfaced at `GET /api/v1/{provider}/results` and the admin Matches "Winner" column.

---

## Project structure

```
backend/          Rust API, scheduler, scraper supervisor, migrations/
  src/routes/     v1 (public) · portal · admin · ingest · auth · status
  src/jobs/       scheduler: usage rollup + auto-result settler
scraper-py/       realtime.py (melbet) · scrape_1xbet.py · scrape_betwinner.py
                  scrape_megapari.py · scrape_1win.py · scrape_d247.py · scrape_bcgame.py
frontend/         Next.js app
  src/app/        / landing · /docs · /status · /changelog · /portal · /app
  src/components/ ui.tsx (DataTable, Card, Badge, …) · Shell · AdminInsights
  src/lib/        config · providers · theme · hooks · api · portal
```

---

## Common gotchas

- **Backend is on 8081, not 8080.** Frontend + scrapers point at `:8081`.
- **melbet anti-bot:** request bursts get IP-throttled (connection timeouts). The
  scraper warms tabs gently; if blocked, give it a cooldown.
- **Redis optional:** the app runs without it, but rate-limit/quota/usage analytics
  need it.
- **Providers disabled by default:** enable them on the admin Providers tab before
  they appear in the public API.

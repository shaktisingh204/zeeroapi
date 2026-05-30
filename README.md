# Melbet SaaS — Sports / Odds / Live-Score Scraper & Admin Dashboard

A full-stack SaaS platform that scrapes **sports, matches, odds and live scores** from
the melbet (1xbet-family) public line/live feeds, stores them in PostgreSQL, and exposes
them through a Rust API and a wide admin dashboard.

```
┌──────────────┐     scrape (JSON feeds)     ┌──────────────────────┐
│ india.melbet │ ◀────────────────────────── │  Rust backend (axum) │
└──────────────┘                             │  • scheduler          │
                                             │  • REST API + JWT     │
                                             │  • PostgreSQL (sqlx)  │
                                             └──────────┬───────────┘
                                                        │ /api (JSON)
                                             ┌──────────▼───────────┐
                                             │  Next.js dashboard    │
                                             │  overview · live ·    │
                                             │  matches · odds ·     │
                                             │  sports · jobs ·      │
                                             │  settings · users     │
                                             └───────────────────────┘
```

> ⚖️ **Legal note:** these provider feed endpoints are undocumented and scraping may
> conflict with the site's Terms of Service and with local gambling-data regulations.
> The scraper is rate-limited and the target/partner/language are configurable. Make
> sure you are authorized to collect and use this data in your jurisdiction.

---

## Tech stack

| Layer      | Choice                                                            |
|------------|-------------------------------------------------------------------|
| Backend    | Rust · axum · tokio · sqlx (PostgreSQL) · reqwest · JWT (argon2)   |
| Scraper    | reqwest + tolerant `serde_json` parser, background tokio scheduler |
| Frontend   | Next.js 16 (App Router) · TypeScript · Tailwind · Recharts        |
| Infra      | docker-compose · PostgreSQL 16                                     |

---

## Quick start (Docker — everything at once)

```bash
cp backend/.env.example backend/.env        # optional, compose sets its own env
docker compose up --build
```

- API → http://localhost:8080/api/health
- Dashboard → http://localhost:3000
- Login with the seeded admin: **admin@melbet-saas.local / admin12345**

---

## Local development

### 1. Database

```bash
docker compose up -d db
# or use your own Postgres and set DATABASE_URL accordingly
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # edit DATABASE_URL / JWT_SECRET / MELBET_* as needed
cargo run                     # runs migrations + seeds admin on first boot
```

The server listens on `http://0.0.0.0:8080`. The background scheduler starts two loops
(prematch + live) immediately unless `SCRAPE_ENABLED=false`.

### 3. Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

---

## API overview

All `/api/admin/*` routes and `/auth/me` require an `Authorization: Bearer <jwt>` header.

| Method | Path                          | Role    | Description                          |
|--------|-------------------------------|---------|--------------------------------------|
| POST   | `/api/auth/login`             | public  | Email/password → JWT                 |
| GET    | `/api/auth/me`                | any     | Current user                         |
| GET    | `/api/sports`                 | any     | Sports catalog                       |
| PATCH  | `/api/sports/:id/toggle`      | editor  | Enable/disable a sport               |
| GET    | `/api/matches`                | any     | Filter by status/sport/league/search |
| GET    | `/api/matches/:id`            | any     | Match detail + odds                  |
| GET    | `/api/matches/:id/odds`       | any     | Odds for a match                     |
| GET    | `/api/odds/:match_id/history` | any     | Line-movement history                |
| GET    | `/api/live`                   | any     | All live matches                     |
| GET    | `/api/admin/stats`            | any     | Dashboard KPIs                       |
| GET    | `/api/admin/logs`             | any     | Scrape run history                   |
| POST   | `/api/admin/scrape/:job`      | editor  | Trigger `sports`/`prematch`/`live`   |
| GET    | `/api/admin/settings`         | any     | Runtime settings                     |
| PUT    | `/api/admin/settings/:key`    | admin   | Update a setting                     |
| GET    | `/api/admin/users`            | admin   | List users                           |
| POST   | `/api/admin/users`            | admin   | Create user                          |
| DELETE | `/api/admin/users/:id`        | admin   | Delete user                          |

### Example

```bash
TOKEN=$(curl -s localhost:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@melbet-saas.local","password":"admin12345"}' | jq -r .token)

curl -s localhost:8080/api/admin/stats -H "Authorization: Bearer $TOKEN" | jq
curl -s -X POST localhost:8080/api/admin/scrape/live -H "Authorization: Bearer $TOKEN" | jq
```

---

## How the scraper works

`backend/src/scraper/melbet.rs` targets the provider's `LineFeed` / `LiveFeed` JSON
endpoints (e.g. `GetSportsShortZip`, `Get1x2_VZip`, `GetGameZip`). The parser is
**tolerant**: it walks `serde_json::Value`, skips anything it can't understand, and never
fails a whole pass for one bad record.

### All markets, every line

Each odd carries a market group (`G`) and outcome type (`T`). `collect_odds` captures
**every** line a game exposes, from all three places the provider hides them:

| Source       | Where it lives        | What it holds                                  |
|--------------|-----------------------|------------------------------------------------|
| `E`          | list & game feeds     | the headline line of each market group         |
| `AE[].ME`    | list feeds            | **every** line within each group (all totals…) |
| `GE[].E`     | `GetGameZip` per game | the **complete** market tree (props, periods…) |

Lines are deduped by `(group, type, param)` and persisted with their **raw** `group_id`
and `type_code`, so nothing is ever lost — even markets we don't have a human name for
yet are stored as `Group <id>` / `T<code>` and can be relabelled later by extending
`market_name` / `classify`. The 1x2 / Handicap / Total groups were verified live against
real odds (covered by unit tests in `melbet.rs` using a captured fixture).

The list (`live`/`prematch`) jobs already capture every group the feed returns
(~24 lines/match across 16+ groups). The **`full`** job calls `GetGameZip` per match to
pull the entire market tree (hundreds of lines incl. player props & period bets); it is
rate-limited and capped per pass, and is exposed as the **"All markets"** button on the
Scrape Jobs page (`POST /api/admin/scrape/full`).

## Two scraping engines

The project has **two** scrapers that write to the same tables (the dashboard reads
both; rows are tagged with a `source` column):

| Engine | How | Market names | Anti-bot | Best for |
|--------|-----|--------------|----------|----------|
| **Feed** (Rust) | JSON LineFeed/LiveFeed endpoints | numeric codes (`G`/`T`) mapped where known, else `Group N` | can be throttled | max breadth/speed, raw line history |
| **Page** (Python) | real Chrome renders the SPA → reads the DOM | **real names** (`Match Result/W1`, `Total/Over`…) resolved by the site itself | bypassed (real browser) | clean, human-readable data |

### Page scraper (recommended for readable markets)

melbet's HTML is a JS SPA behind an anti-bot layer, so its odds aren't in the raw HTML
and the feeds expose only numeric codes. The Python scraper (`scraper-py/`) renders the
pages in **real Chrome via Playwright**, which both passes the anti-bot check and lets
the page resolve the codes into names. It then POSTs structured matches to
`POST /api/ingest/snapshot` (auth: `X-Ingest-Key`).

```bash
cd scraper-py
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scrape.py --loop 30      # continuous; see scraper-py/README.md
```

```
Chrome (Playwright) → scrape.py → POST /api/ingest/snapshot → Postgres → dashboard
```

If the provider changes its API shape, you only need to adjust:
- the endpoint builders (`sports_url`, `prematch_url`, `live_url`), and
- the field names in `parse_game` / `parse_score` / `parse_odds`.

Everything downstream (DB, API, dashboard) stays the same.

### Tuning

| Env var                        | Default | Meaning                              |
|--------------------------------|---------|--------------------------------------|
| `MELBET_BASE_URL`              | india.melbet.com | Target origin               |
| `MELBET_PARTNER`               | 8       | Partner id used by the feeds         |
| `SCRAPE_PREMATCH_INTERVAL_SECS`| 300     | Prematch refresh cadence             |
| `SCRAPE_LIVE_INTERVAL_SECS`    | 20      | Live refresh cadence                 |
| `SCRAPE_REQUEST_DELAY_MS`      | 400     | Polite delay between HTTP requests   |
| `SCRAPE_ENABLED`               | true    | Master switch for background loops   |

`scrape_enabled` / interval settings can also be changed at runtime from the
**Settings** page in the dashboard (the scheduler reads the `settings` table each pass).

---

## Project layout

```
backend/
  migrations/0001_init.sql      # schema (users, sports, leagues, matches, odds, logs…)
  src/
    main.rs                     # axum bootstrap, CORS, scheduler spawn
    config.rs  db.rs  error.rs  models.rs  auth.rs  state.rs
    scraper/{melbet.rs,types.rs}
    routes/{auth,sports,matches,odds,live,admin}.rs
    jobs/{mod.rs,scheduler.rs}
frontend/
  src/
    lib/{api.ts,types.ts}
    components/{Shell.tsx,ui.tsx}
    app/
      login/page.tsx
      (dashboard)/{layout,page}.tsx
      (dashboard)/{live,matches,sports,jobs,settings,users}/...
docker-compose.yml
```

---

## Security notes

- Change `JWT_SECRET` and the bootstrap admin password before any real deployment.
- Roles: `admin` (full), `editor` (trigger scrapes, toggle sports), `viewer` (read-only).
- Passwords are hashed with argon2; JWTs expire after `JWT_EXPIRY_HOURS`.
# zeeroapi

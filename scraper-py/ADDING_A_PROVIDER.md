# Adding a new provider

ZeroApi is provider-scoped: every public endpoint lives under `/api/v1/{provider}/…`
and serves data tagged with that provider. Adding a bookmaker/exchange is four
steps — a DB migration, a scraper, a process entry, and an admin toggle.

The data flow is always the same:

```
scrape_<provider>.py  ──POST /api/ingest/snapshot (X-Ingest-Key)──▶  backend
   (Playwright DOM or httpx JSON)                                    upserts
                                                                     sports → leagues → matches → odds
                                                              ──▶  /api/v1/<provider>/*
```

---

## 1. Database migration (provider row + capabilities)

Create `backend/migrations/NNNN_<provider>_provider.sql` (next free number):

```sql
INSERT INTO providers (slug, name, base_url, is_active, capabilities) VALUES
    ('myprovider', 'My Provider', 'https://example.com', FALSE,
     '["sports","leagues","sidebar","matches","live","odds"]')
ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;
```

- Ship **`is_active = FALSE`**; enable in the admin UI once the data looks right.
- `capabilities` gate which endpoints the provider exposes. Only list what the
  scraper actually produces. `sidebar` requires `sports` (it reuses that cap).
- Migrations run automatically on backend boot (`sqlx::migrate!`). No manual step.

## 2. Scraper script

Create `scraper-py/scrape_myprovider.py`. Reuse the existing patterns:

- **DOM site (anti-bot / SPA / login):** copy the shape of `scrape_1xbet.py`
  (Playwright, chunked POST) or `scrape_d247.py` (async + login + detail
  enrichment). Drive real Chrome, read rendered rows.
- **JSON feed:** copy `scrape_1win.py` / `scrape_bcgame.py` (httpx, no browser).

Required pieces (see any existing scraper):

```python
PROVIDER = "myprovider"                 # MUST match providers.slug
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8081")
INGEST_KEY  = os.environ.get("INGEST_KEY", "dev-ingest-key")
```

Build each match as an `IngestMatch` (see `backend/src/routes/ingest.rs`):

```python
{
  "ext_id": 12345,            # provider's stable match id (or None → hashed)
  "sport": "Cricket", "league": "Indian Premier League",
  "home": "CSK", "away": "MI", "status": "live",   # or "prematch"/"finished"
  "home_score": 1, "away_score": 0, "period": "Innings 2", "time": "67'",
  "markets": [
    {"market": "Match Result", "outcome": "W1", "value": 1.85, "param": None},
    {"market": "Total", "outcome": "Over", "value": 1.90, "param": 2.5},
  ],
}
```

POST in chunks of ~80:

```python
client.post(f"{BACKEND_URL}/api/ingest/snapshot",
            headers={"X-Ingest-Key": INGEST_KEY},
            json={"source": "myprovider-live", "provider": PROVIDER, "matches": chunk})
```

**Sidebar / sports-tree (recommended):** also POST the full "All Sports" catalog
so every sport shows up even with no live match. Use the shared helper
`_ingest.post_sidebar(client, PROVIDER, sports)` where `sports` is
`[{"name": "Cricket", "leagues": [{"name": "IPL"}]}]`. The backend accepts this
in `Snapshot.sports`. `scrape_d247.py`'s `scrape_sidebar()` is the reference.

Support the standard flags: `--loop <secs>` (0 = single pass), `--dry-run`
(extract + print, don't POST), and `--headed` (browser scrapers, watch it).

Smoke test:

```bash
INGEST_KEY=$(grep ^INGEST_KEY= ../backend/.env | cut -d= -f2-) \
  .venv/bin/python scrape_myprovider.py --dry-run
```

## 3. Process entry (PM2)

Add the scraper to `ecosystem.config.cjs` `apps` array (loop interval in seconds):

```js
scraper('scrape_myprovider', 'scrape_myprovider.py', 30),
```

`deploy.sh --with-scrapers` (or `pm2 start ecosystem.config.cjs`) then runs it.
(Exception: melbet is *not* listed here — the backend supervises it via
`page_sync_enabled` in `backend/.env`.)

## 4. Enable in admin

Once a pass populates data, open the admin console → **Providers** →
toggle `myprovider` active. It now appears in `/api/v1/myprovider/*`, the docs,
and the provider list.

---

## Checklist

- [ ] `backend/migrations/NNNN_myprovider_provider.sql` (is_active FALSE, capabilities)
- [ ] `scraper-py/scrape_myprovider.py` (PROVIDER slug matches; chunked POST; `--loop/--dry-run`)
- [ ] (optional) sidebar tree via `_ingest.post_sidebar`
- [ ] `ecosystem.config.cjs` app entry
- [ ] verify `--dry-run`, then one live pass, then `curl /api/v1/myprovider/sports`
- [ ] enable in admin

## Reference

- Ingest contract: `backend/src/routes/ingest.rs` (`Snapshot`, `IngestMatch`, `IngestOdd`, `IngestSportNode`)
- Public API + capability gating: `backend/src/routes/v1.rs`
- Working scrapers: `scrape_d247.py` (DOM+login+sidebar), `scrape_1xbet.py` (DOM), `scrape_1win.py` / `scrape_bcgame.py` (JSON)
- Shared ingest helper: `_ingest.py`

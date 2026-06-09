/**
 * PM2 ecosystem for the ZeroApi / melbet-saas stack.
 *
 * Runs the backend + frontend + every standalone provider scraper under PM2 so
 * they stay up in the background: auto-restart on crash, and survive reboots
 * once you run `pm2 startup` + `pm2 save`.
 *
 *   pm2 start ecosystem.config.cjs                       # backend + frontend + scrapers
 *   pm2 start ecosystem.config.cjs --only backend,frontend
 *   pm2 status            # see everything
 *   pm2 logs              # tail all logs   (pm2 logs scrape_1xbet for one)
 *   pm2 restart all       # after a rebuild
 *   pm2 delete all        # tear down
 *
 * Ports / secrets are NOT hardcoded:
 *   • INGEST_KEY is read live from backend/.env (so scrapers authenticate).
 *   • FRONTEND_PORT / BACKEND_PORT come from the environment, defaulting to the
 *     same values deploy.sh uses (3100 / 8081).
 *
 * NOTE: the `melbet` scraper is intentionally absent — the backend supervises it
 * itself (PAGE_SCRAPER_* in backend/.env; toggle page_sync_enabled in admin).
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const BACKEND_DIR = path.join(ROOT, 'backend');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const SCRAPER_DIR = path.join(ROOT, 'scraper-py');
const LOG_DIR = path.join(ROOT, 'logs');
const VENV_PY = path.join(SCRAPER_DIR, '.venv', 'bin', 'python');
const NEXT_BIN = path.join(FRONTEND_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');

// Minimal .env reader (KEY=value, ignores comments/blank lines).
function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  } catch (_) { /* backend/.env may not exist before first deploy.sh run */ }
  return out;
}

const backendEnv = readEnvFile(path.join(BACKEND_DIR, '.env'));

const BACKEND_PORT = process.env.BACKEND_PORT || '8081';
const FRONTEND_PORT = process.env.FRONTEND_PORT || '3100';
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${BACKEND_PORT}`;
const INGEST_KEY = process.env.INGEST_KEY || backendEnv.INGEST_KEY || 'dev-ingest-key';

// d247 sits behind Cloudflare AND blocks this server's IP, so its scraper must
// egress through an India residential proxy. Keep the secret OUT of git — set it
// in backend/.env (gitignored) as a STICKY session URL, e.g.:
//   D247_PROXY=http://USER_area-IN_session-d247prod1_life-30:PASS@proxy.smartproxy.net:3120
const D247_PROXY = process.env.D247_PROXY || backendEnv.D247_PROXY || '';

const scraperEnv = { BACKEND_URL, INGEST_KEY };

// Defaults shared by every process.
const common = {
  autorestart: true,
  max_restarts: 20,
  restart_delay: 3000,
  kill_timeout: 8000,
  merge_logs: true,
  time: true,
};

function logs(name) {
  return {
    out_file: path.join(LOG_DIR, `${name}.out.log`),
    error_file: path.join(LOG_DIR, `${name}.err.log`),
  };
}

function scraper(name, script, loop, opts = {}) {
  return {
    ...common,
    ...logs(name),
    name,
    cwd: SCRAPER_DIR,
    interpreter: VENV_PY,
    script,
    // opts.engine pins a browser engine (e.g. 'playwright' when an auth proxy is
    // used — auth proxies only work on the Playwright-based engines, not nodriver).
    args: `--loop ${loop}${opts.engine ? ` --engine ${opts.engine}` : ''}`,
    env: { ...scraperEnv, ...(opts.env || {}) },
  };
}

module.exports = {
  apps: [
    {
      ...common,
      ...logs('backend'),
      name: 'backend',
      cwd: BACKEND_DIR,
      // The Rust binary loads backend/.env itself (dotenvy) given cwd=backend.
      script: path.join(BACKEND_DIR, 'target', 'release', 'melbet-saas-backend'),
    },
    {
      ...common,
      ...logs('frontend'),
      name: 'frontend',
      cwd: FRONTEND_DIR,
      interpreter: 'node',
      script: NEXT_BIN,
      // package.json's "start" is pinned to 3000 — drive the real port here.
      args: `start -p ${FRONTEND_PORT}`,
      env: { NODE_ENV: 'production' },
    },
    scraper('scrape_1xbet', 'scrape_1xbet.py', 30),
    scraper('scrape_betwinner', 'scrape_betwinner.py', 30),
    scraper('scrape_megapari', 'scrape_megapari.py', 30),
    scraper('scrape_1win', 'scrape_1win.py', 20),
    // d247: force the Playwright engine (auth proxy support) and inject the
    // residential proxy when D247_PROXY is set in backend/.env.
    scraper('scrape_d247', 'scrape_d247.py', 150, {
      engine: 'playwright',
      env: D247_PROXY ? { D247_PROXY } : {},
    }),
    scraper('scrape_bcgame', 'scrape_bcgame.py', 30),
  ],
};

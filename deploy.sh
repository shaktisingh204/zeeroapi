#!/usr/bin/env bash
#
# deploy.sh — one-shot server deploy for ZeroApi (Rust backend + Next.js frontend
# + Python scrapers + Postgres + Redis).
#
# Idempotent. On the FIRST run it:
#   • generates backend/.env and frontend/.env.local with fresh secrets,
#   • creates the Postgres role + database,
# then on every run it installs deps, builds, and (unless --no-start) launches
# the stack in the background with logs + pidfiles under ./logs.
#
# Re-running is safe: existing .env files are preserved (secrets are NOT
# regenerated), the DB is only created if absent, and already-listening
# services are left alone.
#
# Runs the whole stack as root: if not root, it re-execs under sudo (preserving
# the invoking user's PATH/cargo/node). Set NO_SUDO=1 to run as the current user.
#
# Usage:
#   ./deploy.sh                 # full bootstrap + build + start (elevates via sudo)
#   ./deploy.sh --no-build      # skip dependency install / compile
#   ./deploy.sh --no-start      # bootstrap + build only (don't launch services)
#   ./deploy.sh --with-scrapers # also launch the standalone provider scrapers
#   ./deploy.sh --stop          # stop services started by this script
#   NO_SUDO=1 ./deploy.sh       # do NOT elevate; run as the current user
#   ./deploy.sh --help
#
# Override defaults via env, e.g.:
#   sudo PUBLIC_HOST=15.235.234.216 ./deploy.sh   # server: bake public IP into the frontend + CORS
#   BACKEND_PORT=8081 FRONTEND_PORT=3100 PUBLIC_API_URL=https://api.example.com/api ./deploy.sh
#   DATABASE_URL=postgres://user:pass@managed-host:5432/db ./deploy.sh   # skips local DB creation
set -euo pipefail

# ----------------------------------------------------------------------------
# Privilege: run the WHOLE script as root.
# If we're not root, re-exec under sudo (preserving the environment so the
# invoking user's PATH / cargo / node / nvm stay visible — sudo normally resets
# it, which would break the toolchain preflight and the build).
#   • Set NO_SUDO=1 to skip elevation and run as the current user.
#   • --help is exempt so you don't get a password prompt just to read usage.
# ----------------------------------------------------------------------------
case "${1:-}" in -h|--help) NO_SUDO=1 ;; esac
if [ "${NO_SUDO:-0}" != 1 ] && [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    printf '\033[1m==>\033[0m Elevating: re-running under sudo as root\n'
    exec sudo -E "$0" "$@"
  else
    printf '\033[33m  !\033[0m sudo not found — continuing as %s (not root)\n' "$(id -un)"
  fi
fi
# Safety net: if we were elevated, make the original user's toolchain dirs
# discoverable even if `sudo -E` was restricted by the security policy.
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
  _uhome="$(eval echo "~$SUDO_USER")"
  for _d in "$_uhome/.cargo/bin" "$_uhome/.local/bin"; do
    [ -d "$_d" ] && case ":$PATH:" in *":$_d:"*) ;; *) PATH="$_d:$PATH" ;; esac
  done
  if [ -d "$_uhome/.nvm/versions/node" ]; then
    _nbin="$(ls -d "$_uhome"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
    [ -n "${_nbin:-}" ] && case ":$PATH:" in *":$_nbin:"*) ;; *) PATH="$_nbin:$PATH" ;; esac
  fi
  export PATH
  export CARGO_HOME="${CARGO_HOME:-$_uhome/.cargo}" RUSTUP_HOME="${RUSTUP_HOME:-$_uhome/.rustup}"
fi

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
SCRAPER_DIR="$REPO_ROOT/scraper-py"
LOG_DIR="$REPO_ROOT/logs"

# ----------------------------------------------------------------------------
# Config (override any of these via the environment)
# ----------------------------------------------------------------------------
DB_NAME="${DB_NAME:-melbet}"
DB_USER="${DB_USER:-melbet}"
DB_PASS="${DB_PASS:-melbet}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

BACKEND_PORT="${BACKEND_PORT:-8081}"   # 8081, not 8080 — VLC commonly squats 8080
FRONTEND_PORT="${FRONTEND_PORT:-3100}"  # 3100, not 3000 — another app owns 3000 on the server

# If DATABASE_URL is supplied, we use it verbatim and skip local DB creation.
DATABASE_URL="${DATABASE_URL:-postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"

# PUBLIC_HOST is the address browsers use to reach this server (its public IP or
# a domain). It drives the API URL baked into the frontend, the backend CORS
# allow-list, and the billing portal base. Default 'localhost' for local dev;
# on a server set e.g. PUBLIC_HOST=15.235.234.216 (or a DNS name).
#
# Did the user explicitly set any public-facing var? If so we (re)write the
# .env files from it; if NOT, we must NOT clobber a hand-edited public value
# with the localhost default — we only fill it in when it's missing.
PUBLIC_EXPLICIT=0
for _v in PUBLIC_HOST PUBLIC_API_URL CORS_ORIGINS PORTAL_BASE_URL; do
  [ -n "${!_v:-}" ] && PUBLIC_EXPLICIT=1
done
PUBLIC_HOST="${PUBLIC_HOST:-localhost}"
PUBLIC_API_URL="${PUBLIC_API_URL:-http://${PUBLIC_HOST}:${BACKEND_PORT}/api}"
# Allow the public origin AND localhost (the browser may hit either). Backend
# splits CORS_ORIGINS on commas.
CORS_ORIGINS="${CORS_ORIGINS:-http://${PUBLIC_HOST}:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}}"
PORTAL_BASE_URL="${PORTAL_BASE_URL:-http://${PUBLIC_HOST}:${FRONTEND_PORT}}"

# Flags
DO_BUILD=1
DO_START=1
WITH_SCRAPERS=0

# ----------------------------------------------------------------------------
# Pretty logging
# ----------------------------------------------------------------------------
if [ -t 1 ]; then C_B=$'\033[1m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'; else C_B=; C_G=; C_Y=; C_R=; C_0=; fi
say()  { printf "%s==>%s %s\n" "$C_B" "$C_0" "$*"; }
ok()   { printf "  %s✓%s %s\n" "$C_G" "$C_0" "$*"; }
warn() { printf "  %s!%s %s\n" "$C_Y" "$C_0" "$*"; }
die()  { printf "%sERROR:%s %s\n" "$C_R" "$C_0" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ----------------------------------------------------------------------------
# Args
# ----------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --no-build)      DO_BUILD=0 ;;
    --no-start)      DO_START=0 ;;
    --with-scrapers) WITH_SCRAPERS=1 ;;
    --stop)          DO_STOP=1 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

mkdir -p "$LOG_DIR"

# ----------------------------------------------------------------------------
# --stop: tear down what we started, then exit
# ----------------------------------------------------------------------------
stop_one() {
  local name="$1" pidfile="$LOG_DIR/$1.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    kill "$(cat "$pidfile")" 2>/dev/null || true
    ok "stopped $name (pid $(cat "$pidfile"))"
  else
    warn "$name not running"
  fi
  rm -f "$pidfile"
}
if [ "${DO_STOP:-0}" = 1 ]; then
  say "Stopping services"
  # PM2-managed apps (the default since this stack moved to PM2)
  if command -v pm2 >/dev/null 2>&1; then
    if pm2 delete "$REPO_ROOT/ecosystem.config.cjs" >/dev/null 2>&1; then
      ok "stopped PM2 apps (backend, frontend, scrapers)"
      pm2 save >/dev/null 2>&1 || true
    else
      warn "no PM2 apps from this stack were running"
    fi
  fi
  # Legacy nohup pidfiles (only present if started with NO_PM2=1)
  for f in "$LOG_DIR"/*.pid; do
    [ -e "$f" ] || continue
    stop_one "$(basename "$f" .pid)"
  done
  exit 0
fi

# ----------------------------------------------------------------------------
# Secret generation (openssl, with a /dev/urandom fallback)
# ----------------------------------------------------------------------------
randhex() {
  local bytes="${1:-32}"
  if have openssl; then openssl rand -hex "$bytes"
  else head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# ============================================================================
# 1. Preflight
# ============================================================================
say "Preflight: checking toolchain"
MISSING=()
for c in cargo node npm python3; do have "$c" || MISSING+=("$c"); done
[ "${#MISSING[@]}" -eq 0 ] || die "missing required tools: ${MISSING[*]}"
ok "cargo $(cargo --version | awk '{print $2}'), node $(node --version), python $(python3 --version | awk '{print $2}')"
have redis-server || warn "redis-server not found — app runs without it, but rate-limit/quota/usage analytics need it"
have psql        || warn "psql not found — cannot auto-create the database (set DATABASE_URL to a ready DB instead)"

# ============================================================================
# 2. Postgres role + database (only if first time)
# ============================================================================
# Run a psql command as a superuser: try the current OS user first (Homebrew /
# trust auth), then fall back to `sudo -u postgres` (typical on Linux).
SUPER_PSQL=""
choose_super_psql() {
  if psql -h "$DB_HOST" -p "$DB_PORT" -U "${PGSUPERUSER:-$(whoami)}" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
    SUPER_PSQL="psql -h $DB_HOST -p $DB_PORT -U ${PGSUPERUSER:-$(whoami)} -d postgres"
  elif have sudo && sudo -n -u postgres psql -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
    SUPER_PSQL="sudo -u postgres psql -d postgres"
  elif have sudo && sudo -u postgres psql -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
    SUPER_PSQL="sudo -u postgres psql -d postgres"
  fi
}

if [[ "$DATABASE_URL" == *"@${DB_HOST}:${DB_PORT}/${DB_NAME}"* ]] && [ "$DB_HOST" = "localhost" ] && have psql; then
  say "Postgres: ensuring role '$DB_USER' and database '$DB_NAME' exist"
  choose_super_psql
  if [ -z "$SUPER_PSQL" ]; then
    warn "could not connect to Postgres as a superuser — skipping DB creation."
    warn "create it manually:  createuser $DB_USER --createdb && createdb -O $DB_USER $DB_NAME"
  else
    if [ "$($SUPER_PSQL -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")" = "1" ]; then
      ok "role '$DB_USER' already exists"
    else
      $SUPER_PSQL -c "CREATE ROLE \"$DB_USER\" LOGIN PASSWORD '$DB_PASS' CREATEDB;" >/dev/null
      ok "created role '$DB_USER'"
    fi
    # Keep the password in sync with DB_PASS (no-op if unchanged).
    $SUPER_PSQL -c "ALTER ROLE \"$DB_USER\" WITH PASSWORD '$DB_PASS';" >/dev/null 2>&1 || true
    if [ "$($SUPER_PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" = "1" ]; then
      ok "database '$DB_NAME' already exists"
    else
      $SUPER_PSQL -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";" >/dev/null
      ok "created database '$DB_NAME'"
    fi
  fi
  say "Migrations run automatically on backend boot (sqlx::migrate!) — no manual step"
else
  say "Using external DATABASE_URL — skipping local Postgres creation"
fi

# ============================================================================
# 3. .env files (generated once, then preserved)
# ============================================================================
say "Environment files"

BACKEND_ENV="$BACKEND_DIR/.env"
if [ -f "$BACKEND_ENV" ]; then
  ok "backend/.env exists — keeping it (secrets preserved)"
else
  JWT_SECRET="$(randhex 32)"
  INGEST_KEY="$(randhex 24)"
  cat > "$BACKEND_ENV" <<EOF
# --- Server ---
BIND_ADDR=0.0.0.0:${BACKEND_PORT}
RUST_LOG=${RUST_LOG:-info}

# --- Database ---
DATABASE_URL=${DATABASE_URL}
DATABASE_MAX_CONNECTIONS=32

# --- Redis (cache + live counters) ---
REDIS_URL=${REDIS_URL}

# --- Ingest (Python scrapers authenticate with this) ---
INGEST_KEY=${INGEST_KEY}

# --- Page scraper supervisor (auto-managed melbet sync) ---
PAGE_SCRAPER_PYTHON=${SCRAPER_DIR}/.venv/bin/python
PAGE_SCRAPER_SCRIPT=${SCRAPER_DIR}/realtime.py

# --- Auth ---
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRY_HOURS=24
BOOTSTRAP_ADMIN_EMAIL=${BOOTSTRAP_ADMIN_EMAIL:-admin@melbet-saas.local}
BOOTSTRAP_ADMIN_PASSWORD=${BOOTSTRAP_ADMIN_PASSWORD:-admin12345}

# --- melbet scraper feed ---
MELBET_BASE_URL=https://india.melbet.com
MELBET_LANG=en
MELBET_PARTNER=8
SCRAPE_ENABLED=true
SCRAPE_PREMATCH_INTERVAL_SECS=300
SCRAPE_LIVE_INTERVAL_SECS=20
SCRAPE_REQUEST_DELAY_MS=400

# --- CORS / billing ---
CORS_ORIGINS=${CORS_ORIGINS}
PORTAL_BASE_URL=${PORTAL_BASE_URL}
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# --- Email ---
# With SMTP_URL blank, signup/reset/usage-alert emails are written to
# MAIL_LOG_PATH (dev). Set SMTP_URL to a relay to send for real.
APP_NAME=ZeroApi
EMAIL_FROM=ZeroApi <no-reply@${PUBLIC_HOST}>
SMTP_URL=
MAIL_LOG_PATH=/tmp/zeroapi-mail.log
EOF
  ok "generated backend/.env (random JWT_SECRET + INGEST_KEY)"
fi

# set KEY=value in an env file (overwrite existing line, else append). Secrets
# and unrelated lines are left untouched.
reconcile_env() { # file KEY value
  local f="$1" k="$2" v="$3"
  if grep -qE "^${k}=" "$f"; then
    sed -i.bak -E "s|^${k}=.*|${k}=${v}|" "$f" && rm -f "$f.bak"
  else
    printf '%s=%s\n' "$k" "$v" >> "$f"
  fi
}
# set KEY only if it's missing — never clobber an existing (possibly hand-edited) value
fill_env() { # file KEY value
  grep -qE "^${2}=" "$1" || reconcile_env "$1" "$2" "$3"
}

FRONTEND_ENV="$FRONTEND_DIR/.env.local"
[ -f "$FRONTEND_ENV" ] || : > "$FRONTEND_ENV"

# NEXT_PUBLIC_API_URL is BAKED INTO THE BUILD and CORS_ORIGINS gates the browser,
# so both must name the PUBLIC host (browsers can't reach the server's localhost).
# If the user passed PUBLIC_HOST/PUBLIC_API_URL/CORS_ORIGINS we rewrite from it;
# otherwise we only fill blanks so a bare re-run can't revert a hand edit to
# localhost.
if [ "$PUBLIC_EXPLICIT" = 1 ]; then
  reconcile_env "$BACKEND_ENV"  CORS_ORIGINS        "$CORS_ORIGINS"
  reconcile_env "$BACKEND_ENV"  PORTAL_BASE_URL     "$PORTAL_BASE_URL"
  reconcile_env "$FRONTEND_ENV" NEXT_PUBLIC_API_URL "$PUBLIC_API_URL"
  ok "public URLs set from PUBLIC_HOST=${PUBLIC_HOST} (API ${PUBLIC_API_URL})"
else
  fill_env "$BACKEND_ENV"  CORS_ORIGINS        "$CORS_ORIGINS"
  fill_env "$BACKEND_ENV"  PORTAL_BASE_URL     "$PORTAL_BASE_URL"
  fill_env "$FRONTEND_ENV" NEXT_PUBLIC_API_URL "$PUBLIC_API_URL"
  ok "kept existing CORS_ORIGINS / NEXT_PUBLIC_API_URL (pass PUBLIC_HOST=… to overwrite)"
fi
PUBLIC_API_URL="$(grep -E '^NEXT_PUBLIC_API_URL=' "$FRONTEND_ENV" | head -1 | cut -d= -f2-)"

# The scrapers read INGEST_KEY/BACKEND_URL from the environment (no dotenv), so
# pull the authoritative INGEST_KEY out of backend/.env for any scraper launch.
INGEST_KEY="$(grep -E '^INGEST_KEY=' "$BACKEND_ENV" | head -1 | cut -d= -f2-)"

# ============================================================================
# 4. Build
# ============================================================================
if [ "$DO_BUILD" = 1 ]; then
  say "Scrapers: Python venv + Playwright"
  if [ ! -x "$SCRAPER_DIR/.venv/bin/python" ]; then
    python3 -m venv "$SCRAPER_DIR/.venv"
    ok "created scraper-py/.venv"
  fi
  "$SCRAPER_DIR/.venv/bin/pip" install -q --upgrade pip >/dev/null
  "$SCRAPER_DIR/.venv/bin/pip" install -q -r "$SCRAPER_DIR/requirements.txt"
  ok "installed scraper requirements"
  if [ "${SKIP_PLAYWRIGHT_INSTALL:-0}" != 1 ]; then
    "$SCRAPER_DIR/.venv/bin/playwright" install chrome >/dev/null 2>&1 \
      || "$SCRAPER_DIR/.venv/bin/playwright" install chromium >/dev/null 2>&1 \
      || warn "playwright browser install failed — install Chrome/Chromium manually"
    ok "Playwright browser ready"
  fi

  say "Backend: cargo build --release"
  ( cd "$BACKEND_DIR" && cargo build --release )
  ok "backend compiled"

  say "Frontend: npm install + build"
  ( cd "$FRONTEND_DIR" && { [ -d node_modules ] && npm install || npm ci 2>/dev/null || npm install; } )
  ( cd "$FRONTEND_DIR" && NEXT_PUBLIC_API_URL="$PUBLIC_API_URL" npm run build )
  ok "frontend built"
else
  warn "--no-build: skipping dependency install and compile"
fi

# ============================================================================
# 5. Start services  (PM2 keeps everything alive in the background)
# ============================================================================
ECOSYSTEM="$REPO_ROOT/ecosystem.config.cjs"
SCRAPER_APPS="scrape_1xbet,scrape_betwinner,scrape_megapari,scrape_1win,scrape_d247,scrape_bcgame"

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1; }

# Pre-PM2 deploys started services with nohup + logs/*.pid. Those processes keep
# holding 8081/3100 and make the PM2 backend crash-loop ("Address already in use
# / os error 98"). Kill any such leftovers before PM2 takes over the ports.
kill_legacy_nohup() {
  local killed=0 f pid
  for f in "$LOG_DIR"/*.pid; do
    [ -e "$f" ] || continue
    pid="$(cat "$f" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true; sleep 1; kill -9 "$pid" 2>/dev/null || true
      killed=1
    fi
    rm -f "$f"
  done
  [ "$killed" = 1 ] && ok "killed leftover nohup processes (freed the ports for PM2)"
}

# Hard-free a TCP port: kill whatever is LISTENING on it, regardless of how it
# was started (orphaned next/cargo/nohup that PM2 lost track of). This is what
# clears the persistent "Address already in use (os error 98)" / EADDRINUSE.
free_port() { # port
  local p="$1" pids=""
  command -v fuser >/dev/null 2>&1 && fuser -k "${p}/tcp" >/dev/null 2>&1 || true
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti "tcp:${p}" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnpH "sport = :${p}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)"
  fi
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true; sleep 1; kill -9 $pids 2>/dev/null || true
    ok "freed port $p"
  fi
}

wait_health() { # poll the backend until /api/health answers (migrations + admin seed run on boot)
  printf "  waiting for /api/health "
  for _ in $(seq 1 60); do
    if curl -fsS -m 2 "http://localhost:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
      printf "ready\n"; return 0
    fi
    printf "."; sleep 1
  done
  printf "timeout\n"; return 1
}

ensure_pm2() {
  have pm2 && { ok "pm2 found: $(command -v pm2)"; return 0; }
  say "PM2 not found — installing globally (npm i -g pm2)"
  # Don't hide the failure: a silent fall-through to nohup is exactly what makes
  # "pm2 didn't start" impossible to diagnose. Show npm's error if it fails.
  if npm install -g pm2; then
    hash -r 2>/dev/null || true   # refresh the shell's command lookup cache
    have pm2 && { ok "pm2 installed: $(command -v pm2)"; return 0; }
    warn "npm reported success but 'pm2' is not on PATH (global bin dir not in PATH?) — falling back to nohup"
    return 1
  fi
  warn "could not install pm2 (see npm error above) — falling back to nohup"
  return 1
}

start_with_pm2() {
  # Pass ports + the real INGEST_KEY through so ecosystem.config.cjs picks them up.
  export BACKEND_PORT FRONTEND_PORT BACKEND_URL="http://localhost:${BACKEND_PORT}" INGEST_KEY
  say "Starting stack under PM2 (web: backend,frontend$([ "$WITH_SCRAPERS" = 1 ] && echo "  scrapers: $SCRAPER_APPS"))"

  # --- Web tier (binds the HTTP ports) ---
  # Only the port-binding apps need the delete → free-port → start dance: deleting
  # first stops PM2 respawning into the port while we free it (that race crash-looped).
  pm2 delete backend frontend >/dev/null 2>&1 || true
  kill_legacy_nohup
  free_port "$BACKEND_PORT"
  free_port "$FRONTEND_PORT"
  # Guard the start: under `set -e` a non-zero exit here would abort the whole
  # script before we could show the cause. Capture it, show pm2's view, retry once.
  if ! pm2 start "$ECOSYSTEM" --only "backend,frontend" --update-env; then
    warn "pm2 start failed (output above) — freeing ports and retrying once"
    free_port "$BACKEND_PORT"; free_port "$FRONTEND_PORT"
    pm2 start "$ECOSYSTEM" --only "backend,frontend" --update-env \
      || die "pm2 could not start the stack. Inspect with: pm2 logs --lines 50"
  fi

  # --- Scrapers (no ports) ---
  # startOrRestart: starts any that are missing, restarts the rest IN PLACE. It
  # never DELETES, so a deploy can't tear down an already-running scraper (e.g.
  # the d247 proxy session you got working). Only touched with --with-scrapers.
  if [ "$WITH_SCRAPERS" = 1 ]; then
    pm2 startOrRestart "$ECOSYSTEM" --only "$SCRAPER_APPS" --update-env \
      || warn "one or more scrapers failed to (re)start — inspect with: pm2 logs <name>"
  fi

  pm2 save >/dev/null 2>&1 || true
  pm2 status || true
  ok "pm2 apps online"
  wait_health || warn "backend health check timed out — inspect with: pm2 logs backend"
  [ "$WITH_SCRAPERS" != 1 ] && warn "scrapers not started — re-run with --with-scrapers (melbet runs via the backend)"
  if ! pm2 startup 2>/dev/null | grep -q "already"; then
    warn "to survive reboots run once:  pm2 startup   (then paste the command it prints)"
  fi
}

# --- nohup fallback launcher (used only if PM2 is genuinely unavailable) -----
start_bg() { # name, logfile, working-dir, command...
  local name="$1" log="$2" wd="$3"; shift 3
  local pidfile="$LOG_DIR/$name.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    warn "$name already running (pid $(cat "$pidfile"))"; return 0
  fi
  ( cd "$wd" && nohup "$@" >>"$log" 2>&1 & echo $! > "$pidfile" )
  ok "$name started (pid $(cat "$pidfile")) → ${log#$REPO_ROOT/}"
}

start_with_nohup() {
  say "Starting backend (port $BACKEND_PORT)"
  if port_busy "$BACKEND_PORT"; then
    warn "port $BACKEND_PORT already in use — assuming backend is up"
  else
    start_bg backend "$LOG_DIR/backend.log" "$BACKEND_DIR" "$BACKEND_DIR/target/release/melbet-saas-backend"
    wait_health || true
  fi

  say "Starting frontend (port $FRONTEND_PORT)"
  if port_busy "$FRONTEND_PORT"; then
    warn "port $FRONTEND_PORT already in use — assuming frontend is up"
  else
    start_bg frontend "$LOG_DIR/frontend.log" "$FRONTEND_DIR" npx next start -p "$FRONTEND_PORT"
  fi

  if [ "$WITH_SCRAPERS" = 1 ]; then
    say "Starting standalone provider scrapers"
    export BACKEND_URL="http://localhost:${BACKEND_PORT}" INGEST_KEY
    PY="$SCRAPER_DIR/.venv/bin/python"
    start_bg scrape_1xbet     "$LOG_DIR/scrape_1xbet.log"     "$SCRAPER_DIR" "$PY" scrape_1xbet.py     --loop 30
    start_bg scrape_betwinner "$LOG_DIR/scrape_betwinner.log" "$SCRAPER_DIR" "$PY" scrape_betwinner.py --loop 30
    start_bg scrape_megapari  "$LOG_DIR/scrape_megapari.log"  "$SCRAPER_DIR" "$PY" scrape_megapari.py  --loop 30
    start_bg scrape_1win      "$LOG_DIR/scrape_1win.log"      "$SCRAPER_DIR" "$PY" scrape_1win.py      --loop 20
    # Streaming mode: park each of D247_WORKERS tabs on a sport and continuously
    # drain d247's decrypted native feed → odds reach the API in ~real time. More
    # tabs = more sports streamed 1:1 (raise D247_WORKERS if the box can take it).
    # The heavy structure/Fancy/Bookmaker full pass still runs every D247_FULL_EVERY.
    D247_WORKERS=12 D247_FULL_EVERY=120 start_bg scrape_d247 "$LOG_DIR/scrape_d247.log" "$SCRAPER_DIR" "$PY" scrape_d247.py --loop 5
    start_bg scrape_bcgame    "$LOG_DIR/scrape_bcgame.log"    "$SCRAPER_DIR" "$PY" scrape_bcgame.py    --loop 30
    warn "melbet is auto-supervised by the backend (toggle page_sync_enabled in the admin Settings tab)"
  fi
}

USED_PM2=0
if [ "$DO_START" = 1 ]; then
  # Redis (best effort, optional) — needed in both modes
  if have redis-server && ! port_busy 6379; then
    redis-server --daemonize yes >/dev/null 2>&1 && ok "redis started" || warn "could not start redis"
  fi

  if [ "${NO_PM2:-0}" != 1 ] && ensure_pm2; then
    start_with_pm2; USED_PM2=1
  else
    start_with_nohup
  fi
fi

# ============================================================================
# Summary
# ============================================================================
echo
say "Done."
if [ "$DO_START" = 1 ]; then
  echo "  Frontend : http://localhost:${FRONTEND_PORT}"
  echo "  API      : ${PUBLIC_API_URL}"
  echo "  Admin    : http://localhost:${FRONTEND_PORT}/app  ($(grep -E '^BOOTSTRAP_ADMIN_EMAIL=' "$BACKEND_ENV" | cut -d= -f2-) / $(grep -E '^BOOTSTRAP_ADMIN_PASSWORD=' "$BACKEND_ENV" | cut -d= -f2-))"
  if [ "$USED_PM2" = 1 ]; then
    echo "  Process  : PM2  ·  pm2 status · pm2 logs · pm2 restart all · stop: ./deploy.sh --stop"
  else
    echo "  Logs     : ${LOG_DIR#$REPO_ROOT/}/   ·   stop with: ./deploy.sh --stop"
  fi
  [ "$WITH_SCRAPERS" != 1 ] && echo "  Scrapers : re-run with --with-scrapers to launch them (melbet runs via the backend)"
else
  echo "  Bootstrap complete. Start later with: ./deploy.sh --no-build"
fi
echo "  Manual scraper runs:  export INGEST_KEY=\$(grep ^INGEST_KEY= backend/.env | cut -d= -f2) BACKEND_URL=http://localhost:${BACKEND_PORT}"
if [ "$PUBLIC_HOST" != "localhost" ]; then
  echo
  say "Production: put TLS in front"
  echo "  Use nginx.conf (TLS reverse proxy: / -> :${FRONTEND_PORT}, /api -> :${BACKEND_PORT})."
  echo "  Then re-run with the https origin so the build + CORS use it:"
  echo "    sudo PUBLIC_HOST=${PUBLIC_HOST} PUBLIC_API_URL=https://${PUBLIC_HOST}/api \\"
  echo "         CORS_ORIGINS=https://${PUBLIC_HOST} PORTAL_BASE_URL=https://${PUBLIC_HOST} ./deploy.sh"
fi

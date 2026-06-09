"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Radio,
  Database,
  Layers,
  Zap,
  Code2,
  ShieldCheck,
  Check,
  Clock,
  TrendingUp,
  Gauge,
  Terminal,
  Boxes,
  RefreshCw,
  Server,
  LineChart as LineChartIcon,
  Plug,
  Rocket,
  BookOpen,
  ChevronDown,
  Quote,
  KeyRound,
  ListChecks,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { DOCS_URL } from "@/lib/portal";
import {
  getProviders,
  getPublicPlans,
  getLandingStats,
  getStatus,
  formatPrice,
  formatQuota,
  type LandingStats,
  type PublicStatus,
} from "@/lib/landing";

/* ------------------------------------------------------------------ */
/*  Shared button styles (light, pill system). One label per intent.  */
/* ------------------------------------------------------------------ */
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(16,185,129,0.7)] transition-all duration-150 hover:bg-emerald-600 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2";
const BTN_GHOST =
  "inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50 focus-visible:ring-offset-2";

/* ------------------------------------------------------------------ */
/*  Reveal-on-scroll via IntersectionObserver (no scroll listeners).  */
/* ------------------------------------------------------------------ */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".lp-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ------------------------------------------------------------------ */
/*  Data                                                              */
/* ------------------------------------------------------------------ */
const PROVIDERS = ["MelBet", "1xBet", "BetWinner", "1Win", "MegaPari", "D247"];

const FEATURES = [
  { icon: Radio, title: "Real-time, every second", body: "Live scores and odds stream in continuously, refreshed in under a second per match.", color: "#10b981", soft: "#ecfdf5" },
  { icon: Database, title: "Multiple providers", body: "One schema across MelBet, 1xBet, BetWinner and more. Switch with a single path segment.", color: "#0ea5e9", soft: "#eff8ff" },
  { icon: Layers, title: "Every market", body: "1x2, totals, handicaps, double chance and full market trees, named in plain English, not coded.", color: "#8b5cf6", soft: "#f5f3ff" },
  { icon: Zap, title: "Built for speed", body: "Cached, indexed and served from Rust. Sub-second responses even under heavy load.", color: "#f59e0b", soft: "#fffbeb" },
  { icon: Code2, title: "OpenAPI + Swagger", body: "A typed spec and live docs for every provider, with copy-paste example responses.", color: "#f43f5e", soft: "#fff1f3" },
  { icon: ShieldCheck, title: "Keys, plans, limits", body: "Issue keys, set plans, enforce rate limits and quotas straight out of the box.", color: "#14b8a6", soft: "#f0fdfa" },
];

const STEPS = [
  { icon: KeyRound, title: "Create a key", body: "Sign up, generate an API key and pick a plan. The free tier needs no card.", color: "#10b981" },
  { icon: Plug, title: "Pick a provider", body: "Choose a bookmaker and a path. Every provider speaks the same response schema.", color: "#0ea5e9" },
  { icon: Rocket, title: "Pull live data", body: "Call the endpoint, read clean JSON, and ship. Rate-limit headers come on every response.", color: "#8b5cf6" },
];

const ENDPOINTS = [
  {
    label: "Live matches",
    method: "GET",
    path: "/v1/melbet/live",
    json: `[
  {
    "match_id": 884213,
    "home_team": "Paris Saint-Germain",
    "away_team": "Arsenal",
    "league": "UEFA Champions League",
    "status": "live",
    "minute": 72,
    "home_score": 1,
    "away_score": 1,
    "odds": [
      { "market": "Match Result", "outcome": "W1", "value": "3.88" },
      { "market": "Match Result", "outcome": "X",  "value": "1.59" },
      { "market": "Total",        "outcome": "Over 2.5", "value": "1.85" }
    ]
  }
]`,
  },
  {
    label: "Prematch",
    method: "GET",
    path: "/v1/1xbet/prematch",
    json: `[
  {
    "match_id": 901774,
    "home_team": "Inter",
    "away_team": "Napoli",
    "league": "Serie A",
    "status": "scheduled",
    "starts_at": "2026-06-14T18:45:00Z",
    "markets_count": 214,
    "odds": [
      { "market": "Match Result", "outcome": "W1", "value": "2.14" },
      { "market": "Both Teams To Score", "outcome": "Yes", "value": "1.72" }
    ]
  }
]`,
  },
  {
    label: "Sports list",
    method: "GET",
    path: "/v1/melbet/sports",
    json: `[
  { "id": 1,  "name": "Football",   "live_matches": 138 },
  { "id": 3,  "name": "Tennis",     "live_matches": 41  },
  { "id": 2,  "name": "Basketball", "live_matches": 27  },
  { "id": 11, "name": "Ice Hockey", "live_matches": 9   }
]`,
  },
  {
    label: "Odds history",
    method: "GET",
    path: "/v1/melbet/match/884213/odds",
    json: `{
  "match_id": 884213,
  "market": "Match Result",
  "outcome": "W1",
  "history": [
    { "t": "20:31:02", "value": "3.40" },
    { "t": "20:46:18", "value": "3.66" },
    { "t": "21:02:55", "value": "3.88" }
  ]
}`,
  },
];

const MARKETS = [
  "1x2", "Double Chance", "Total Goals", "Asian Handicap", "Both Teams To Score",
  "Correct Score", "Draw No Bet", "Half Time / Full Time", "Total Corners",
  "Player Props", "First Goalscorer", "Odd / Even", "Clean Sheet", "Total Cards",
];

const SPORTS = [
  { name: "Football", c: "#10b981" }, { name: "Tennis", c: "#84cc16" },
  { name: "Basketball", c: "#f59e0b" }, { name: "Ice Hockey", c: "#0ea5e9" },
  { name: "Volleyball", c: "#f43f5e" }, { name: "Cricket", c: "#14b8a6" },
  { name: "Baseball", c: "#8b5cf6" }, { name: "Handball", c: "#ec4899" },
  { name: "Table Tennis", c: "#22c55e" }, { name: "Esports", c: "#6366f1" },
  { name: "Rugby", c: "#d97706" }, { name: "Darts", c: "#06b6d4" },
  { name: "Snooker", c: "#16a34a" }, { name: "Boxing / MMA", c: "#ef4444" },
  { name: "Futsal", c: "#3b82f6" }, { name: "Badminton", c: "#a855f7" },
];

const USE_CASES = [
  { icon: LineChartIcon, title: "Odds comparison sites", body: "Surface the best price across bookmakers and track line movement in real time.", color: "#10b981", soft: "#ecfdf5" },
  { icon: Activity, title: "Live score widgets", body: "Embed sub-second scores and timelines into apps without running a scraper yourself.", color: "#0ea5e9", soft: "#eff8ff" },
  { icon: TrendingUp, title: "Trading and models", body: "Feed clean, normalized odds into pricing models and value-finding pipelines.", color: "#8b5cf6", soft: "#f5f3ff" },
  { icon: Boxes, title: "Affiliate platforms", body: "Power content pages with fresh fixtures, markets and prices on autopilot.", color: "#f59e0b", soft: "#fffbeb" },
];

const SDKS = [
  { name: "cURL", install: "curl -H \"X-API-Key: ...\"" },
  { name: "JavaScript", install: "npm i @zeroapi/sdk" },
  { name: "Python", install: "pip install zeroapi" },
  { name: "Go", install: "go get zeroapi.io/go" },
  { name: "PHP", install: "composer require zeroapi/sdk" },
  { name: "Ruby", install: "gem install zeroapi" },
];

const TESTIMONIALS = [
  { quote: "We dropped three scrapers and replaced them with one ZeroApi key. Latency went down, our on-call pages went away.", name: "Mateus Oliveira", role: "Backend Lead, Trambet" },
  { quote: "The schema is the same across every bookmaker. Adding a new provider used to be a sprint. Now it is a path segment.", name: "Priya Nair", role: "Founder, OddsBoard" },
  { quote: "Rate-limit headers on every response sound small. They are the reason our ingestion never trips a ban anymore.", name: "Daniel Kovac", role: "CTO, LineDesk" },
];

const PLANS = [
  { name: "Free", price: "$0", per: "/mo", rate: "60 req/min", quota: "10k requests / mo",
    features: ["1 provider", "Live scores & odds", "Full OpenAPI spec", "Community support"], popular: false },
  { name: "Pro", price: "$49", per: "/mo", rate: "600 req/min", quota: "1M requests / mo",
    features: ["All providers", "Live + prematch + full markets", "Odds history", "Webhooks", "Email support"], popular: true },
  { name: "Enterprise", price: "$499", per: "/mo", rate: "6,000 req/min", quota: "Unlimited requests",
    features: ["Everything in Pro", "Unlimited usage", "99.95% uptime SLA", "Dedicated support", "Custom providers"], popular: false },
];

const FAQS = [
  { q: "Where does the data come from?", a: "We run a real-time scraping and normalization pipeline across major bookmakers, then serve the result through a single typed JSON API. You never run a scraper or maintain selectors yourself." },
  { q: "How fresh is the live data?", a: "Live matches refresh in under one second per match. Prematch fixtures and odds update on a rolling schedule, and every response carries a timestamp so you always know how recent it is." },
  { q: "Can I switch between providers?", a: "Yes. Every provider shares the same response schema, so switching from MelBet to 1xBet is a single path segment. No new parsing code, no surprises." },
  { q: "Do you rate limit?", a: "Each plan has a per-minute rate and a monthly quota. Every response returns rate-limit headers so you can back off cleanly before you ever hit a wall." },
  { q: "Is there a free tier?", a: "Yes. The Free plan needs no card, includes one provider, and is enough to build and test a real integration before you upgrade." },
  { q: "What formats do you return?", a: "Clean JSON with named markets, typed fields and a documented OpenAPI 3 spec. Swagger docs and example responses are live for every endpoint." },
];

const STATS = [
  { n: "6", l: "bookmakers", c: "#10b981" },
  { n: "60+", l: "sports", c: "#0ea5e9" },
  { n: "<1s", l: "live refresh", c: "#8b5cf6" },
  { n: "99.95%", l: "uptime", c: "#f59e0b" },
];

const ODDS_HISTORY = [
  { t: "20:30", W1: 3.40, W2: 5.10 },
  { t: "20:36", W1: 3.52, W2: 4.95 },
  { t: "20:42", W1: 3.49, W2: 5.05 },
  { t: "20:48", W1: 3.66, W2: 4.70 },
  { t: "20:54", W1: 3.71, W2: 4.62 },
  { t: "21:00", W1: 3.80, W2: 4.48 },
  { t: "21:06", W1: 3.88, W2: 4.35 },
];

/* ------------------------------------------------------------------ */
/*  Live odds widget (real stateful component preview, not a mockup)  */
/* ------------------------------------------------------------------ */
function LiveOddsWidget() {
  const [odds, setOdds] = useState({ W1: 3.88, X: 1.59, W2: 5.9 });
  const [flash, setFlash] = useState<string | null>(null);
  const [secs, setSecs] = useState(72 * 60 + 14);
  const [ago, setAgo] = useState(0.4);

  useEffect(() => {
    const tick = setInterval(() => {
      const keys = ["W1", "X", "W2"] as const;
      const k = keys[Math.floor(Math.random() * keys.length)];
      setOdds((o) => {
        const next = Math.max(1.05, +(o[k] + (Math.random() - 0.5) * 0.24).toFixed(2));
        return { ...o, [k]: next };
      });
      setFlash(k);
      setAgo(+(Math.random() * 0.6 + 0.2).toFixed(1));
      setTimeout(() => setFlash(null), 900);
    }, 2000);
    const clock = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => {
      clearInterval(tick);
      clearInterval(clock);
    };
  }, []);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div className="relative w-full max-w-md">
      {/* soft colorful halo behind the card */}
      <div aria-hidden className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-emerald-200/50 via-sky-200/40 to-violet-200/50 blur-2xl" />
      <div className="lp-float relative rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.35)]">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Football · UEFA Champions League</span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-500">
            <span className="live-dot inline-block" /> {mm}:{ss}
          </span>
        </div>

        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-900">Paris Saint-Germain</span>
          <span className="text-lg font-bold tabular-nums text-slate-900">1</span>
        </div>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-900">Arsenal</span>
          <span className="text-lg font-bold tabular-nums text-slate-900">1</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(["W1", "X", "W2"] as const).map((k) => (
            <div
              key={k}
              className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${
                flash === k
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="text-[11px] font-medium text-slate-400">{k}</div>
              <div className="text-sm font-bold tabular-nums text-emerald-600">
                {odds[k].toFixed(2)}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px]">
          <span className="font-mono text-slate-500">GET /v1/melbet/live</span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-600">
            updated {ago}s ago
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Odds history chart (recharts, real colorful visual)               */
/* ------------------------------------------------------------------ */
function OddsHistoryChart() {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={ODDS_HISTORY} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="w1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="w2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} domain={[3, 6]} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 10px 30px -12px rgba(15,23,42,0.25)" }}
            labelStyle={{ color: "#64748b" }}
          />
          <Area type="monotone" dataKey="W1" stroke="#10b981" strokeWidth={2.5} fill="url(#w1)" />
          <Area type="monotone" dataKey="W2" stroke="#0ea5e9" strokeWidth={2.5} fill="url(#w2)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Endpoint explorer (tabbed, real sample responses)                 */
/* ------------------------------------------------------------------ */
function EndpointExplorer() {
  const [active, setActive] = useState(0);
  const ep = ENDPOINTS[active];
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_80px_-40px_rgba(15,23,42,0.4)]">
      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/60 p-3">
        {ENDPOINTS.map((e, i) => (
          <button
            key={e.path}
            onClick={() => setActive(i)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-[0.97] ${
              i === active
                ? "bg-emerald-500 text-white shadow-[0_6px_18px_-8px_rgba(16,185,129,0.8)]"
                : "text-slate-500 hover:bg-white hover:text-slate-900"
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-600">
          {ep.method}
        </span>
        <span className="font-mono text-sm text-slate-700">{ep.path}</span>
      </div>
      <pre className="overflow-x-auto bg-[#0d1117] p-4 text-[13px] leading-relaxed text-slate-200">
        <code>{ep.json}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FAQ accordion                                                     */
/* ------------------------------------------------------------------ */
function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mx-auto max-w-3xl divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white">
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.q}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-slate-50"
            >
              <span className="font-semibold text-slate-900">{f.q}</span>
              <ChevronDown
                size={18}
                className={`shrink-0 text-emerald-500 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            <div className={`lp-acc ${isOpen ? "open" : ""}`}>
              <div>
                <p className="px-6 pb-5 text-sm leading-relaxed text-slate-600">{f.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function Landing() {
  useReveal();

  // ---- Live public data (degrades to the static defaults above) ----
  const [providerNames, setProviderNames] = useState<string[]>(PROVIDERS);
  const [stats, setStats] = useState<LandingStats | null>(null);
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [livePlans, setLivePlans] = useState<typeof PLANS | null>(null);

  useEffect(() => {
    let alive = true;
    getProviders().then((rows) => {
      if (alive && rows.length) setProviderNames(rows.map((r) => r.name));
    });
    getLandingStats().then((s) => alive && s && setStats(s));
    getStatus().then((s) => alive && s && setStatus(s));
    getPublicPlans().then((rows) => {
      if (!alive || !rows.length) return;
      const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
      const mid = sorted.length >= 3 ? 1 : sorted.length - 1;
      setLivePlans(
        sorted.map((p, i) => ({
          name: p.name,
          price: formatPrice(p.price_cents),
          per: "/mo",
          rate: `${p.rate_limit_per_min.toLocaleString()} req/min`,
          quota: formatQuota(p.monthly_quota),
          features: p.features?.length ? p.features : ["Full API access"],
          popular: i === mid,
        }))
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  // Stats band: real counts where we have them, sensible claims otherwise.
  const statHues = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b"];
  const statCards = stats
    ? [
        { n: String(stats.providers), l: "bookmakers", c: statHues[0] },
        { n: `${stats.sports}+`, l: "sports", c: statHues[1] },
        { n: stats.live_matches.toLocaleString(), l: "live matches now", c: statHues[2] },
        { n: `${stats.markets}+`, l: "markets", c: statHues[3] },
      ]
    : STATS;

  const sportHues = [
    "#10b981", "#84cc16", "#f59e0b", "#0ea5e9", "#f43f5e", "#14b8a6",
    "#8b5cf6", "#ec4899", "#22c55e", "#6366f1", "#d97706", "#06b6d4",
    "#16a34a", "#ef4444", "#3b82f6", "#a855f7",
  ];
  const sportCards =
    stats?.top_sports?.length
      ? stats.top_sports.map((s, i) => ({ name: s.name, c: sportHues[i % sportHues.length], matches: s.matches }))
      : SPORTS.map((s) => ({ ...s, matches: 0 }));

  const planCards = livePlans ?? PLANS;

  const statusMeta: Record<string, { label: string; color: string }> = {
    operational: { label: "All systems operational", color: "#10b981" },
    degraded: { label: "Partial degradation", color: "#f59e0b" },
    down: { label: "Service disruption", color: "#f43f5e" },
  };
  const sm = status ? statusMeta[status.overall] ?? statusMeta.operational : null;

  return (
    <div
      style={{ colorScheme: "light" }}
      className="min-h-screen overflow-x-hidden bg-[#fbfcff] font-sans text-slate-700 antialiased"
    >
      {/* ---------------- Nav ---------------- */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 shadow-[0_6px_16px_-6px_rgba(16,185,129,0.8)]">
              <Activity size={18} className="text-white" />
            </span>
            <span className="text-[17px] font-bold tracking-tight text-slate-900">ZeroApi</span>
          </Link>
          <div className="hidden items-center gap-7 text-sm font-medium text-slate-500 md:flex">
            <a href="#features" className="transition-colors hover:text-slate-900">Features</a>
            <a href="#endpoints" className="transition-colors hover:text-slate-900">API</a>
            <a href="#pricing" className="transition-colors hover:text-slate-900">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-slate-900">FAQ</a>
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-slate-900">Docs</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex px-3 py-2">
              Sign in
            </Link>
            <Link href="/signup" className={BTN_PRIMARY}>Get API key</Link>
          </div>
        </nav>
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden">
        {/* colorful ambient mesh (emerald / sky / amber, not AI-purple) */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="lp-blob absolute -left-24 -top-24 h-[440px] w-[440px] rounded-full bg-emerald-300/30 blur-3xl" />
          <div className="lp-blob absolute -right-10 top-0 h-[380px] w-[380px] rounded-full bg-sky-300/30 blur-3xl" style={{ animationDelay: "3s" }} />
          <div className="lp-blob absolute bottom-0 left-1/3 h-[320px] w-[320px] rounded-full bg-amber-200/40 blur-3xl" style={{ animationDelay: "6s" }} />
        </div>

        <div className="relative mx-auto grid min-h-[calc(100dvh-4rem)] max-w-[1200px] grid-cols-1 items-center gap-12 px-5 pt-16 pb-16 lg:grid-cols-2">
          <div className="lp-hero-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Real-time sports data API
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-slate-900 md:text-5xl lg:text-6xl">
              Real-time odds and scores,{" "}
              <span className="bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 bg-clip-text text-transparent">
                one API.
              </span>
            </h1>
            <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-slate-600">
              Live scores and odds from six major bookmakers, normalized into one clean JSON API.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/signup" className={`${BTN_PRIMARY} px-6 py-3 text-base`}>
                Get API key <ArrowRight size={16} />
              </Link>
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className={`${BTN_GHOST} px-6 py-3 text-base`}>
                Read the docs
              </a>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <LiveOddsWidget />
          </div>
        </div>
      </section>

      {/* ---------------- Provider marquee (the only marquee on the page) ---------------- */}
      <section className="overflow-hidden border-y border-slate-200/70 bg-white py-8">
        <p className="mb-6 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Aggregating data from
        </p>
        <div className="relative">
          <div className="lp-marquee-track flex w-max gap-4">
            {[...providerNames, ...providerNames, ...providerNames, ...providerNames].map((p, i) => (
              <div key={i} className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-sm font-bold text-emerald-600 shadow-sm">
                  {p[0]}
                </span>
                <span className="whitespace-nowrap text-sm font-semibold text-slate-700">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Stats band ---------------- */}
      <section className="mx-auto max-w-[1200px] px-5 py-16">
        <div className="lp-reveal grid grid-cols-2 gap-4 md:grid-cols-4">
          {statCards.map((s) => (
            <div key={s.l} className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
              <div className="text-4xl font-bold tabular-nums" style={{ color: s.c }}>{s.n}</div>
              <div className="mt-1 text-sm font-medium text-slate-500">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Features bento ---------------- */}
      <section id="features" className="mx-auto max-w-[1200px] px-5 py-20">
        <div className="lp-reveal mb-12 max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Why ZeroApi</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            One API for every bookmaker
          </h2>
          <p className="mt-3 text-lg text-slate-600">
            Built on a real-time scraping pipeline, served through a typed, provider-scoped API.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            const wide = i === 0;
            return (
              <div
                key={f.title}
                className={`lp-reveal rounded-3xl border border-slate-200 bg-white p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_24px_60px_-30px_rgba(15,23,42,0.35)] ${wide ? "md:col-span-2" : ""}`}
                style={{ transitionDelay: `${i * 50}ms` }}
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: f.soft, color: f.color }}>
                  <Icon size={22} />
                </div>
                <h3 className="text-lg font-bold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 max-w-[48ch] text-sm leading-relaxed text-slate-600">{f.body}</p>
                {wide && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {["1x2", "Totals", "Handicap", "Double Chance", "Correct Score", "BTTS"].map((m) => (
                      <span key={m} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{m}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------- How it works (3 steps) ---------------- */}
      <section className="border-y border-slate-200/70 bg-gradient-to-b from-emerald-50/40 to-white">
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <div className="lp-reveal mb-12 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Live in three steps</h2>
            <p className="mt-3 text-lg text-slate-600">From signup to streaming odds in a few minutes, no infrastructure to run.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.title} className="lp-reveal relative rounded-3xl border border-slate-200 bg-white p-7" style={{ transitionDelay: `${i * 70}ms` }}>
                  <span className="absolute right-6 top-6 text-5xl font-bold tabular-nums text-slate-100">{i + 1}</span>
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: s.color + "1a", color: s.color }}>
                    <Icon size={22} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- Endpoint explorer ---------------- */}
      <section id="endpoints" className="mx-auto max-w-[1200px] px-5 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="lp-reveal">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">The API</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Live odds in one request</h2>
            <p className="mt-3 max-w-[52ch] text-lg text-slate-600">
              Authenticate with your key, pick a provider, and get clean JSON. Every response
              carries rate-limit headers so you always know where you stand.
            </p>
            <ul className="mt-7 space-y-4">
              {[
                { icon: Plug, t: "Provider-scoped paths", d: "/v1/{provider}/... keeps every bookmaker behind one schema." },
                { icon: ListChecks, t: "Named markets, not numeric codes", d: "Read \"Both Teams To Score\", never market id 17." },
                { icon: Gauge, t: "Rate-limit headers on every response", d: "Back off cleanly long before you hit a wall." },
              ].map((row) => {
                const Icon = row.icon;
                return (
                  <li key={row.t} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <Icon size={16} />
                    </span>
                    <div>
                      <p className="font-semibold text-slate-900">{row.t}</p>
                      <p className="text-sm text-slate-500">{row.d}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="lp-reveal">
            <EndpointExplorer />
          </div>
        </div>
      </section>

      {/* ---------------- Markets coverage ---------------- */}
      <section className="border-y border-slate-200/70 bg-white">
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <div className="lp-reveal mb-10 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Every market, named in plain English</h2>
            <p className="mt-3 text-lg text-slate-600">Full market trees for every fixture, decoded so you do not have to maintain a lookup table.</p>
          </div>
          <div className="lp-reveal flex flex-wrap gap-3">
            {MARKETS.map((m, i) => {
              const hues = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#f43f5e", "#14b8a6"];
              const c = hues[i % hues.length];
              return (
                <span
                  key={m}
                  className="rounded-full border bg-white px-4 py-2 text-sm font-semibold"
                  style={{ borderColor: c + "33", color: c, background: c + "0d" }}
                >
                  {m}
                </span>
              );
            })}
            <span className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">200+ more</span>
          </div>
        </div>
      </section>

      {/* ---------------- Sports coverage ---------------- */}
      <section className="mx-auto max-w-[1200px] px-5 py-20">
        <div className="lp-reveal mb-10 max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Coverage</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">60+ sports, one schema</h2>
          <p className="mt-3 text-lg text-slate-600">From football to esports, the response shape never changes. Learn it once, use it everywhere.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {sportCards.map((s, i) => (
            <div
              key={s.name}
              className="lp-reveal flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-slate-300"
              style={{ transitionDelay: `${(i % 4) * 40}ms` }}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={{ background: s.c + "1a", color: s.c }}>
                {s.name[0]}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{s.name}</span>
              {s.matches > 0 && (
                <span className="shrink-0 text-xs font-medium tabular-nums text-slate-400">{s.matches.toLocaleString()}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Odds history (chart) ---------------- */}
      <section className="border-y border-slate-200/70 bg-gradient-to-b from-white to-sky-50/40">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 py-24 lg:grid-cols-2">
          <div className="lp-reveal order-2 lg:order-1 rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.4)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">PSG vs Arsenal · Match Result</p>
                <p className="text-xs text-slate-500">Price movement, last 40 minutes</p>
              </div>
              <span className="flex items-center gap-3 text-xs font-medium">
                <span className="flex items-center gap-1.5 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> W1</span>
                <span className="flex items-center gap-1.5 text-sky-600"><span className="h-2 w-2 rounded-full bg-sky-500" /> W2</span>
              </span>
            </div>
            <OddsHistoryChart />
          </div>
          <div className="lp-reveal order-1 lg:order-2">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">See how a line moved</h2>
            <p className="mt-3 max-w-[52ch] text-lg text-slate-600">
              Every odds change is timestamped and stored. Pull the full history for any market and
              chart drift, steam moves and closing prices.
            </p>
            <ul className="mt-7 space-y-3">
              {["Timestamped snapshots for every market", "Query a single outcome or a full tree", "Ideal for models, alerts and closing-line value"].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm font-medium text-slate-700">
                  <Check size={18} className="mt-0.5 shrink-0 text-emerald-500" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------- Performance band ---------------- */}
      <section className="mx-auto max-w-[1200px] px-5 py-20">
        <div className="lp-reveal overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-900 p-10 text-white md:p-14">
          <div className="grid gap-10 md:grid-cols-[1.2fr_2fr] md:items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Fast enough to sit in your hot path</h2>
              <p className="mt-3 text-slate-300">Served from Rust, cached and indexed. The numbers that matter when you build on top of us.</p>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-4">
              {[
                { icon: Gauge, n: "38ms", l: "median latency", c: "#34d399" },
                { icon: RefreshCw, n: "<1s", l: "live refresh", c: "#38bdf8" },
                { icon: Server, n: "99.95%", l: "uptime", c: "#a78bfa" },
                { icon: Clock, n: "24/7", l: "data pipeline", c: "#fbbf24" },
              ].map((m) => {
                const Icon = m.icon;
                return (
                  <div key={m.l} className="bg-slate-900 p-5">
                    <Icon size={18} style={{ color: m.c }} />
                    <div className="mt-3 text-2xl font-bold tabular-nums">{m.n}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{m.l}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Use cases ---------------- */}
      <section className="border-y border-slate-200/70 bg-white">
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <div className="lp-reveal mb-12 max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Use cases</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Built for teams that ship on sports data</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {USE_CASES.map((u, i) => {
              const Icon = u.icon;
              return (
                <div key={u.title} className="lp-reveal rounded-3xl border border-slate-200 p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_24px_60px_-30px_rgba(15,23,42,0.3)]" style={{ background: u.soft, transitionDelay: `${i * 50}ms`, borderColor: u.color + "33" }}>
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white" style={{ color: u.color }}>
                    <Icon size={22} />
                  </div>
                  <h3 className="font-bold text-slate-900">{u.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{u.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- SDKs / languages ---------------- */}
      <section className="mx-auto max-w-[1200px] px-5 py-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="lp-reveal">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Call it from anything</h2>
            <p className="mt-3 max-w-[50ch] text-lg text-slate-600">
              It is plain HTTP and JSON, so any language works. We also ship thin SDKs for the
              languages teams reach for most.
            </p>
            <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {SDKS.map((s) => (
                <div key={s.name} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-800">
                  {s.name}
                </div>
              ))}
            </div>
          </div>
          <div className="lp-reveal overflow-hidden rounded-3xl border border-slate-200 bg-[#0d1117] shadow-[0_30px_80px_-40px_rgba(15,23,42,0.5)]">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <Terminal size={15} className="text-emerald-400" />
              <span className="text-xs text-slate-400">install &amp; first request</span>
            </div>
            <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed text-slate-200"><code>{`# install the SDK
npm i @zeroapi/sdk

# or just use curl
curl -H "X-API-Key: mk_live_..." \\
  https://api.zeroapi.io/v1/melbet/live

# response: clean, named, typed JSON
[ { "home_team": "PSG", "status": "live", ... } ]`}</code></pre>
          </div>
        </div>
      </section>

      {/* ---------------- Testimonials ---------------- */}
      <section className="border-y border-slate-200/70 bg-gradient-to-b from-violet-50/40 to-white">
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <div className="lp-reveal mb-12 max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Customers</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Teams that stopped running scrapers</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <figure key={t.name} className="lp-reveal flex flex-col rounded-3xl border border-slate-200 bg-white p-6" style={{ transitionDelay: `${i * 60}ms` }}>
                <Quote size={22} className="text-emerald-400" />
                <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-slate-700">{t.quote}</blockquote>
                <figcaption className="mt-5 border-t border-slate-100 pt-4">
                  <div className="text-sm font-bold text-slate-900">{t.name}</div>
                  <div className="text-xs text-slate-500">{t.role}</div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Pricing ---------------- */}
      <section id="pricing" className="mx-auto max-w-[1200px] px-5 py-24">
        <div className="lp-reveal mb-12 max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Pricing</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Start free, scale when you ship</h2>
          <p className="mt-3 text-lg text-slate-600">Every plan includes the full API. Higher tiers raise your limits.</p>
        </div>

        <div className="grid items-start gap-4 md:grid-cols-3">
          {planCards.map((p) => (
            <div
              key={p.name}
              className={`lp-reveal relative rounded-3xl border bg-white p-7 ${
                p.popular
                  ? "border-emerald-300 shadow-[0_30px_80px_-40px_rgba(16,185,129,0.6)] ring-1 ring-emerald-200"
                  : "border-slate-200"
              }`}
            >
              {p.popular && (
                <span className="absolute -top-3 left-7 rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white shadow-[0_6px_16px_-6px_rgba(16,185,129,0.9)]">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-bold text-slate-900">{p.name}</h3>
              <div className="mt-3 flex items-end gap-1">
                <span className="text-4xl font-bold tracking-tight text-slate-900">{p.price}</span>
                <span className="mb-1.5 text-slate-400">{p.per}</span>
              </div>
              <div className="mt-4 space-y-1 text-sm">
                <p className="font-semibold text-slate-700">{p.rate}</p>
                <p className="text-slate-500">{p.quota}</p>
              </div>
              <Link href="/signup" className={`mt-6 w-full ${p.popular ? BTN_PRIMARY : BTN_GHOST}`}>
                Get API key
              </Link>
              <ul className="mt-6 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <Check size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section id="faq" className="border-t border-slate-200/70 bg-white">
        <div className="mx-auto max-w-[1200px] px-5 py-24">
          <div className="lp-reveal mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Questions, answered</h2>
            <p className="mt-3 text-lg text-slate-600">The things teams ask before they wire ZeroApi into production.</p>
          </div>
          <div className="lp-reveal">
            <Faq />
          </div>
        </div>
      </section>

      {/* ---------------- Final CTA ---------------- */}
      <section className="mx-auto max-w-[1200px] px-5 py-24">
        <div className="lp-reveal relative overflow-hidden rounded-[2rem] p-10 text-center md:p-16">
          <div aria-hidden className="lp-gradient absolute inset-0 bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-500" />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.25),transparent_45%)]" />
          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight text-white md:text-5xl">Start building with ZeroApi</h2>
            <p className="mx-auto mt-4 max-w-[48ch] text-lg text-emerald-50">
              Create a free account, generate a key, and pull live odds in minutes.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-base font-semibold text-emerald-700 shadow-lg transition-all duration-150 hover:bg-emerald-50 active:scale-[0.97]">
                Get API key <ArrowRight size={16} />
              </Link>
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white backdrop-blur transition-all duration-150 hover:bg-white/20 active:scale-[0.97]">
                <BookOpen size={16} /> Read the docs
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="border-t border-slate-200/70 bg-white">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-14 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500">
                <Activity size={16} className="text-white" />
              </span>
              <span className="text-[17px] font-bold tracking-tight text-slate-900">ZeroApi</span>
            </div>
            <p className="max-w-[34ch] text-sm leading-relaxed text-slate-500">
              Real-time, multi-provider sports data. Live scores, odds and full market trees through one clean JSON API.
            </p>
          </div>
          <FooterCol title="Product" links={[["Features", "#features"], ["API", "#endpoints"], ["Pricing", "#pricing"], ["Status", "/status"], ["Changelog", "/changelog"]]} />
          <FooterCol title="Developers" links={[["API docs", DOCS_URL], ["FAQ", "#faq"], ["Create account", "/signup"]]} />
          <FooterCol title="Account" links={[["Sign in", "/login"], ["Dashboard", "/portal"], ["Operators", "/login"]]} />
        </div>
        <div className="border-t border-slate-200/70">
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-5 text-xs text-slate-400">
            <span>© 2026 ZeroApi. All rights reserved.</span>
            {sm && (
              <Link
                href="/status"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-slate-600 transition-colors hover:border-slate-300"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: sm.color }} />
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: sm.color }} />
                </span>
                {sm.label}
              </Link>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="mb-3 text-sm font-bold text-slate-900">{title}</h4>
      <ul className="space-y-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith("/") || href.startsWith("#") ? (
              <Link href={href} className="text-sm text-slate-500 transition-colors hover:text-slate-900">{label}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer" className="text-sm text-slate-500 transition-colors hover:text-slate-900">{label}</a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

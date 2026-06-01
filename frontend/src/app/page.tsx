"use client";

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { DOCS_URL } from "@/lib/portal";

// Reveal-on-scroll via IntersectionObserver (no scroll listeners).
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
      { threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

const PROVIDERS = ["MelBet", "1xBet", "BetWinner", "1Win", "MegaPari"];

const FEATURES = [
  { icon: Radio, title: "Real-time, every second", body: "Live scores and odds stream in continuously, refreshed in under a second.", accent: "#ef4444" },
  { icon: Database, title: "Multiple providers", body: "One schema across MelBet, 1xBet, BetWinner and more. Switch with a path segment.", accent: "#3b82f6" },
  { icon: Layers, title: "Every market", body: "1x2, totals, handicaps, double chance and full market trees, named, not coded.", accent: "#22c55e" },
  { icon: Zap, title: "Built for speed", body: "Cached, indexed and served from Rust. Sub-second responses under load.", accent: "#f59e0b" },
  { icon: Code2, title: "OpenAPI + Swagger", body: "A typed spec and live docs for every provider, with example responses.", accent: "#a855f7" },
  { icon: ShieldCheck, title: "Keys, plans, limits", body: "Issue keys, set plans, enforce rate limits and quotas out of the box.", accent: "#14b8a6" },
];

const PLANS = [
  { name: "Free", price: "$0", per: "/mo", rate: "60 req/min", quota: "10k requests/mo",
    features: ["1 provider", "Live scores & odds", "Community support"], popular: false },
  { name: "Pro", price: "$49", per: "/mo", rate: "600 req/min", quota: "1M requests/mo",
    features: ["All providers", "Live + prematch + full markets", "Odds history", "Email support"], popular: true },
  { name: "Enterprise", price: "$499", per: "/mo", rate: "6,000 req/min", quota: "Unlimited requests",
    features: ["All providers", "Unlimited usage", "Priority support", "SLA"], popular: false },
];

function LiveOddsWidget() {
  const [odds, setOdds] = useState({ W1: 3.88, X: 1.59, W2: 5.9 });
  const [flash, setFlash] = useState<string | null>(null);
  const [secs, setSecs] = useState(72 * 60 + 14);

  useEffect(() => {
    const tick = setInterval(() => {
      const keys = ["W1", "X", "W2"] as const;
      const k = keys[Math.floor(Math.random() * keys.length)];
      setOdds((o) => {
        const next = Math.max(1.05, +(o[k] + (Math.random() - 0.5) * 0.24).toFixed(2));
        return { ...o, [k]: next };
      });
      setFlash(k);
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
    <div className="lp-float w-full max-w-md">
      <div className="card p-5 shadow-2xl shadow-black/40 border-border/80 bg-surface/90 backdrop-blur">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-muted">Football · UEFA Champions League</span>
          <span className="flex items-center gap-1.5 text-xs text-live font-medium">
            <span className="live-dot inline-block" /> {mm}:{ss}
          </span>
        </div>

        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-white">Paris Saint-Germain</span>
          <span className="text-lg font-semibold text-white tabular-nums">1</span>
        </div>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-white">Arsenal</span>
          <span className="text-lg font-semibold text-white tabular-nums">1</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(["W1", "X", "W2"] as const).map((k) => (
            <div
              key={k}
              className={`rounded-lg border border-border bg-surface-2 px-2 py-2.5 text-center ${
                flash === k ? "lp-flash" : ""
              }`}
            >
              <div className="text-[11px] text-muted">{k}</div>
              <div className="text-sm font-semibold text-brand tabular-nums">
                {odds[k].toFixed(2)}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between text-[11px] text-muted">
          <span>GET /v1/melbet/live</span>
          <span className="badge bg-brand/15 text-brand">sample</span>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  useReveal();

  return (
    <div className="min-h-screen bg-bg text-gray-200 overflow-x-hidden">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur">
        <nav className="max-w-[1200px] mx-auto h-16 px-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center">
              <Activity size={18} className="text-black" />
            </span>
            <span className="font-semibold text-white">ZeroApi</span>
          </Link>
          <div className="hidden md:flex items-center gap-7 text-sm text-muted">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">Docs</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost">Sign in</Link>
            <Link href="/signup" className="btn-primary">Get API key</Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative">
        {/* ambient emerald glow (not AI-purple) */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="lp-blob absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full bg-brand/10 blur-3xl" />
          <div className="lp-blob absolute top-10 right-0 h-[360px] w-[360px] rounded-full bg-blue-500/10 blur-3xl" style={{ animationDelay: "4s" }} />
        </div>

        <div className="relative max-w-[1200px] mx-auto px-5 pt-20 pb-16 grid lg:grid-cols-2 gap-12 items-center min-h-[calc(100dvh-4rem)]">
          <div className="lp-hero-in">
            <span className="badge bg-surface-2 text-muted mb-5 inline-flex">Sports data API</span>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-white leading-[1.05]">
              Real-time odds and scores, one API.
            </h1>
            <p className="mt-5 text-lg text-muted max-w-[60ch]">
              Sports, matches, live scores and odds from multiple bookmakers, normalized
              and streamed through a single JSON API.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/signup" className="btn-primary text-base px-5 py-2.5">
                Get API key <ArrowRight size={16} />
              </Link>
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="btn-ghost text-base px-5 py-2.5">
                Read the docs
              </a>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <LiveOddsWidget />
          </div>
        </div>
      </section>

      {/* Provider marquee */}
      <section className="border-y border-border/70 py-8 overflow-hidden">
        <p className="text-center text-xs uppercase tracking-[0.18em] text-muted mb-6">
          Aggregating data from
        </p>
        <div className="relative">
          <div className="lp-marquee-track flex w-max gap-4">
            {[...PROVIDERS, ...PROVIDERS, ...PROVIDERS, ...PROVIDERS].map((p, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-5 py-3 shrink-0">
                <span className="h-7 w-7 rounded-md bg-surface-2 text-brand font-bold flex items-center justify-center text-sm">
                  {p[0]}
                </span>
                <span className="text-sm font-medium text-gray-300 whitespace-nowrap">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features bento */}
      <section id="features" className="max-w-[1200px] mx-auto px-5 py-24">
        <div className="lp-reveal max-w-2xl mb-12">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">
            One API for every bookmaker
          </h2>
          <p className="mt-3 text-muted">
            Built on a real-time scraping pipeline, served through a typed, provider-scoped API.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            const wide = i === 0;
            return (
              <div
                key={f.title}
                className={`lp-reveal card p-6 hover:border-brand/40 transition-colors ${wide ? "md:col-span-2" : ""}`}
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div
                  className="h-11 w-11 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: f.accent + "22", color: f.accent }}
                >
                  <Icon size={20} />
                </div>
                <h3 className="text-white font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted max-w-[48ch]">{f.body}</p>
                {wide && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {["1x2", "Totals", "Handicap", "Double Chance", "Correct Score", "BTTS"].map((m) => (
                      <span key={m} className="badge bg-surface-2 text-gray-300">{m}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Code preview */}
      <section className="border-t border-border/70 bg-surface/40">
        <div className="max-w-[1200px] mx-auto px-5 py-24 grid lg:grid-cols-2 gap-12 items-center">
          <div className="lp-reveal">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">
              Live odds in one request
            </h2>
            <p className="mt-3 text-muted max-w-[52ch]">
              Authenticate with your key, pick a provider, and get clean JSON. Every
              response carries rate-limit headers so you always know where you stand.
            </p>
            <ul className="mt-6 space-y-3">
              {["Provider-scoped paths: /v1/{provider}/...", "Named markets, not numeric codes", "Rate-limit headers on every response"].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm text-gray-300">
                  <Check size={18} className="text-brand shrink-0 mt-0.5" /> {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="lp-reveal rounded-2xl border border-border bg-[#0b0e14] overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border">
              <span className="h-3 w-3 rounded-full bg-[#ef4444]/70" />
              <span className="h-3 w-3 rounded-full bg-[#f59e0b]/70" />
              <span className="h-3 w-3 rounded-full bg-[#22c55e]/70" />
              <span className="ml-2 text-xs text-muted">terminal</span>
            </div>
            <pre className="p-4 text-sm leading-relaxed overflow-x-auto"><code>{`$ curl -H "X-API-Key: mk_live_..." \\
    https://api.zeroapi.io/v1/melbet/live

[
  {
    "home_team": "Paris Saint-Germain",
    "away_team": "Arsenal",
    "status": "live",
    "home_score": 1,
    "away_score": 1,
    "odds": [
      { "market": "Match Result", "outcome": "W1", "value": "3.88" },
      { "market": "Total", "outcome": "Over", "value": "1.85" }
    ]
  }
]`}</code></pre>
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className="max-w-[1200px] mx-auto px-5 py-20">
        <div className="lp-reveal grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          {[
            { n: "5", l: "providers" },
            { n: "60+", l: "sports" },
            { n: "1s", l: "refresh interval" },
            { n: "3,600+", l: "odds per sync" },
          ].map((s) => (
            <div key={s.l} className="card p-6">
              <div className="text-3xl md:text-4xl font-semibold text-white tabular-nums">{s.n}</div>
              <div className="mt-1 text-sm text-muted">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border/70 bg-surface/40">
        <div className="max-w-[1200px] mx-auto px-5 py-24">
          <div className="lp-reveal max-w-2xl mb-12">
            <span className="badge bg-surface-2 text-muted mb-4 inline-flex">Pricing</span>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">
              Start free, scale when you ship
            </h2>
            <p className="mt-3 text-muted">Every plan includes the full API. Higher tiers raise your limits.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 items-start">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`lp-reveal card p-6 relative ${p.popular ? "ring-1 ring-brand border-brand" : ""}`}
              >
                {p.popular && (
                  <span className="badge bg-brand text-black absolute -top-3 left-6">Most popular</span>
                )}
                <h3 className="text-white font-semibold">{p.name}</h3>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-4xl font-semibold text-white">{p.price}</span>
                  <span className="text-muted mb-1.5">{p.per}</span>
                </div>
                <div className="mt-4 space-y-1 text-sm">
                  <p className="text-gray-300">{p.rate}</p>
                  <p className="text-muted">{p.quota}</p>
                </div>
                <Link
                  href="/signup"
                  className={`mt-6 w-full ${p.popular ? "btn-primary" : "btn-ghost"}`}
                >
                  Get API key
                </Link>
                <ul className="mt-6 space-y-2.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-gray-300">
                      <Check size={16} className="text-brand shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-[1200px] mx-auto px-5 py-24">
        <div className="lp-reveal card p-10 md:p-14 text-center relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="lp-blob absolute -bottom-20 left-1/3 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
          </div>
          <h2 className="relative text-3xl md:text-5xl font-semibold tracking-tight text-white">
            Start building with ZeroApi
          </h2>
          <p className="relative mt-4 text-muted max-w-[48ch] mx-auto">
            Create a free account, generate a key, and pull live odds in minutes.
          </p>
          <div className="relative mt-8 flex justify-center gap-3">
            <Link href="/signup" className="btn-primary text-base px-6 py-3">
              Get API key <ArrowRight size={16} />
            </Link>
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="btn-ghost text-base px-6 py-3">
              Read the docs
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/70">
        <div className="max-w-[1200px] mx-auto px-5 py-12 grid gap-8 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="h-7 w-7 rounded-lg bg-brand flex items-center justify-center">
                <Activity size={16} className="text-black" />
              </span>
              <span className="font-semibold text-white">ZeroApi</span>
            </div>
            <p className="text-sm text-muted max-w-[28ch]">Real-time multi-provider sports data API.</p>
          </div>
          <FooterCol title="Product" links={[["Features", "#features"], ["Pricing", "#pricing"], ["API docs", DOCS_URL], ["Status", "/status"], ["Changelog", "/changelog"]]} />
          <FooterCol title="Account" links={[["Sign in", "/login"], ["Create account", "/signup"], ["Dashboard", "/portal"]]} />
          <FooterCol title="Operators" links={[["Sign in", "/login"]]} />
        </div>
        <div className="border-t border-border/70">
          <div className="max-w-[1200px] mx-auto px-5 py-5 text-xs text-muted">
            © 2026 ZeroApi. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-white mb-3">{title}</h4>
      <ul className="space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith("/") || href.startsWith("#") ? (
              <Link href={href} className="text-sm text-muted hover:text-white transition-colors">{label}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-white transition-colors">{label}</a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

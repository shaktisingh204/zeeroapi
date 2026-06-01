"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Check, Copy } from "lucide-react";
import { API_V1 } from "@/lib/config";
import { getProviders, type ProviderOption } from "@/lib/providers";
import { portal } from "@/lib/portal";
import type { Plan } from "@/lib/types";

/* ------------------------------------------------------------------ helpers */

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="absolute top-2.5 right-2.5 text-muted hover:text-white transition-colors"
      aria-label="Copy"
    >
      {done ? <Check size={14} className="text-brand" /> : <Copy size={14} />}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <CopyButton text={children} />
      <pre className="bg-[#0b0e14] border border-border rounded-lg p-4 pr-10 overflow-x-auto text-sm">
        <code className="text-gray-200 font-mono whitespace-pre">{children}</code>
      </pre>
    </div>
  );
}

const LANGS = ["curl", "javascript", "python"] as const;
type Lang = (typeof LANGS)[number];

function RequestTabs({ path }: { path: string }) {
  const [lang, setLang] = useState<Lang>("curl");
  const url = `${API_V1}${path}`;
  const snippets: Record<Lang, string> = {
    curl: `curl -H "X-API-Key: $ZEROAPI_KEY" \\\n  "${url}"`,
    javascript: `const res = await fetch("${url}", {\n  headers: { "X-API-Key": process.env.ZEROAPI_KEY },\n});\nconst data = await res.json();`,
    python: `import os, httpx\n\nr = httpx.get(\n    "${url}",\n    headers={"X-API-Key": os.environ["ZEROAPI_KEY"]},\n)\ndata = r.json()`,
  };
  return (
    <div>
      <div className="flex gap-1 mb-2">
        {LANGS.map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              lang === l ? "bg-brand text-black font-medium" : "bg-surface-2 text-muted hover:text-white"
            }`}
          >
            {l === "curl" ? "cURL" : l === "javascript" ? "JavaScript" : "Python"}
          </button>
        ))}
      </div>
      <Code>{snippets[lang]}</Code>
    </div>
  );
}

const METHOD_CLS = "bg-brand/15 text-brand";

interface Param {
  name: string;
  in: "path" | "query";
  required?: boolean;
  desc: string;
}
interface Endpoint {
  id: string;
  path: string; // example path used in snippets (with a real provider)
  display: string; // shown title path with {provider}
  summary: string;
  capability?: string;
  params?: Param[];
  response: string;
}

function EndpointDoc({ ep }: { ep: Endpoint }) {
  return (
    <section id={ep.id} className="scroll-mt-24 border-t border-border pt-8">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className={`badge ${METHOD_CLS}`}>GET</span>
        <code className="text-white font-mono text-sm">{ep.display}</code>
        {ep.capability && (
          <span className="badge bg-surface-2 text-muted">requires “{ep.capability}”</span>
        )}
      </div>
      <p className="text-sm text-muted mb-4">{ep.summary}</p>

      {ep.params && ep.params.length > 0 && (
        <div className="card overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="th">Parameter</th>
                <th className="th">In</th>
                <th className="th">Required</th>
                <th className="th">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ep.params.map((p) => (
                <tr key={p.name}>
                  <td className="td font-mono text-brand">{p.name}</td>
                  <td className="td text-muted">{p.in}</td>
                  <td className="td text-muted">{p.required ? "yes" : "no"}</td>
                  <td className="td text-muted">{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted mb-2">Request</p>
          <RequestTabs path={ep.path} />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted mb-2">Example response</p>
          <Code>{ep.response}</Code>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ content */

const ENDPOINTS: Endpoint[] = [
  {
    id: "providers",
    path: "/providers",
    display: "/v1/providers",
    summary: "List the active data providers you can query.",
    response: `[
  { "slug": "melbet", "name": "MelBet", "base_url": "https://india.melbet.com", "is_active": true },
  { "slug": "bcgame", "name": "BC.Game", "base_url": "https://bc.game", "is_active": true }
]`,
  },
  {
    id: "sports",
    path: "/melbet/sports",
    display: "/v1/{provider}/sports",
    summary: "List sports for a provider, ordered by match volume.",
    capability: "sports",
    params: [{ name: "provider", in: "path", required: true, desc: "Provider slug, e.g. melbet." }],
    response: `[
  { "id": 4, "name": "Cricket", "slug": "cricket", "match_count": 41, "provider": "melbet" },
  { "id": 1, "name": "Football", "slug": "football", "match_count": 320, "provider": "melbet" }
]`,
  },
  {
    id: "leagues",
    path: "/melbet/leagues?sport_id=1",
    display: "/v1/{provider}/leagues",
    summary: "List leagues, optionally filtered by sport.",
    capability: "leagues",
    params: [
      { name: "provider", in: "path", required: true, desc: "Provider slug." },
      { name: "sport_id", in: "query", desc: "Filter to one sport." },
    ],
    response: `[
  { "id": 88, "sport_id": 1, "sport_name": "Football", "name": "Premier League", "country": "England", "match_count": 24 }
]`,
  },
  {
    id: "matches",
    path: "/melbet/matches?status=live&limit=20",
    display: "/v1/{provider}/matches",
    summary: "List matches (prematch + live), newest/live first.",
    capability: "matches",
    params: [
      { name: "provider", in: "path", required: true, desc: "Provider slug." },
      { name: "status", in: "query", desc: "live · prematch · finished" },
      { name: "sport_id", in: "query", desc: "Filter by sport." },
      { name: "league_id", in: "query", desc: "Filter by league." },
      { name: "search", in: "query", desc: "Match team name." },
      { name: "limit", in: "query", desc: "1–500 (default 50)." },
      { name: "offset", in: "query", desc: "Pagination offset." },
    ],
    response: `[
  {
    "id": 887542438404651,
    "provider": "melbet",
    "sport_name": "Football",
    "league_name": "Premier League",
    "home_team": "Arsenal", "away_team": "Chelsea",
    "status": "live", "home_score": 1, "away_score": 0,
    "match_time": "63:21", "result": null, "updated_at": "2026-06-01T20:15:00Z"
  }
]`,
  },
  {
    id: "match",
    path: "/melbet/matches/887542438404651",
    display: "/v1/{provider}/matches/{id}",
    summary: "Full detail for one match, including all odds/markets.",
    capability: "matches",
    params: [
      { name: "provider", in: "path", required: true, desc: "Provider slug." },
      { name: "id", in: "path", required: true, desc: "Match id." },
    ],
    response: `{
  "id": 887542438404651, "home_team": "Arsenal", "away_team": "Chelsea",
  "status": "live", "home_score": 1, "away_score": 0,
  "odds": [
    { "market": "Match Result", "outcome": "W1", "value": "2.10", "param": null },
    { "market": "Total", "outcome": "Over", "value": "1.90", "param": "2.5" }
  ]
}`,
  },
  {
    id: "live",
    path: "/melbet/live",
    display: "/v1/{provider}/live",
    summary: "Currently in-play matches with live scores.",
    capability: "live",
    params: [{ name: "provider", in: "path", required: true, desc: "Provider slug." }],
    response: `[
  { "id": 887542438404651, "home_team": "Arsenal", "away_team": "Chelsea",
    "status": "live", "home_score": 1, "away_score": 0, "match_time": "63:21" }
]`,
  },
  {
    id: "results",
    path: "/melbet/results",
    display: "/v1/{provider}/results",
    summary: "Recently finished matches with their auto-derived winner (W1/Draw/W2).",
    capability: "matches",
    params: [{ name: "provider", in: "path", required: true, desc: "Provider slug." }],
    response: `[
  { "id": 887542438404651, "home_team": "Arsenal", "away_team": "Chelsea",
    "status": "finished", "home_score": 2, "away_score": 1,
    "result": "W1", "finished_at": "2026-06-01T21:05:00Z" }
]`,
  },
  {
    id: "odds",
    path: "/melbet/odds/887542438404651",
    display: "/v1/{provider}/odds/{match_id}",
    summary: "All odds/markets for a match.",
    capability: "odds",
    params: [
      { name: "provider", in: "path", required: true, desc: "Provider slug." },
      { name: "match_id", in: "path", required: true, desc: "Match id." },
    ],
    response: `[
  { "id": 12, "match_id": 887542438404651, "market": "Match Result", "outcome": "W1", "value": "2.10", "param": null },
  { "id": 13, "match_id": 887542438404651, "market": "Match Result", "outcome": "W2", "value": "3.40", "param": null }
]`,
  },
];

const NAV = [
  { id: "intro", label: "Introduction" },
  { id: "auth", label: "Authentication" },
  { id: "limits", label: "Rate limits & plans" },
  { id: "provider-list", label: "Providers" },
  { id: "endpoints", label: "Endpoints" },
  ...ENDPOINTS.map((e) => ({ id: e.id, label: e.display, sub: true })),
  { id: "errors", label: "Errors" },
  { id: "sdks", label: "SDKs" },
];

const ERRORS = [
  ["400", "Bad request — unknown provider/endpoint, missing ?provider, or capability not available."],
  ["401", "Unauthorized — missing/invalid/expired/revoked API key, or key not allowed from this IP."],
  ["402", "Payment required — monthly quota exceeded (upgrade your plan)."],
  ["403", "Forbidden — key is scoped to other providers/IPs."],
  ["404", "Not found — unknown match id."],
  ["429", "Too many requests — per-minute rate limit exceeded."],
];

export default function DocsPage() {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    getProviders().then(setProviders);
    portal.plans().then(setPlans).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0e14] text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
        <div className="max-w-[1100px] mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-7 w-7 rounded-lg bg-brand flex items-center justify-center">
              <Activity size={16} className="text-black" />
            </span>
            <span className="font-semibold">ZeroApi</span>
            <span className="text-muted text-sm">API Reference</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/status" className="text-muted hover:text-white">Status</Link>
            <Link href="/changelog" className="text-muted hover:text-white">Changelog</Link>
            <Link href="/signup" className="btn-primary">Get API key</Link>
          </div>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 flex gap-10">
        {/* Sidebar */}
        <aside className="hidden lg:block w-56 shrink-0 py-10">
          <nav className="sticky top-20 space-y-1">
            {NAV.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                className={`block text-sm transition-colors hover:text-white ${
                  "sub" in n && n.sub ? "pl-3 text-muted font-mono text-xs py-0.5" : "text-gray-300 py-1"
                }`}
              >
                {n.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 py-10 space-y-10">
          <section id="intro" className="scroll-mt-24">
            <h1 className="text-3xl font-semibold mb-3">ZeroApi reference</h1>
            <p className="text-muted">
              One REST API for real-time sports data across multiple providers. Every data
              endpoint is provider-scoped and returns normalized JSON. Base URL:
            </p>
            <div className="mt-3"><Code>{API_V1}</Code></div>
            <p className="text-sm text-muted mt-3">
              Provider can go in the path (<code className="text-brand">/v1/{`{provider}`}/live</code>)
              or as a query param (<code className="text-brand">/v1/live?provider=melbet</code>) — both work.
            </p>
          </section>

          <section id="auth" className="scroll-mt-24 border-t border-border pt-8">
            <h2 className="text-xl font-semibold mb-3">Authentication</h2>
            <p className="text-muted mb-3">
              Authenticate every request with your API key in the
              <code className="text-brand"> X-API-Key</code> header (or
              <code className="text-brand"> ?api_key=</code>). Create keys in the
              {" "}<Link href="/portal" className="text-brand underline">developer portal</Link>;
              keys can be scoped to specific providers, source IPs and an expiry.
            </p>
            <Code>{`curl -H "X-API-Key: $ZEROAPI_KEY" "${API_V1}/melbet/live"`}</Code>
            <p className="text-sm text-muted mt-3">
              Responses include <code className="text-brand">X-RateLimit-Limit</code> and
              <code className="text-brand"> X-RateLimit-Remaining</code> headers.
            </p>
          </section>

          <section id="limits" className="scroll-mt-24 border-t border-border pt-8">
            <h2 className="text-xl font-semibold mb-3">Rate limits &amp; plans</h2>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="th">Plan</th><th className="th">Requests / min</th>
                    <th className="th">Monthly quota</th><th className="th">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {plans.length === 0 ? (
                    <tr><td className="td text-muted" colSpan={4}>Loading plans…</td></tr>
                  ) : (
                    plans.map((p) => (
                      <tr key={p.slug}>
                        <td className="td text-white">{p.name}</td>
                        <td className="td tabular-nums">{p.rate_limit_per_min}</td>
                        <td className="td tabular-nums">{p.monthly_quota < 0 ? "Unlimited" : p.monthly_quota.toLocaleString()}</td>
                        <td className="td tabular-nums">${(p.price_cents / 100).toFixed(0)}/mo</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted mt-3">
              Over the per-minute limit returns <code className="text-brand">429</code>; over the
              monthly quota returns <code className="text-brand">402</code> (metered plans bill overage instead).
            </p>
          </section>

          <section id="provider-list" className="scroll-mt-24 border-t border-border pt-8">
            <h2 className="text-xl font-semibold mb-3">Providers</h2>
            <p className="text-muted mb-3">
              Active providers right now. Each exposes only the endpoints in its capability set.
            </p>
            <div className="flex flex-wrap gap-2">
              {providers.length === 0 ? (
                <span className="text-muted text-sm">Loading…</span>
              ) : (
                providers.map((p) => (
                  <span key={p.slug} className="badge bg-surface-2 text-gray-200">
                    {p.name} <code className="text-brand ml-1">{p.slug}</code>
                  </span>
                ))
              )}
            </div>
          </section>

          <section id="endpoints" className="scroll-mt-24 border-t border-border pt-8">
            <h2 className="text-xl font-semibold mb-1">Endpoints</h2>
            <p className="text-muted">All endpoints are <code className="text-brand">GET</code> and return JSON.</p>
          </section>

          {ENDPOINTS.map((ep) => (
            <EndpointDoc key={ep.id} ep={ep} />
          ))}

          <section id="errors" className="scroll-mt-24 border-t border-border pt-8">
            <h2 className="text-xl font-semibold mb-3">Errors</h2>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr><th className="th">Status</th><th className="th">Meaning</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ERRORS.map(([c, d]) => (
                    <tr key={c}>
                      <td className="td font-mono text-brand">{c}</td>
                      <td className="td text-muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted mt-3">Errors return <code className="text-brand">{`{ "error": "message" }`}</code>.</p>
          </section>

          <section id="sdks" className="scroll-mt-24 border-t border-border pt-8 pb-10">
            <h2 className="text-xl font-semibold mb-3">SDKs</h2>
            <p className="text-muted mb-3">Typed clients with retry + rate-limit-aware backoff:</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <Code>{`npm install @zeroapi/sdk

import { ZeroApi } from "@zeroapi/sdk";
const c = new ZeroApi({ apiKey: process.env.ZEROAPI_KEY });
await c.live("melbet");`}</Code>
              <Code>{`pip install zeroapi

from zeroapi import ZeroApi
c = ZeroApi(api_key=os.environ["ZEROAPI_KEY"])
c.live("melbet")`}</Code>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

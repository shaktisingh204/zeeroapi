"use client";

import { useEffect, useState } from "react";
import { Code2, KeyRound, Gauge } from "lucide-react";
import { api } from "@/lib/api";
import type { Plan } from "@/lib/types";
import { PageHeader, Spinner } from "@/components/ui";
import { API_V1 as V1_URL, DOCS_URL as SWAGGER_URL } from "@/lib/config";

const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: "GET", path: "/v1/providers", desc: "List available data providers." },
  { method: "GET", path: "/v1/{provider}/sports", desc: "List sports with their ids and match counts." },
  { method: "GET", path: "/v1/{provider}/matches", desc: "List matches/events (status, sport_id, league_id, search, limit)." },
  { method: "GET", path: "/v1/{provider}/matches/{id}", desc: "Full detail + all odds for one match (alias: /matchdetails/{id})." },
  { method: "GET", path: "/v1/{provider}/leagues", desc: "List leagues, filterable by sport_id." },
  { method: "GET", path: "/v1/{provider}/sidebar", desc: "Full sports tree with nested leagues." },
  { method: "GET", path: "/v1/{provider}/live", desc: "Currently live matches with scores." },
  { method: "GET", path: "/v1/{provider}/featured", desc: "Featured / highlighted events (promoted strip)." },
  { method: "GET", path: "/v1/{provider}/headermatches", desc: "Matches in the provider's header strip." },
  { method: "GET", path: "/v1/{provider}/results", desc: "Recently finished matches with derived winner." },
  { method: "GET", path: "/v1/{provider}/odds/{match_id}", desc: "Flat odds for a match (exchanges add lay + volume + suspended)." },
  { method: "GET", path: "/v1/{provider}/markets/{match_id}", desc: "Odds grouped by market, with each market's outcomes." },
  { method: "GET", path: "/v1/{provider}/prematch", desc: "Sportsbook only — scheduled (prematch) matches." },
  { method: "GET", path: "/v1/{provider}/marketgroups", desc: "Sportsbook only — the market-group tree offered." },
  { method: "GET", path: "/v1/{provider}/suspended", desc: "Exchange only — events locked (suspended) in-play now." },
];

// Every endpoint is static per provider — the provider is part of the path.
const CURL_EXAMPLE = `# replace YOUR_KEY with a key from the Customers tab
curl -H "X-API-Key: YOUR_KEY" "${V1_URL}/melbet/live"

# each provider has its own path, e.g. the d247 exchange:
curl -H "X-API-Key: YOUR_KEY" "${V1_URL}/diamondexch/headermatches"`;

export default function DevelopersPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  useEffect(() => {
    api
      .plans()
      .then((p) => setPlans([...p].sort((a, b) => a.sort_order - b.sort_order)))
      .finally(() => setLoadingPlans(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="API Docs"
        subtitle="Build on the Sports Data API"
        actions={
          <a className="btn-primary" href={SWAGGER_URL} target="_blank" rel="noreferrer">
            Open Swagger ↗
          </a>
        }
      />

      {/* Getting started */}
      <div className="card p-5 mb-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-brand/15 text-brand flex items-center justify-center shrink-0">
            <KeyRound size={20} />
          </div>
          <div className="text-sm text-gray-300">
            <p className="text-white font-medium">Getting started</p>
            <p className="text-muted mt-1">
              Authenticate every request with the{" "}
              <code className="text-brand">X-API-Key</code> header. Keys are issued
              per customer from the{" "}
              <span className="text-white">Customers</span> tab. The public API lives
              at <code className="text-brand">{V1_URL}</code>.
            </p>
          </div>
        </div>
        <pre className="bg-[#0b0e14] border border-border rounded-lg p-4 text-sm overflow-x-auto">
          <code className="text-brand">{CURL_EXAMPLE}</code>
        </pre>
      </div>

      {/* Endpoints */}
      <div className="flex items-center gap-2 mb-3">
        <Code2 size={18} className="text-muted" />
        <h2 className="font-semibold text-white">Endpoints</h2>
      </div>
      <div className="card overflow-hidden mb-6">
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className="th">Method</th>
              <th className="th">Path</th>
              <th className="th">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ENDPOINTS.map((e) => (
              <tr key={e.path} className="hover:bg-surface-2/50">
                <td className="td">
                  <span className="badge bg-brand/15 text-brand">{e.method}</span>
                </td>
                <td className="td font-mono text-brand">{e.path}</td>
                <td className="td text-muted">{e.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rate limits & plans */}
      <div className="flex items-center gap-2 mb-3">
        <Gauge size={18} className="text-muted" />
        <h2 className="font-semibold text-white">Rate limits &amp; plans</h2>
      </div>
      <div className="card overflow-hidden mb-4">
        {loadingPlans ? (
          <Spinner />
        ) : (
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className="th">Plan</th>
                <th className="th">Requests/min</th>
                <th className="th">Monthly quota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {plans.map((p) => (
                <tr key={p.slug} className="hover:bg-surface-2/50">
                  <td className="td text-white">{p.name}</td>
                  <td className="td tabular-nums">{p.rate_limit_per_min}</td>
                  <td className="td tabular-nums">
                    {p.monthly_quota < 0
                      ? "Unlimited"
                      : p.monthly_quota.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-sm text-muted">
        Every response includes{" "}
        <code className="text-brand">X-RateLimit-Limit</code> and{" "}
        <code className="text-brand">X-RateLimit-Remaining</code> headers. Exceeding
        your limit returns <code className="text-brand">HTTP 429</code> (Too Many
        Requests).
      </p>
    </div>
  );
}

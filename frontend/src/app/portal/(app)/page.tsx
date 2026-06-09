"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  KeyRound,
  Boxes,
  TerminalSquare,
  Code2,
  ArrowRight,
  Rocket,
  Check,
  Clock,
} from "lucide-react";
import { portal, API_BASE, DOCS_URL } from "@/lib/portal";
import type { MeResponse, UsageResponse, RequestLogEntry } from "@/lib/portal";
import type { ApiKey } from "@/lib/types";
import { PageHeader, StatCard, Spinner, SectionCard, EmptyState } from "@/components/ui";

const QUICK_LINKS = [
  { href: "/portal/keys", label: "API Keys", desc: "Create and manage keys", icon: KeyRound, c: "#34d27b" },
  { href: "/portal/providers", label: "Providers", desc: "Browse the catalog", icon: Boxes, c: "#3b82f6" },
  { href: "/portal/playground", label: "Playground", desc: "Test calls live", icon: TerminalSquare, c: "#8b5cf6" },
  { href: "/portal/sdks", label: "SDKs", desc: "Typed clients", icon: Code2, c: "#f59e0b" },
];

function statusColor(s?: number) {
  if (!s) return "#8a93a6";
  if (s >= 500) return "#ef4444";
  if (s >= 400) return "#f59e0b";
  return "#34d27b";
}

export default function PortalOverview() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [recent, setRecent] = useState<RequestLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([portal.me(), portal.usage(), portal.keys()])
      .then(([m, u, k]) => {
        setMe(m);
        setUsage(u);
        setKeys(k);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed"))
      .finally(() => setLoading(false));
    portal.requests({ limit: 5 }).then((r) => setRecent(r.requests)).catch(() => {});
  }, []);

  if (loading || !me) return <Spinner />;

  const plan = me.plan;
  const quota = usage?.monthly_quota ?? 0;
  const used = usage?.used_this_month ?? 0;
  const unlimited = quota <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / quota) * 100));
  const meterColor = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#34d27b";
  const activeKeys = keys.filter((k) => !k.revoked).length;
  const firstRun = activeKeys === 0;

  return (
    <div>
      <PageHeader
        title={`Welcome back${me.customer.name ? `, ${me.customer.name.split(" ")[0]}` : ""}`}
        subtitle="Your ZeroApi access at a glance."
        actions={
          <a className="btn-ghost" href={DOCS_URL} target="_blank" rel="noreferrer">
            API Docs ↗
          </a>
        }
      />

      {error && <div className="mb-4 rounded-lg bg-live/15 px-3 py-2 text-sm text-live">{error}</div>}

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Current plan" value={plan.name} icon={<Rocket size={18} />} accent="#34d27b" />
        <StatCard label="Rate limit" value={`${plan.rate_limit_per_min}/min`} icon={<Clock size={18} />} accent="#3b82f6" />
        <StatCard label="Active keys" value={activeKeys} icon={<KeyRound size={18} />} accent="#f59e0b" />
      </div>

      {/* Usage meter */}
      <div className="card mb-6 p-5">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-sm text-muted">Requests this month</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {used.toLocaleString()}
              <span className="text-base font-normal text-muted">
                {" "}/ {unlimited ? "unlimited" : quota.toLocaleString()}
              </span>
            </p>
          </div>
          <Link href="/portal/analytics" className="btn-quiet text-sm">
            View analytics <ArrowRight size={14} />
          </Link>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ width: `${unlimited ? 4 : Math.max(pct, 2)}%`, background: meterColor }}
          />
        </div>
        {!unlimited && <p className="mt-2 text-xs text-muted">{pct}% of your monthly quota used.</p>}
      </div>

      {/* First-run guide OR recent activity */}
      {firstRun ? (
        <div className="card mb-6 border-brand/30 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Rocket size={18} className="text-brand" />
            <h2 className="text-lg font-semibold text-white">Get started in 3 steps</h2>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              { n: 1, t: "Create an API key", d: "Generate a key and scope it to a provider.", href: "/portal/keys", cta: "Create key" },
              { n: 2, t: "Make your first call", d: "Open the Playground and hit an endpoint.", href: "/portal/playground", cta: "Open Playground" },
              { n: 3, t: "Build with an SDK", d: "Grab a typed client for your language.", href: "/portal/sdks", cta: "Browse SDKs" },
            ].map((s) => (
              <li key={s.n} className="flex flex-col rounded-lg bg-surface-2/50 p-4">
                <span className="badge mb-2 w-fit bg-brand/15 text-brand">{s.n}</span>
                <p className="text-sm font-medium text-white">{s.t}</p>
                <p className="mt-1 flex-1 text-xs text-muted">{s.d}</p>
                <Link href={s.href} className="btn-ghost mt-3 justify-center text-sm">
                  {s.cta}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <SectionCard
          title="Recent requests"
          className="mb-6"
          actions={
            <Link href="/portal/logs" className="btn-quiet text-sm">
              View all <ArrowRight size={14} />
            </Link>
          }
        >
          {recent.length === 0 ? (
            <EmptyState message="No requests yet. Make a call from the Playground." />
          ) : (
            <div className="divide-y divide-border-soft">
              {recent.map((r, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5 text-sm">
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
                    style={{ background: statusColor(r.status) + "22", color: statusColor(r.status) }}
                  >
                    {r.status ?? "-"}
                  </span>
                  <code className="min-w-0 flex-1 truncate text-gray-300">{r.m} {r.p}</code>
                  {r.latency_ms != null && (
                    <span className="shrink-0 text-xs tabular-nums text-muted">{r.latency_ms}ms</span>
                  )}
                  <span className="hidden shrink-0 text-xs text-muted-2 sm:block">
                    {new Date(r.t * 1000).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Quick links */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {QUICK_LINKS.map((l) => {
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              className="card group p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-pop"
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ background: l.c + "22", color: l.c }}
              >
                <Icon size={18} />
              </div>
              <p className="mt-3 flex items-center gap-1 font-medium text-white">
                {l.label}
                <ArrowRight size={14} className="text-muted-2 transition-transform duration-150 group-hover:translate-x-0.5" />
              </p>
              <p className="mt-0.5 text-xs text-muted">{l.desc}</p>
            </Link>
          );
        })}
      </div>

      {/* Quick start */}
      <SectionCard title="Quick start">
        <p className="mb-4 text-sm text-muted">
          Authenticate with the <code className="text-white">X-API-Key</code> header. Endpoints are
          provider-scoped (<code className="text-white">/{`{provider}`}/...</code>).
        </p>
        <div className="flex items-center gap-2">
          <pre className="flex-1 overflow-x-auto rounded-lg border border-border bg-[#0b0e14] p-4 text-sm text-gray-300">
{`curl -H "X-API-Key: YOUR_KEY" "${API_BASE}/melbet/live"`}
          </pre>
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm">
          <Link href="/portal/keys" className="text-brand hover:underline">Get a key</Link>
          <span className="text-muted-2">·</span>
          <Link href="/portal/playground" className="text-brand hover:underline">Run it in the Playground</Link>
        </div>
      </SectionCard>
    </div>
  );
}

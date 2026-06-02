"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://15.235.234.216:8081/api").replace(/\/$/, "");

interface Component {
  name: string;
  status: "operational" | "degraded" | "down";
  detail: string;
}
interface Incident {
  id: number;
  title: string;
  severity: string;
  status: string;
  body: string;
  started_at: string;
  resolved_at?: string | null;
}
interface StatusResponse {
  overall: "operational" | "degraded" | "down";
  components: Component[];
  incidents: Incident[];
}

const DOT: Record<string, string> = {
  operational: "bg-emerald-400",
  degraded: "bg-yellow-400",
  down: "bg-red-500",
};
const LABEL: Record<string, string> = {
  operational: "All systems operational",
  degraded: "Partial degradation",
  down: "Major outage",
};
const STATUS_TEXT: Record<string, string> = {
  operational: "text-emerald-400",
  degraded: "text-yellow-400",
  down: "text-red-400",
};
const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/5",
  major: "border-red-500/30 bg-red-500/5",
  minor: "border-yellow-500/30 bg-yellow-500/5",
};
const SEVERITY_TEXT: Record<string, string> = {
  critical: "text-red-400",
  major: "text-red-400",
  minor: "text-yellow-400",
};

function isResolved(i: Incident) {
  return i.status?.toLowerCase() === "resolved" || Boolean(i.resolved_at);
}

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch(`${BASE}/status`)
        .then((r) => r.json())
        .then((d) => {
          setData(d);
          setError(false);
        })
        .catch(() => setError(true));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const { active, resolved, opsCount } = useMemo(() => {
    const incidents = data?.incidents ?? [];
    const active = incidents.filter((i) => !isResolved(i));
    const resolved = incidents.filter(isResolved);
    const opsCount = (data?.components ?? []).filter((c) => c.status === "operational").length;
    return { active, resolved, opsCount };
  }, [data]);

  return (
    <div className="min-h-screen bg-[#0b0e14] text-white">
      <div className="max-w-[760px] mx-auto px-6 py-16">
        <div className="flex items-center justify-between mb-10">
          <Link href="/" className="font-semibold text-lg">
            ZeroApi <span className="text-muted font-normal">Status</span>
          </Link>
          <Link href="/changelog" className="text-sm text-muted hover:text-white transition-colors">
            Changelog →
          </Link>
        </div>

        {error || !data ? (
          <div className="rounded-xl border border-border bg-surface p-6 text-muted">
            {error ? "Unable to reach the status service." : "Loading…"}
          </div>
        ) : (
          <>
            {/* Overall summary */}
            <div className="rounded-xl border border-border bg-surface p-6 mb-6">
              <div className="flex items-center gap-3">
                <span className={`h-3.5 w-3.5 rounded-full ${DOT[data.overall]} animate-pulse`} />
                <span className="text-lg font-medium">{LABEL[data.overall]}</span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm text-muted">
                <span>
                  <span className="text-white font-medium tabular-nums">{opsCount}</span>
                  /{data.components.length} components operational
                </span>
                {active.length > 0 ? (
                  <span className="text-yellow-400">
                    {active.length} active incident{active.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="text-emerald-400">No active incidents</span>
                )}
                <span className="ml-auto text-xs">Live · refreshes every 15s</span>
              </div>
            </div>

            {/* Components */}
            <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Components</h2>
            <div className="rounded-xl border border-border bg-surface divide-y divide-border mb-10">
              {data.components.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-4 px-6 py-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[c.status]}`} />
                    <div className="min-w-0">
                      <p className="font-medium">{c.name}</p>
                      {c.detail && <p className="text-sm text-muted">{c.detail}</p>}
                    </div>
                  </div>
                  <span className={`text-sm font-medium capitalize shrink-0 ${STATUS_TEXT[c.status]}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Active incidents */}
            <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Active incidents</h2>
            {active.length === 0 ? (
              <p className="text-sm text-muted">No incidents reported.</p>
            ) : (
              <div className="space-y-3">
                {active.map((i) => (
                  <div
                    key={i.id}
                    className={`rounded-xl border p-4 ${SEVERITY_STYLE[i.severity?.toLowerCase()] ?? "border-yellow-500/30 bg-yellow-500/5"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{i.title}</p>
                      <span className={`text-xs uppercase tracking-wide shrink-0 ${SEVERITY_TEXT[i.severity?.toLowerCase()] ?? "text-yellow-400"}`}>
                        {i.severity}
                      </span>
                    </div>
                    {i.body && <p className="text-sm text-muted mt-1 whitespace-pre-line">{i.body}</p>}
                    <p className="text-xs text-muted mt-2 capitalize">
                      {i.status} · {new Date(i.started_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Incident history (resolved) */}
            {resolved.length > 0 && (
              <details className="mt-10 group">
                <summary className="text-sm uppercase tracking-wide text-muted mb-3 cursor-pointer select-none hover:text-white transition-colors list-none flex items-center gap-2">
                  <span className="transition-transform group-open:rotate-90">▸</span>
                  Incident history
                  <span className="text-xs normal-case tracking-normal">({resolved.length} resolved)</span>
                </summary>
                <div className="space-y-3 mt-3">
                  {resolved.map((i) => (
                    <div key={i.id} className="rounded-xl border border-border bg-surface p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-gray-300">{i.title}</p>
                        <span className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-emerald-400 shrink-0">
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                          Resolved
                        </span>
                      </div>
                      {i.body && <p className="text-sm text-muted mt-1 whitespace-pre-line">{i.body}</p>}
                      <p className="text-xs text-muted mt-2">
                        {new Date(i.started_at).toLocaleString()}
                        {i.resolved_at && <> · resolved {new Date(i.resolved_at).toLocaleString()}</>}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

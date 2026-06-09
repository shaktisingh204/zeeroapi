"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { portal } from "@/lib/portal";
import type { MeResponse, UsageResponse } from "@/lib/portal";
import type { EndpointStat, StatusStat, LatencyPoint } from "@/lib/types";
import { PageHeader, StatCard, Spinner, EmptyState } from "@/components/ui";

const TOOLTIP = {
  background: "#1c2230",
  border: "1px solid #262d3d",
  borderRadius: 8,
  color: "#fff",
} as const;

const STATUS_META: Record<number, { label: string; color: string }> = {
  2: { label: "2xx success", color: "#34d27b" },
  4: { label: "4xx client", color: "#f59e0b" },
  5: { label: "5xx server", color: "#ef4444" },
};

const WINDOWS = [7, 14, 30, 90];

export default function AnalyticsPage() {
  const [days, setDays] = useState(14);
  const [breakdown, setBreakdown] = useState<EndpointStat[]>([]);
  const [status, setStatus] = useState<StatusStat[]>([]);
  const [latency, setLatency] = useState<LatencyPoint[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback((d: number) => {
    setLoading(true);
    Promise.all([
      portal.usageBreakdown(d),
      portal.usageStatus(d),
      portal.usageLatency(d),
      portal.usage(),
      portal.me(),
    ])
      .then(([b, s, l, u, m]) => {
        setBreakdown(b.breakdown);
        setStatus(s.status);
        setLatency(l.latency);
        setUsage(u);
        setMe(m);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(days), [days, load]);

  // Quota / plan summary (merged from the old Usage tab).
  const quotaUnlimited = !usage || usage.monthly_quota < 0;
  const quotaPct =
    usage && usage.monthly_quota > 0 ? Math.min(100, (usage.used_this_month / usage.monthly_quota) * 100) : 0;
  const threshold = me?.customer.alert_threshold ?? 80;
  const overThreshold = !quotaUnlimited && quotaPct >= threshold;

  const totalReq = status.reduce((a, s) => a + s.count, 0);
  const errors = status.filter((s) => s.status_class >= 4).reduce((a, s) => a + s.count, 0);
  const errRate = totalReq > 0 ? ((errors / totalReq) * 100).toFixed(1) : "0";
  const avgLatency =
    latency.length > 0
      ? Math.round(latency.reduce((a, p) => a + p.avg_latency_ms * p.count, 0) / Math.max(1, latency.reduce((a, p) => a + p.count, 0)))
      : 0;
  const topEndpoint = breakdown[0];

  const barData = breakdown.slice(0, 12).map((b) => ({
    name: b.provider ? `${b.provider}/${b.endpoint || "·"}` : b.endpoint || "·",
    count: b.count,
  }));

  return (
    <div>
      <PageHeader
        title="Usage & Analytics"
        subtitle="Monthly quota plus per-endpoint volume, status mix and latency from your real traffic"
        actions={
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  days === w ? "bg-brand text-black font-medium" : "text-muted hover:text-white"
                }`}
              >
                {w}d
              </button>
            ))}
          </div>
        }
      />

      {error && <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2 mb-4">{error}</div>}

      {/* Quota / plan summary (merged from the old Usage tab) */}
      {usage && me && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm text-muted">This month on {me.plan.name}</p>
              <p className="text-2xl font-semibold text-white">
                {usage.used_this_month.toLocaleString()}
                <span className="text-base text-muted font-normal">
                  {" "}/ {quotaUnlimited ? "∞" : usage.monthly_quota.toLocaleString()} requests
                </span>
              </p>
            </div>
            {!quotaUnlimited && (
              <span className={`text-sm font-medium ${overThreshold ? "text-yellow-400" : "text-muted"}`}>
                {Math.round(quotaPct)}% used
              </span>
            )}
          </div>
          {!quotaUnlimited && (
            <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${overThreshold ? "bg-yellow-400" : "bg-brand"}`}
                style={{ width: `${quotaPct}%` }}
              />
            </div>
          )}
          {overThreshold && (
            <p className="text-sm text-yellow-300 mt-3">
              You&apos;ve used {Math.round(quotaPct)}% of your quota (alert at {threshold}%). Consider
              upgrading on the <a href="/portal/billing" className="underline">Billing</a> tab.
            </p>
          )}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : totalReq === 0 ? (
        <EmptyState message="No requests in this window yet. Make a call from the Playground to populate analytics." />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <StatCard label="Requests" value={totalReq.toLocaleString()} accent="#3b82f6" />
            <StatCard label="Error rate" value={`${errRate}%`} accent={Number(errRate) > 5 ? "#ef4444" : "#34d27b"} />
            <StatCard label="Avg latency" value={`${avgLatency} ms`} accent="#f59e0b" />
            <StatCard label="Top endpoint" value={topEndpoint ? `${topEndpoint.endpoint || "none"}` : "none"} accent="#a855f7" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card p-5 lg:col-span-2">
              <h2 className="font-semibold text-white mb-4">Requests by endpoint</h2>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={barData} layout="vertical" margin={{ left: 40 }}>
                  <XAxis type="number" tick={{ fill: "#8b93a7", fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#8b93a7", fontSize: 11 }} />
                  <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "#ffffff08" }} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card p-5">
              <h2 className="font-semibold text-white mb-4">Status codes</h2>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={status.map((s) => ({ ...s, label: STATUS_META[s.status_class]?.label ?? `${s.status_class}xx` }))}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {status.map((s) => (
                      <Cell key={s.status_class} fill={STATUS_META[s.status_class]?.color ?? "#64748b"} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {status.map((s) => (
                  <div key={s.status_class} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-muted">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_META[s.status_class]?.color ?? "#64748b" }} />
                      {STATUS_META[s.status_class]?.label ?? `${s.status_class}xx`}
                    </span>
                    <span className="text-white">{s.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card p-5 mt-4">
            <h2 className="font-semibold text-white mb-4">Latency (daily mean, ms)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={latency} margin={{ left: -10 }}>
                <XAxis dataKey="day" tick={{ fill: "#8b93a7", fontSize: 11 }} />
                <YAxis tick={{ fill: "#8b93a7", fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ stroke: "#ffffff20" }} />
                <Line type="monotone" dataKey="avg_latency_ms" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

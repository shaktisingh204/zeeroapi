"use client";

import { useEffect, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, DollarSign, Users, Gauge } from "lucide-react";
import { api } from "@/lib/api";
import type { AdminHealth, ProviderCoverage, Freshness, Business } from "@/lib/types";
import { TOOLTIP_STYLE, CHART_COLORS } from "@/lib/theme";
import { StatCard, Spinner, Badge } from "@/components/ui";

function age(secs: number | null): string {
  if (secs == null) return "—";
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${Math.round(secs / 3600)}h`;
}

/** Pipeline health, provider coverage, freshness + business metrics.
 *  Rendered as the "Insights" tab of the admin Overview. */
export default function AdminInsights() {
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [coverage, setCoverage] = useState<ProviderCoverage[]>([]);
  const [fresh, setFresh] = useState<Freshness | null>(null);
  const [biz, setBiz] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.health(), api.coverage(), api.freshness(), api.business()])
      .then(([h, c, f, b]) => {
        setHealth(h);
        setCoverage(c.coverage);
        setFresh(f);
        setBiz(b);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !health || !fresh || !biz) return <Spinner />;

  const coverageBars = coverage.map((c) => ({ name: c.name, matches: c.matches, odds: c.odds }));
  const planPie = biz.by_plan.map((p) => ({ name: p.plan, value: p.count }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Scraper success (24h)"
          value={`${health.success_rate.toFixed(1)}%`}
          icon={<Activity size={20} />}
          accent={health.success_rate > 90 ? "#22c55e" : "#f59e0b"}
        />
        <StatCard label="MRR" value={`$${(biz.mrr_cents / 100).toLocaleString()}`} icon={<DollarSign size={20} />} accent="#22c55e" />
        <StatCard label="Customers" value={biz.total_customers} icon={<Users size={20} />} accent="#3b82f6" />
        <StatCard label="Live data age" value={age(fresh.live_oldest_secs)} icon={<Gauge size={20} />} accent="#f59e0b" />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Scraper health (24h)</h2>
          <Badge variant={health.page_sync_enabled ? "brand" : "danger"}>
            page sync {health.page_sync_enabled ? "on" : "off"}
          </Badge>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={health.timeline} margin={{ left: -10 }}>
            <XAxis dataKey="hour" tick={{ fill: "#8b93a7", fontSize: 11 }} tickFormatter={(v) => new Date(v).getHours() + "h"} />
            <YAxis tick={{ fill: "#8b93a7", fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="success" stackId="1" stroke="#22c55e" fill="#22c55e33" />
            <Area type="monotone" dataKey="error" stackId="1" stroke="#ef4444" fill="#ef444433" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
          <div><span className="text-muted">Runs</span> <span className="text-white">{health.runs_24h}</span></div>
          <div><span className="text-muted">Success</span> <span className="text-brand">{health.success_24h}</span></div>
          <div><span className="text-muted">Errors</span> <span className="text-live">{health.error_24h}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-white mb-4">Provider coverage</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={coverageBars} margin={{ left: -10 }}>
              <XAxis dataKey="name" tick={{ fill: "#8b93a7", fontSize: 11 }} />
              <YAxis tick={{ fill: "#8b93a7", fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff08" }} />
              <Bar dataKey="matches" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="odds" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <table className="w-full mt-4 text-sm">
            <thead className="border-b border-border">
              <tr><th className="th">Provider</th><th className="th">Matches</th><th className="th">Live</th><th className="th">Odds</th><th className="th">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {coverage.map((c) => (
                <tr key={c.slug}>
                  <td className="td text-white">{c.name}</td>
                  <td className="td">{c.matches.toLocaleString()}</td>
                  <td className="td">{c.live}</td>
                  <td className="td">{c.odds.toLocaleString()}</td>
                  <td className="td">
                    <Badge variant={c.is_active ? "brand" : "neutral"}>{c.is_active ? "active" : "off"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-white mb-4">Data freshness</h2>
          <div className="space-y-3">
            {[
              ["Oldest live match", fresh.live_oldest_secs],
              ["Avg live age", fresh.live_avg_secs],
              ["Odds last update", fresh.odds_last_update_secs],
              ["Matches last update", fresh.matches_last_update_secs],
            ].map(([label, v]) => (
              <div key={label as string} className="flex items-center justify-between">
                <span className="text-sm text-muted">{label}</span>
                <span className="text-sm text-white font-mono">{age(v as number | null)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm text-muted">Last ingest</span>
              <span className="text-sm text-white">
                {fresh.last_ingest ? new Date(fresh.last_ingest).toLocaleTimeString() : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <h2 className="font-semibold text-white mb-4">Plan distribution</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={planPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {planPie.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-white mb-4">Signups (30d)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={biz.signups} margin={{ left: -10 }}>
              <XAxis dataKey="day" tick={{ fill: "#8b93a7", fontSize: 10 }} />
              <YAxis tick={{ fill: "#8b93a7", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-white mb-4">Top customers (30d)</h2>
          {biz.top_customers.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">No API traffic yet.</p>
          ) : (
            <ul className="space-y-2">
              {biz.top_customers.map((c) => (
                <li key={c.email} className="flex items-center justify-between text-sm">
                  <span className="text-gray-300 truncate max-w-[180px]">{c.email}</span>
                  <span className="text-white font-mono">{c.requests.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

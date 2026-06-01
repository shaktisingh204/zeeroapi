"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Radio, ListOrdered, Trophy, Coins, Clock } from "lucide-react";
import { api } from "@/lib/api";
import type { DashboardStats } from "@/lib/types";
import { TOOLTIP_STYLE } from "@/lib/theme";
import { PageHeader, StatCard, StatusBadge, Spinner } from "@/components/ui";
import AdminInsights from "@/components/AdminInsights";

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "insights", label: "Insights" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function OverviewPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("summary");

  useEffect(() => {
    const load = () => api.stats().then(setStats).finally(() => setLoading(false));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Live snapshot of scraped data, pipeline health and business metrics"
        actions={
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === t.id ? "bg-brand text-black font-medium" : "text-muted hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      {tab === "insights" ? (
        <AdminInsights />
      ) : loading && !stats ? (
        <Spinner />
      ) : !stats ? null : (
        <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Live matches" value={stats.live_matches} icon={<Radio size={20} />} accent="#ef4444" />
        <StatCard label="Total matches" value={stats.total_matches.toLocaleString()} icon={<ListOrdered size={20} />} accent="#3b82f6" />
        <StatCard label="Sports" value={stats.total_sports} icon={<Trophy size={20} />} accent="#f59e0b" />
        <StatCard label="Odds tracked" value={stats.total_odds.toLocaleString()} icon={<Coins size={20} />} accent="#22c55e" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-white mb-4">Matches by sport</h2>
          {stats.matches_by_sport.length === 0 ? (
            <p className="text-sm text-muted py-12 text-center">
              No data yet — run a scrape from the Scrape Jobs page.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.matches_by_sport} margin={{ left: -10 }}>
                <XAxis
                  dataKey="sport_name"
                  tick={{ fill: "#8b93a7", fontSize: 11 }}
                  angle={-25}
                  textAnchor="end"
                  height={70}
                  interval={0}
                />
                <YAxis tick={{ fill: "#8b93a7", fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff08" }} />
                <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-white mb-4">Pipeline</h2>
          <dl className="space-y-4 text-sm">
            <Row label="Prematch matches" value={stats.prematch_matches.toLocaleString()} />
            <Row label="Leagues" value={stats.total_leagues.toLocaleString()} />
            <Row label="Scrapes (24h)" value={stats.scrapes_last_24h.toLocaleString()} />
            <div className="pt-3 border-t border-border">
              <p className="text-muted mb-2 flex items-center gap-1.5">
                <Clock size={14} /> Last scrape
              </p>
              {stats.last_scrape ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white capitalize">{stats.last_scrape.job}</p>
                    <p className="text-xs text-muted">
                      {new Date(stats.last_scrape.started_at).toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge status={stats.last_scrape.status} />
                </div>
              ) : (
                <p className="text-muted">Never run</p>
              )}
            </div>
          </dl>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="text-white font-medium">{value}</dd>
    </div>
  );
}

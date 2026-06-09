"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import type { LeagueView, Sport } from "@/lib/types";
import { useAdminProvider } from "@/lib/adminProvider";
import {
  PageHeader,
  EmptyState,
  DataTable,
  type Column,
} from "@/components/ui";

export default function LeaguesPage() {
  const { provider, providers } = useAdminProvider();
  const providerName = providers.find((p) => p.slug === provider)?.name ?? provider;
  const [leagues, setLeagues] = useState<LeagueView[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);
  const [sportId, setSportId] = useState("");
  const [search, setSearch] = useState("");

  const columns: Column<LeagueView>[] = [
    {
      key: "name",
      header: "League",
      render: (l) => (
        <span className="flex items-center gap-2">
          {l.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={l.logo_url}
              width={20}
              height={20}
              alt=""
              className="rounded"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <span className="text-white">{l.name}</span>
        </span>
      ),
    },
    {
      key: "sport_name",
      header: "Sport",
      className: "text-muted",
      render: (l) => l.sport_name,
    },
    {
      key: "country",
      header: "Country",
      className: "text-muted",
      render: (l) => l.country ?? "—",
    },
    {
      key: "match_count",
      header: "Matches",
      className: "tabular-nums",
      render: (l) => l.match_count,
    },
    {
      key: "live",
      header: "Live",
      render: (l) =>
        l.live_count > 0 ? (
          <span className="badge bg-live/15 text-live">
            <span className="live-dot mr-1.5 inline-block" />
            {l.live_count}
          </span>
        ) : (
          <span className="tabular-nums">{l.live_count}</span>
        ),
    },
  ];

  const load = useCallback(() => {
    setLoading(true);
    api
      .leagues({
        sport_id: sportId || undefined,
        search: search || undefined,
      })
      .then(setLeagues)
      .finally(() => setLoading(false));
  }, [sportId, search]);

  useEffect(() => {
    api.sports().then(setSports);
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Leagues"
        subtitle={`All scraped leagues / tournaments · Viewing ${providerName}`}
      />

      <div className="card p-4 mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <input
            className="input pl-9"
            placeholder="Search leagues…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={sportId} onChange={(e) => setSportId(e.target.value)}>
          <option value="">All sports</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          rows={leagues}
          rowKey={(l) => l.id}
          loading={loading}
          empty={
            <EmptyState
              icon={<Trophy size={20} />}
              title="No leagues found"
              message="No leagues match your search or selected sport."
            />
          }
        />
      </div>
    </div>
  );
}

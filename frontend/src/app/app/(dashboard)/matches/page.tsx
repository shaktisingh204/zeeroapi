"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, Swords } from "lucide-react";
import { api } from "@/lib/api";
import type { MatchView, Sport } from "@/lib/types";
import { useAdminProvider } from "@/lib/adminProvider";
import {
  PageHeader,
  EmptyState,
  StatusBadge,
  Badge,
  DataTable,
  type Column,
} from "@/components/ui";

export default function MatchesPage() {
  const { provider, providers } = useAdminProvider();
  const providerName = providers.find((p) => p.slug === provider)?.name ?? provider;
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [sportId, setSportId] = useState("");
  const [search, setSearch] = useState("");

  const columns: Column<MatchView>[] = [
    {
      key: "match",
      header: "Match",
      render: (m) => (
        <Link href={`/app/matches/${m.id}`} className="hover:text-brand">
          <span className="text-white">{m.home_team}</span>
          <span className="text-muted mx-1.5">vs</span>
          <span className="text-white">{m.away_team}</span>
        </Link>
      ),
    },
    {
      key: "sport",
      header: "Sport / League",
      className: "text-muted",
      render: (m) =>
        `${m.sport_name}${m.league_name ? ` · ${m.league_name}` : ""}`,
    },
    {
      key: "score",
      header: "Score",
      className: "tabular-nums",
      render: (m) =>
        m.home_score != null ? `${m.home_score} : ${m.away_score ?? 0}` : "—",
    },
    {
      key: "status",
      header: "Status",
      render: (m) => <StatusBadge status={m.status} />,
    },
    {
      key: "winner",
      header: "Winner",
      render: (m) =>
        m.result === "W1" ? (
          <Badge variant="brand">{m.home_team}</Badge>
        ) : m.result === "W2" ? (
          <Badge variant="info">{m.away_team}</Badge>
        ) : m.result === "Draw" ? (
          <Badge variant="warning">Draw</Badge>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  const load = useCallback(() => {
    setLoading(true);
    api
      .matches({
        status: status || undefined,
        sport_id: sportId || undefined,
        search: search || undefined,
        limit: 200,
      })
      .then(setMatches)
      .finally(() => setLoading(false));
  }, [status, sportId, search]);

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
        title="Matches"
        subtitle={`All scraped events, prematch and live · Viewing ${providerName}`}
      />

      <div className="card p-4 mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <input
            className="input pl-9"
            placeholder="Search teams…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="live">Live</option>
          <option value="prematch">Prematch</option>
          <option value="finished">Finished</option>
        </select>
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
          rows={matches}
          rowKey={(m) => m.id}
          loading={loading}
          empty={
            <EmptyState
              icon={<Swords size={20} />}
              title="No matches found"
              message="No matches match these filters. Try clearing the search or status/sport filters."
            />
          }
        />
      </div>
    </div>
  );
}

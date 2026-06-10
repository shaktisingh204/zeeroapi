"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, Swords, Lock, Star, Pin } from "lucide-react";
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
  // Client-side flag filters (AND semantics; all off by default).
  const [onlySuspended, setOnlySuspended] = useState(false);
  const [onlyFeatured, setOnlyFeatured] = useState(false);
  const [onlyHeader, setOnlyHeader] = useState(false);

  const columns: Column<MatchView>[] = [
    {
      key: "match",
      header: "Match",
      render: (m) => (
        <span className="inline-flex items-center gap-1.5">
          <Link href={`/app/matches/${m.id}`} className="hover:text-brand">
            <span className="text-white">{m.home_team}</span>
            <span className="text-muted mx-1.5">vs</span>
            <span className="text-white">{m.away_team}</span>
          </Link>
          {m.suspended && (
            <span
              title="Suspended"
              className="inline-flex items-center gap-0.5 text-xs text-live"
            >
              <Lock size={12} /> suspended
            </span>
          )}
          {m.featured && <Star size={13} className="text-yellow-400" aria-label="Featured" />}
          {m.header && <Pin size={13} className="text-blue-400" aria-label="Header" />}
        </span>
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

  const visibleMatches = matches.filter(
    (m) =>
      (!onlySuspended || m.suspended) &&
      (!onlyFeatured || m.featured) &&
      (!onlyHeader || m.header),
  );

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
        <div className="flex items-center gap-2">
          <FilterPill active={onlySuspended} onClick={() => setOnlySuspended((v) => !v)}>
            <Lock size={12} /> Suspended
          </FilterPill>
          <FilterPill active={onlyFeatured} onClick={() => setOnlyFeatured((v) => !v)}>
            <Star size={12} /> Featured
          </FilterPill>
          <FilterPill active={onlyHeader} onClick={() => setOnlyHeader((v) => !v)}>
            <Pin size={12} /> Header
          </FilterPill>
        </div>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          rows={visibleMatches}
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

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`badge inline-flex items-center gap-1 transition-colors ${
        active ? "bg-brand/15 text-brand" : "bg-surface-2 text-muted hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

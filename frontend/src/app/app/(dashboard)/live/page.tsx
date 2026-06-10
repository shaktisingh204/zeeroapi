"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, Star, Pin } from "lucide-react";
import { api } from "@/lib/api";
import type { MatchView } from "@/lib/types";
import { useAdminProvider } from "@/lib/adminProvider";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";

export default function LivePage() {
  const { provider, providers } = useAdminProvider();
  const providerName = providers.find((p) => p.slug === provider)?.name ?? provider;
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState<Date | null>(null);
  // Client-side flag filters (AND semantics; all off by default).
  const [onlySuspended, setOnlySuspended] = useState(false);
  const [onlyFeatured, setOnlyFeatured] = useState(false);
  const [onlyHeader, setOnlyHeader] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .live()
        .then((m) => {
          setMatches(m);
          setUpdated(new Date());
        })
        .finally(() => setLoading(false));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  if (loading && matches.length === 0) return <Spinner />;

  const visibleMatches = matches.filter(
    (m) =>
      (!onlySuspended || m.suspended) &&
      (!onlyFeatured || m.featured) &&
      (!onlyHeader || m.header),
  );

  return (
    <div>
      <PageHeader
        title="Live Scores"
        subtitle={
          updated
            ? `Auto-refreshing every 10s · last update ${updated.toLocaleTimeString()} · Viewing ${providerName}`
            : `Live matches across all sports · Viewing ${providerName}`
        }
      />

      <div className="flex items-center gap-2 mb-4">
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

      {visibleMatches.length === 0 ? (
        <div className="card">
          <EmptyState message="No live matches right now." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleMatches.map((m) => (
            <Link
              key={m.id}
              href={`/app/matches/${m.id}`}
              className="card p-4 hover:border-brand/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted truncate max-w-[60%]">
                  {m.sport_name}
                  {m.league_name ? ` · ${m.league_name}` : ""}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-live font-medium">
                  {m.suspended && <Lock size={12} aria-label="Suspended" />}
                  {m.featured && <Star size={12} className="text-yellow-400" aria-label="Featured" />}
                  {m.header && <Pin size={12} className="text-blue-400" aria-label="Header" />}
                  <span className="live-dot inline-block" />
                  {m.match_time || m.period || "LIVE"}
                </span>
              </div>
              <ScoreRow team={m.home_team} score={m.home_score} />
              <ScoreRow team={m.away_team} score={m.away_score} />
            </Link>
          ))}
        </div>
      )}
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

function ScoreRow({ team, score }: { team: string; score: number | null }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-100 truncate pr-2">{team}</span>
      <span className="text-lg font-semibold text-white tabular-nums">
        {score ?? "-"}
      </span>
    </div>
  );
}

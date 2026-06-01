"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { MatchView } from "@/lib/types";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";

export default function LivePage() {
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState<Date | null>(null);

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

  return (
    <div>
      <PageHeader
        title="Live Scores"
        subtitle={
          updated
            ? `Auto-refreshing every 10s · last update ${updated.toLocaleTimeString()}`
            : "Live matches across all sports"
        }
      />

      {matches.length === 0 ? (
        <div className="card">
          <EmptyState message="No live matches right now." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {matches.map((m) => (
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

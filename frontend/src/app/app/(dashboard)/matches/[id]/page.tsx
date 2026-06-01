"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, TrendingUp } from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "@/lib/api";
import type { MatchDetail, Odd, OddPoint } from "@/lib/types";
import { TOOLTIP_STYLE } from "@/lib/theme";
import { PageHeader, Spinner, EmptyState, StatusBadge } from "@/components/ui";

export default function MatchDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [notFound, setNotFound] = useState(false);

  // Line-movement panel (folded in from the old Movements page).
  const [pick, setPick] = useState<{ market: string; outcome: string } | null>(null);
  const [history, setHistory] = useState<OddPoint[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  async function showMovement(market: string, outcome: string) {
    setPick({ market, outcome });
    setHistLoading(true);
    try {
      setHistory(await api.oddsHistory(id, market, outcome));
    } finally {
      setHistLoading(false);
    }
  }

  useEffect(() => {
    const load = () =>
      api
        .match(id)
        .then((m) => {
          setMatch(m);
          setNotFound(false);
        })
        .catch(() => setNotFound(true))
        .finally(() => setLoading(false));
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [id]);

  if (loading && !match) return <Spinner />;
  if (notFound || !match)
    return (
      <div>
        <Link href="/app/matches" className="text-sm text-muted hover:text-white inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={15} /> Back to matches
        </Link>
        <div className="card">
          <EmptyState message="Match not found — it may have ended or been removed." />
        </div>
      </div>
    );

  // group odds by market
  const byMarket = match.odds.reduce<Record<string, Odd[]>>((acc, o) => {
    (acc[o.market] ??= []).push(o);
    return acc;
  }, {});

  return (
    <div>
      <Link href="/app/matches" className="text-sm text-muted hover:text-white inline-flex items-center gap-1 mb-4">
        <ArrowLeft size={15} /> Back to matches
      </Link>

      <PageHeader
        title={`${match.home_team} vs ${match.away_team}`}
        subtitle={`${match.sport_name}${match.league_name ? ` · ${match.league_name}` : ""}`}
        actions={<StatusBadge status={match.status} />}
      />

      <div className="card p-6 mb-4">
        <div className="flex items-center justify-center gap-8">
          <div className="text-center flex-1">
            <p className="text-lg text-white font-medium">{match.home_team}</p>
          </div>
          <div className="text-center">
            <p className="text-4xl font-bold text-white tabular-nums">
              {match.home_score ?? "-"} : {match.away_score ?? "-"}
            </p>
            {(match.match_time || match.period) && (
              <p className="text-sm text-live mt-1">
                {match.match_time} {match.period}
              </p>
            )}
          </div>
          <div className="text-center flex-1">
            <p className="text-lg text-white font-medium">{match.away_team}</p>
          </div>
        </div>
        {match.status === "finished" && (
          <div className="mt-4 pt-4 border-t border-border text-center">
            <span className="badge bg-brand/15 text-brand">
              Result:{" "}
              {match.result === "W1"
                ? `${match.home_team} won`
                : match.result === "W2"
                ? `${match.away_team} won`
                : match.result === "Draw"
                ? "Draw"
                : "settled (no winner derived)"}
            </span>
            {match.finished_at && (
              <span className="text-xs text-muted ml-2">
                {new Date(match.finished_at).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Line movement (click any odd to plot its history) */}
      {pick && (
        <div className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-brand" />
            <h2 className="font-semibold text-white">
              Line movement — {pick.market} · {pick.outcome}
            </h2>
            <button onClick={() => setPick(null)} className="ml-auto text-sm text-muted hover:text-white">
              Close
            </button>
          </div>
          {histLoading ? (
            <Spinner />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">
              No recorded history yet — movement appears once this price changes over time.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={history.map((p) => ({ t: new Date(p.recorded_at).toLocaleString(), value: Number(p.value) }))} margin={{ left: -10 }}>
                <CartesianGrid stroke="#ffffff08" />
                <XAxis dataKey="t" tick={{ fill: "#8b93a7", fontSize: 10 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fill: "#8b93a7", fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Line type="stepAfter" dataKey="value" stroke="#22c55e" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      <h2 className="font-semibold text-white mb-3">Odds ({match.odds.length})</h2>
      {match.odds.length === 0 ? (
        <div className="card">
          <EmptyState message="No odds captured for this match." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Object.entries(byMarket).map(([market, odds]) => (
            <div key={market} className="card p-4">
              <h3 className="text-sm font-semibold text-white mb-3">{market}</h3>
              <div className="space-y-2">
                {odds.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => showMovement(o.market, o.outcome)}
                    title="Show line movement"
                    className={`w-full flex items-center justify-between rounded-md px-2 py-1 -mx-2 hover:bg-surface-2/60 transition-colors ${
                      pick?.market === o.market && pick?.outcome === o.outcome ? "bg-brand/10" : ""
                    }`}
                  >
                    <span className="text-sm text-muted">
                      {o.outcome}
                      {o.param ? ` (${o.param})` : ""}
                    </span>
                    <span className="badge bg-surface-2 text-brand font-semibold tabular-nums">
                      {Number(o.value).toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

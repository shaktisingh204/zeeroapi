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
import { PageHeader, Spinner, EmptyState, StatusBadge, Badge } from "@/components/ui";
import {
  getProviderProfiles,
  oddColumnsFor,
  type ProviderProfile,
} from "@/lib/providerProfiles";

export default function MatchDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
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

  // Resolve the provider profile so the odds table renders the provider's
  // native column shape (exchange back/lay/volume vs sportsbook price/line).
  useEffect(() => {
    if (!match?.provider) return;
    let live = true;
    getProviderProfiles().then((list) => {
      if (live) setProfile(list.find((p) => p.slug === match.provider) ?? null);
    });
    return () => {
      live = false;
    };
  }, [match?.provider]);

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

  // Provider-native odds columns. Fall back to a sportsbook shape until the
  // profile resolves (or if the provider is unknown).
  const fallbackProfile: ProviderProfile = {
    slug: match.provider,
    name: match.provider,
    kind: "sportsbook",
    capabilities: [],
    dataSource: "",
    markets: [],
    oddFields: [],
    matchFields: [],
    accent: "#34d27b",
    blurb: "",
  };
  const oddColumns = oddColumnsFor(profile ?? fallbackProfile);
  const dash = <span className="text-muted">—</span>;
  const renderCell = (o: Odd, key: string) => {
    switch (key) {
      case "market":
        return o.market;
      case "outcome":
        return <span className="text-white">{o.outcome}</span>;
      case "value":
        return (
          <span className="text-brand font-semibold tabular-nums">
            {o.value != null && o.value !== "" ? Number(o.value).toFixed(2) : dash}
          </span>
        );
      case "lay":
        return o.lay != null && o.lay !== "" ? (
          <span className="text-blue-400 font-semibold tabular-nums">
            {Number(o.lay).toFixed(2)}
          </span>
        ) : (
          dash
        );
      case "volume":
        return o.volume != null && o.volume !== "" ? (
          <span className="text-muted tabular-nums">{o.volume}</span>
        ) : (
          dash
        );
      case "param":
        return o.param != null && o.param !== "" ? (
          <span className="text-muted tabular-nums">{o.param}</span>
        ) : (
          dash
        );
      case "suspended":
        return o.suspended ? (
          <Badge variant="danger">Suspended</Badge>
        ) : (
          <Badge variant="success">Open</Badge>
        );
      default:
        return dash;
    }
  };

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
          {Object.entries(byMarket).map(([market, odds]) => {
            // Drop the redundant "Market" column inside a per-market card.
            const cols = oddColumns.filter((c) => c.key !== "market");
            return (
              <div key={market} className="card p-4">
                <h3 className="text-sm font-semibold text-white mb-3">{market}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {cols.map((c) => (
                        <th
                          key={c.key}
                          className={`th !px-2 !py-1 text-left ${
                            c.key !== "outcome" ? "text-right" : ""
                          }`}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {odds.map((o) => (
                      <tr
                        key={o.id}
                        onClick={() => showMovement(o.market, o.outcome)}
                        title="Show line movement"
                        className={`cursor-pointer hover:bg-surface-2/60 transition-colors ${
                          pick?.market === o.market && pick?.outcome === o.outcome
                            ? "bg-brand/10"
                            : ""
                        }`}
                      >
                        {cols.map((c) => (
                          <td
                            key={c.key}
                            className={`td !px-2 !py-1.5 ${
                              c.key !== "outcome" ? "text-right" : ""
                            }`}
                          >
                            {renderCell(o, c.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

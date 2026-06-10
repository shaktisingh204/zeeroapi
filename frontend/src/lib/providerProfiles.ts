// Per-provider PROFILE — the single source of truth for how each provider
// differs. Providers are NOT interchangeable: an exchange (d247) returns
// back/lay/volume and suspends in-play; sportsbooks return a single price with
// market groups; feeds differ again. Every page reads this so it renders the
// right endpoints, columns and language per provider.
//
// Fetched from the backend (/api/providers now returns kind + profile); falls
// back to the static map below so the UI is correct even offline.
import { API_BASE } from "./config";

export type ProviderKind = "exchange" | "sportsbook";

export interface ProviderProfile {
  slug: string;
  name: string;
  kind: ProviderKind;
  capabilities: string[];
  dataSource: string;
  markets: string[];
  oddFields: string[];
  matchFields: string[];
  accent: string;
  blurb: string;
}

interface RawProvider {
  slug: string;
  name: string;
  kind?: string;
  capabilities?: string[];
  profile?: {
    data_source?: string;
    markets?: string[];
    odd_fields?: string[];
    match_fields?: string[];
    accent?: string;
    blurb?: string;
  };
}

const STATIC: Record<string, Omit<ProviderProfile, "slug" | "name" | "capabilities">> = {
  diamondexch: {
    kind: "exchange",
    dataSource: "Diamond Exch (d247) SPA, rendered DOM via Playwright",
    markets: ["Match Odds", "Bookmaker", "Fancy", "Winner"],
    oddFields: ["value (back)", "lay", "volume", "suspended"],
    matchFields: ["suspended", "featured", "header", "live score"],
    accent: "#6366f1",
    blurb: "Betting exchange. Back and lay prices with matched volume; markets lock (suspend) in-play.",
  },
  melbet: {
    kind: "sportsbook",
    dataSource: "1xbet-family LineFeed / LiveFeed JSON (native)",
    markets: ["1x2", "Double Chance", "Total", "Handicap", "Individual Total", "1x2 (incl. OT)"],
    oddFields: ["value", "param", "group_id", "type_code"],
    matchFields: ["live score", "period", "featured", "suspended"],
    accent: "#059669",
    blurb: "Sportsbook. Single decimal price per outcome, with the full market-group tree.",
  },
  "1xbet": {
    kind: "sportsbook",
    dataSource: "1xBet SPA, rendered DOM",
    markets: ["Match Result", "Double Chance", "Total"],
    oddFields: ["value", "param", "suspended"],
    matchFields: ["live score", "featured", "suspended"],
    accent: "#3b82f6",
    blurb: "Sportsbook. Single price per outcome; locked outcomes are flagged suspended.",
  },
  betwinner: {
    kind: "sportsbook",
    dataSource: "BetWinner SPA, rendered DOM",
    markets: ["Match Result", "Double Chance", "Total"],
    oddFields: ["value", "param", "suspended"],
    matchFields: ["live score", "featured", "suspended"],
    accent: "#d97706",
    blurb: "Sportsbook. Single price per outcome; locked outcomes are flagged suspended.",
  },
  megapari: {
    kind: "sportsbook",
    dataSource: "MegaPari SPA, rendered DOM",
    markets: ["Match Result", "Double Chance", "Total"],
    oddFields: ["value", "param", "suspended"],
    matchFields: ["live score", "featured", "suspended"],
    accent: "#8b5cf6",
    blurb: "Sportsbook. Single price per outcome; locked outcomes are flagged suspended.",
  },
  "1win": {
    kind: "sportsbook",
    dataSource: "1Win top-parser lp-feed JSON",
    markets: ["Match Result", "Total", "Handicap", "Both Teams To Score"],
    oddFields: ["value", "param", "suspended"],
    matchFields: ["live score", "period", "suspended"],
    accent: "#ec4899",
    blurb: "Sportsbook on the top-parser feed. Prematch + live; blocked outcomes flagged suspended.",
  },
  bcgame: {
    kind: "sportsbook",
    dataSource: "BC.Game BetBy / sptpub JSON API",
    markets: ["1x2", "Total", "Handicap", "Double Chance", "Outright"],
    oddFields: ["value", "param"],
    matchFields: ["live score", "scheduled"],
    accent: "#14b8a6",
    blurb: "Sportsbook on BetBy. Prematch + live, outrights, alternative market lines.",
  },
};

const DEFAULT_CAPS = ["sports", "leagues", "matches", "live", "odds"];

function fromRaw(r: RawProvider): ProviderProfile {
  const s = STATIC[r.slug];
  const kind: ProviderKind =
    (r.kind as ProviderKind) || s?.kind || (r.capabilities?.includes("exchange") ? "exchange" : "sportsbook");
  return {
    slug: r.slug,
    name: r.name,
    kind,
    capabilities: r.capabilities?.length ? r.capabilities : DEFAULT_CAPS,
    dataSource: r.profile?.data_source || s?.dataSource || "Scraped feed",
    markets: r.profile?.markets?.length ? r.profile.markets : s?.markets || [],
    oddFields: r.profile?.odd_fields?.length ? r.profile.odd_fields : s?.oddFields || ["value", "param"],
    matchFields: r.profile?.match_fields?.length ? r.profile.match_fields : s?.matchFields || ["live score"],
    accent: r.profile?.accent || s?.accent || "#059669",
    blurb: r.profile?.blurb || s?.blurb || "Sports data provider.",
  };
}

let cache: ProviderProfile[] | null = null;

export async function getProviderProfiles(): Promise<ProviderProfile[]> {
  if (cache) return cache;
  try {
    const res = await fetch(`${API_BASE}/providers`, { cache: "no-store" });
    if (res.ok) {
      const list = (await res.json()) as RawProvider[];
      if (Array.isArray(list) && list.length) {
        cache = list.map(fromRaw);
        return cache;
      }
    }
  } catch {
    /* fall through to static */
  }
  // Offline fallback: synthesize from the static map.
  cache = Object.entries(STATIC).map(([slug, s]) => ({
    slug,
    name: slug,
    capabilities: slug === "diamondexch" ? [...DEFAULT_CAPS, "exchange"] : DEFAULT_CAPS,
    ...s,
  }));
  return cache;
}

export const isExchange = (p: ProviderProfile) => p.kind === "exchange";

export interface ApiEndpoint {
  id: string;
  method: "GET";
  path: string; // with {provider} substituted
  template: string; // with {provider} placeholder
  desc: string;
}

/** The endpoints a provider actually exposes. */
export function endpointsFor(p: ProviderProfile): ApiEndpoint[] {
  const eps: ApiEndpoint[] = [];
  const push = (id: string, suffix: string, desc: string) =>
    eps.push({ id, method: "GET", template: `/{provider}${suffix}`, path: `/${p.slug}${suffix}`, desc });

  // Exchange (d247): EXACTLY 6 endpoints. Odds come back inside matchdetails,
  // so there is no separate odds/markets/live endpoint.
  if (isExchange(p)) {
    push("sports", "/sports", "Sports with ids and match counts.");
    push("matches", "/matches", "Matches for a sport (filter by sport_id, status, search).");
    push("matchdetails", "/matchdetails/{id}", "Match detail + all odds (back, lay, volume, suspended).");
    push("leagues", "/leagues", "Leagues, filterable by sport_id.");
    push("sidebar", "/sidebar", "Full sports tree with nested leagues.");
    push("headermatches", "/headermatches", "Matches in the header strip.");
    return eps;
  }

  const has = (c: string) => p.capabilities.includes(c);
  if (has("sports")) push("sports", "/sports", "Sports with ids and match counts.");
  if (has("matches")) push("matches", "/matches", "Matches/events. Filter by sport_id, status, search.");
  if (has("matches")) push("matchdetails", "/matchdetails/{id}", "Full detail + all odds (alias of /matches/{id}).");
  if (has("leagues")) push("leagues", "/leagues", "Leagues, filterable by sport_id.");
  if (has("sports")) push("sidebar", "/sidebar", "Full sports tree with nested leagues.");
  if (has("live")) push("live", "/live", "Currently live matches with scores.");
  if (has("matches")) push("featured", "/featured", "Featured / promoted events.");
  if (has("matches")) push("headermatches", "/headermatches", "Matches in the header strip.");
  if (has("matches")) push("results", "/results", "Finished matches with derived winner.");
  if (has("odds")) {
    push(
      "odds",
      "/odds/{match_id}",
      isExchange(p) ? "Flat odds with back, lay, volume and suspended." : "Flat odds with price, line and group codes.",
    );
    push("markets", "/markets/{match_id}", "Odds grouped by market, with each market's outcomes/runners.");
  }
  // Kind-specific endpoints: exchanges and sportsbooks expose different ones.
  if (isExchange(p)) {
    push("suspended", "/suspended", "Exchange feed of events locked (suspended) in-play right now.");
  } else if (has("matches")) {
    push("prematch", "/prematch", "Scheduled (prematch) matches only.");
    if (has("odds")) push("marketgroups", "/marketgroups", "The market-group tree this sportsbook offers.");
  }
  return eps;
}

/** Column set for an odds table, tailored to the provider's native shape. */
export function oddColumnsFor(p: ProviderProfile): { key: string; label: string }[] {
  if (isExchange(p)) {
    return [
      { key: "market", label: "Market" },
      { key: "outcome", label: "Runner" },
      { key: "value", label: "Back" },
      { key: "lay", label: "Lay" },
      { key: "volume", label: "Volume" },
      { key: "suspended", label: "Status" },
    ];
  }
  return [
    { key: "market", label: "Market" },
    { key: "outcome", label: "Outcome" },
    { key: "value", label: "Price" },
    { key: "param", label: "Line" },
    { key: "suspended", label: "Status" },
  ];
}

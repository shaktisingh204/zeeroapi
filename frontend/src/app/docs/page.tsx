"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  KeyRound,
  Gauge,
  Boxes,
  Terminal,
  AlertTriangle,
  ChevronRight,
  Layers,
} from "lucide-react";
import { API_V1 } from "@/lib/config";
import {
  getProviders,
  getPublicPlans,
  formatPrice,
  formatQuota,
  type PublicProvider,
  type PublicPlan,
} from "@/lib/landing";
import { PROVIDER_DOCS } from "@/lib/docsContent";
import { CodeBlock, DocsHeader, MethodBadge, RequestTabs } from "./ui";

/* ============================================================ provider model */
// Static capability + type fallback (merged with whatever the live API reports).
// Capabilities decide which endpoints a provider exposes; "exchange" marks the
// back/lay/volume/suspended data shape (d247 / diamondexch).
const PROVIDER_META: Record<string, { name: string; type: "sportsbook" | "exchange"; caps: string[] }> = {
  melbet:      { name: "MelBet",      type: "sportsbook", caps: ["sports", "leagues", "matches", "live", "odds", "full_markets"] },
  "1xbet":     { name: "1xBet",       type: "sportsbook", caps: ["sports", "leagues", "matches", "live", "odds"] },
  betwinner:   { name: "BetWinner",   type: "sportsbook", caps: ["sports", "leagues", "matches", "odds"] },
  megapari:    { name: "MegaPari",    type: "sportsbook", caps: ["sports", "matches", "odds"] },
  "1win":      { name: "1Win",        type: "sportsbook", caps: ["sports", "matches", "live", "odds"] },
  bcgame:      { name: "BC.Game",     type: "sportsbook", caps: ["sports", "leagues", "matches", "live", "odds"] },
  diamondexch: { name: "Diamond Exch (d247)", type: "exchange", caps: ["sports", "leagues", "matches", "live", "odds", "exchange"] },
};
const FALLBACK_SLUGS = ["melbet", "1xbet", "betwinner", "megapari", "1win", "bcgame", "diamondexch"];

interface Prov {
  slug: string;
  name: string;
  type: "sportsbook" | "exchange";
  caps: string[];
}

function mergeProviders(api: PublicProvider[]): Prov[] {
  const slugs = api.length ? api.map((p) => p.slug) : FALLBACK_SLUGS;
  return slugs.map((slug) => {
    const meta = PROVIDER_META[slug] ?? { name: slug, type: "sportsbook" as const, caps: ["sports", "matches", "odds"] };
    const live = api.find((p) => p.slug === slug);
    const caps = live?.capabilities?.length ? live.capabilities : meta.caps;
    const type: "sportsbook" | "exchange" = caps.includes("exchange") || slug === "diamondexch" ? "exchange" : meta.type;
    return { slug, name: live?.name ?? meta.name, type, caps };
  });
}

/* ============================================================ endpoint model */

interface Param {
  name: string;
  loc: "path" | "query";
  required?: boolean;
  desc: string;
}
interface Endpoint {
  id: string;
  display: string; // shown path with {provider}
  template: string; // snippet path with {provider}/{id} placeholders
  summary: string;
  capability?: string; // capability that gates it (undefined = always available)
  params?: Param[];
  /** response builder: depends on whether the provider is an exchange */
  response: (slug: string, exch: boolean) => string;
}

const matchListEx = (slug: string, exch: boolean) =>
  exch
    ? `[
  {
    "id": 884213,
    "provider": "${slug}",
    "sport_name": "Cricket",
    "league_name": "Indian Premier League",
    "home_team": "Mumbai Indians",
    "away_team": "Chennai Super Kings",
    "status": "live",
    "home_score": null,
    "away_score": null,
    "match_time": "MI 142/3 (15.3)",
    "suspended": false,
    "featured": true,
    "result": null,
    "updated_at": "2026-06-09T14:00:00Z"
  }
]`
    : `[
  {
    "id": 887542438404651,
    "provider": "${slug}",
    "sport_name": "Football",
    "league_name": "Premier League",
    "home_team": "Arsenal",
    "away_team": "Chelsea",
    "status": "live",
    "home_score": 1,
    "away_score": 0,
    "match_time": "63:21",
    "suspended": false,
    "featured": false,
    "result": null,
    "updated_at": "2026-06-09T20:15:00Z"
  }
]`;

const oddsEx = (slug: string, exch: boolean) =>
  exch
    ? `[
  { "market": "Match Odds", "outcome": "Mumbai Indians", "value": "1.85", "lay": "1.87", "volume": "240310.00", "suspended": false, "provider": "${slug}" },
  { "market": "Match Odds", "outcome": "Chennai Super Kings", "value": "2.12", "lay": "2.16", "volume": "198450.00", "suspended": false, "provider": "${slug}" },
  { "market": "Bookmaker", "outcome": "Mumbai Indians", "value": "78", "lay": "82", "suspended": true, "provider": "${slug}" }
]`
    : `[
  { "market": "Match Result", "outcome": "W1", "value": "2.10", "param": null, "suspended": false, "provider": "${slug}" },
  { "market": "Total", "outcome": "Over", "value": "1.90", "param": "2.5", "suspended": false, "provider": "${slug}" },
  { "market": "Double Chance", "outcome": "1X", "value": "1.30", "param": null, "suspended": false, "provider": "${slug}" }
]`;

const ENDPOINTS: Endpoint[] = [
  {
    id: "ep-providers",
    display: "/v1/providers",
    template: "/providers",
    summary: "List the active data providers you can query, with their capabilities.",
    response: () => `[
  { "slug": "melbet", "name": "MelBet", "capabilities": ["sports","leagues","matches","live","odds","full_markets"], "is_active": true },
  { "slug": "diamondexch", "name": "Diamond Exch", "capabilities": ["sports","leagues","matches","live","odds","exchange"], "is_active": true }
]`,
  },
  {
    id: "ep-sports",
    display: "/v1/{provider}/sports",
    template: "/{provider}/sports",
    summary: "Every sport the provider offers, ordered by current match volume.",
    capability: "sports",
    params: [{ name: "provider", loc: "path", required: true, desc: "Provider slug, e.g. melbet." }],
    response: (slug) => `[
  { "id": 4, "name": "Cricket", "slug": "cricket", "match_count": 41, "provider": "${slug}" },
  { "id": 1, "name": "Football", "slug": "football", "match_count": 320, "provider": "${slug}" }
]`,
  },
  {
    id: "ep-leagues",
    display: "/v1/{provider}/leagues",
    template: "/{provider}/leagues?sport_id=1",
    summary: "Leagues / tournaments, optionally scoped to a single sport.",
    capability: "leagues",
    params: [
      { name: "provider", loc: "path", required: true, desc: "Provider slug." },
      { name: "sport_id", loc: "query", desc: "Filter to one sport." },
    ],
    response: () => `[
  { "id": 88, "sport_id": 1, "sport_name": "Football", "name": "Premier League", "country": "England", "match_count": 24 }
]`,
  },
  {
    id: "ep-sidebar",
    display: "/v1/{provider}/sidebar",
    template: "/{provider}/sidebar",
    summary: "The full \"All Sports\" tree: every sport with its nested leagues, even ones with no live match right now.",
    capability: "sports",
    params: [{ name: "provider", loc: "path", required: true, desc: "Provider slug." }],
    response: () => `[
  {
    "id": 4471626188,
    "name": "Cricket",
    "slug": "cricket",
    "match_count": 12,
    "leagues": [
      { "id": 2542291, "name": "Indian Premier League", "country": "India", "match_count": 10 }
    ]
  }
]`,
  },
  {
    id: "ep-matches",
    display: "/v1/{provider}/matches",
    template: "/{provider}/matches?status=live&limit=20",
    summary:
      "List matches and events (prematch + live), live first. Supports filtering and pagination. Exchange providers (d247) instead return the native t1/t2 envelope (open / suspended) with Match Odds sections.",
    capability: "matches",
    params: [
      { name: "provider", loc: "path", required: true, desc: "Provider slug." },
      { name: "status", loc: "query", desc: "live · prematch · finished" },
      { name: "sport_id", loc: "query", desc: "Filter by sport id." },
      { name: "league_id", loc: "query", desc: "Filter by league id." },
      { name: "search", loc: "query", desc: "Match home/away team name." },
      { name: "limit", loc: "query", desc: "1 to 500 (default 50)." },
      { name: "offset", loc: "query", desc: "Pagination offset." },
    ],
    response: (slug, exch) =>
      exch
        ? `{
  "success": true,
  "message": "Success",
  "data": {
    "t1": [
      {
        "gmid": 884213,
        "ename": "Mumbai Indians v Chennai Super Kings",
        "etid": 4, "cid": 2542291, "cname": "Indian Premier League",
        "iplay": true, "stime": "6/10/2026 7:30:00 PM",
        "tv": false, "bm": false, "f": true, "f1": false, "iscc": 0,
        "mid": 0, "mname": "MATCH_ODDS", "status": "OPEN",
        "rc": 2, "gscode": 1, "m": 0, "oid": 1, "gtype": "match",
        "section": [
          { "sid": 0, "sno": 1, "gstatus": "ACTIVE", "gscode": 1, "nat": "Mumbai Indians",
            "odds": [
              { "odds": 1.85, "oname": "back1", "otype": "back", "sid": 0, "tno": 0, "size": 240310.00 },
              { "odds": 1.87, "oname": "lay1", "otype": "lay", "sid": 0, "tno": 0, "size": 240310.00 }
            ] },
          { "sid": 0, "sno": 3, "gstatus": "ACTIVE", "gscode": 1, "nat": "Chennai Super Kings",
            "odds": [
              { "odds": 2.12, "oname": "back1", "otype": "back", "sid": 0, "tno": 0, "size": 198450.00 },
              { "odds": 2.16, "oname": "lay1", "otype": "lay", "sid": 0, "tno": 0, "size": 198450.00 }
            ] }
        ]
      }
    ],
    "t2": [
      {
        "gmid": 884999,
        "ename": "RCB (e) - Gujarat Titans (e)",
        "etid": 4, "cid": 0, "cname": "Dim Cricket League (1 over)",
        "iplay": true, "stime": "6/10/2026 9:42:00 AM",
        "tv": true, "bm": false, "f": false, "f1": false, "iscc": 4,
        "mid": 0, "mname": "MATCH_ODDS", "status": "SUSPENDED",
        "rc": 2, "gscode": 0, "m": 0, "oid": 1, "gtype": "match",
        "section": [
          { "sid": 0, "sno": 1, "gstatus": "SUSPENDED", "gscode": 0, "nat": "RCB",
            "odds": [
              { "odds": 0, "oname": "BACK1", "otype": "BACK", "sid": 0, "tno": 0, "size": 0 },
              { "odds": 0, "oname": "LAY1", "otype": "LAY", "sid": 0, "tno": 0, "size": 0 }
            ] }
        ]
      }
    ]
  },
  "apiInfo": { "provider": "ZeroApi", "website": "https://zeroapi.io" }
}`
        : matchListEx(slug, false),
  },
  {
    id: "ep-match",
    display: "/v1/{provider}/matches/{id}",
    template: "/{provider}/matches/{id}",
    summary: "Full detail for one match or event, including every market/odd. Also available as /v1/{provider}/matchdetails/{id}. Exchange providers (d247) instead use /v1/{provider}/matchdetails?gmid=ID&sportsid=N and return markets keyed by gmid.",
    capability: "matches",
    params: [
      { name: "provider", loc: "path", required: true, desc: "Provider slug." },
      { name: "id", loc: "path", required: true, desc: "Match / event id." },
    ],
    response: (slug, exch) =>
      exch
        ? `{
  "success": true,
  "message": "Success",
  "data": {
    "odds": {
      "884213": [
        {
          "gmid": 884213, "mid": 0, "pmid": null, "mname": "MATCH_ODDS", "rem": "",
          "gtype": "match", "status": "OPEN", "rc": 2, "visible": false, "pid": 0,
          "gscode": 1, "maxb": 1, "sno": 1, "dtype": 0, "ocnt": 4, "m": 0, "max": 0,
          "min": 0, "biplay": true, "umaxbof": 0, "boplay": true, "iplay": true,
          "btcnt": 0, "company": null,
          "section": [
            { "sid": 0, "psid": 0, "sno": 1, "psrno": 1, "gstatus": "ACTIVE", "nat": "Mumbai Indians",
              "gscode": 1, "max": 0, "min": 0, "rem": "", "br": false, "ik": 0, "ikm": 0,
              "odds": [
                { "psid": 0, "odds": 1.85, "otype": "back", "oname": "back1", "tno": 0, "size": 240310.00 },
                { "psid": 0, "odds": 1.87, "otype": "lay", "oname": "lay1", "tno": 0, "size": 240310.00 }
              ] },
            { "sid": 0, "psid": 0, "sno": 2, "psrno": 2, "gstatus": "ACTIVE", "nat": "Chennai Super Kings",
              "gscode": 1, "max": 0, "min": 0, "rem": "", "br": false, "ik": 0, "ikm": 0,
              "odds": [
                { "psid": 0, "odds": 2.12, "otype": "back", "oname": "back1", "tno": 0, "size": 198450.00 },
                { "psid": 0, "odds": 2.16, "otype": "lay", "oname": "lay1", "tno": 0, "size": 198450.00 }
              ] }
          ]
        }
      ]
    },
    "missing_gmids": []
  },
  "apiInfo": { "provider": "ZeroApi", "website": "https://zeroapi.io" }
}`
        : `{
  "id": 887542438404651,
  "home_team": "Arsenal",
  "away_team": "Chelsea",
  "status": "live",
  "home_score": 1,
  "away_score": 0,
  "suspended": false,
  "featured": false,
  "odds": ${oddsEx(slug, false).replace(/\n/g, "\n  ")}
}`,
  },
  {
    id: "ep-live",
    display: "/v1/{provider}/live",
    template: "/{provider}/live",
    summary: "Currently in-play matches with live scores, freshest first.",
    capability: "live",
    params: [{ name: "provider", loc: "path", required: true, desc: "Provider slug." }],
    response: (slug, exch) => matchListEx(slug, exch),
  },
  {
    id: "ep-featured",
    display: "/v1/{provider}/featured",
    template: "/{provider}/featured",
    summary: "The provider's promoted \"highlights\" strip: featured matches, outrights and special markets.",
    capability: "matches",
    params: [{ name: "provider", loc: "path", required: true, desc: "Provider slug." }],
    response: (slug, exch) =>
      exch
        ? `[
  {
    "id": 991201,
    "provider": "${slug}",
    "sport_name": "Specials",
    "league_name": null,
    "home_team": "FIFA World Cup 2026 - Winner",
    "away_team": "",
    "status": "prematch",
    "suspended": false,
    "featured": true,
    "updated_at": "2026-06-09T13:40:00Z"
  }
]`
        : matchListEx(slug, false),
  },
  {
    id: "ep-headermatches",
    display: "/v1/{provider}/headermatches",
    template: "/{provider}/headermatches",
    summary: "Matches shown in the provider's header strip (the header ticker, distinct from the main list).",
    capability: "matches",
    params: [{ name: "provider", loc: "path", required: true, desc: "Provider slug." }],
    response: (slug) => `[
  {
    "id": 884213,
    "provider": "${slug}",
    "sport_name": "Cricket",
    "league_name": "Indian Premier League",
    "home_team": "Mumbai Indians",
    "away_team": "Chennai Super Kings",
    "status": "prematch",
    "suspended": false,
    "featured": false,
    "header": true,
    "updated_at": "2026-06-10T09:00:00Z"
  }
]`,
  },
  {
    id: "ep-results",
    display: "/v1/{provider}/results",
    template: "/{provider}/results",
    summary: "Recently finished matches with an auto-derived winner (W1 / Draw / W2).",
    capability: "matches",
    params: [{ name: "provider", loc: "path", required: true, desc: "Provider slug." }],
    response: (slug) => `[
  {
    "id": 887542438404651,
    "provider": "${slug}",
    "home_team": "Arsenal",
    "away_team": "Chelsea",
    "status": "finished",
    "home_score": 2,
    "away_score": 1,
    "result": "W1",
    "finished_at": "2026-06-09T21:05:00Z"
  }
]`,
  },
  {
    id: "ep-odds",
    display: "/v1/{provider}/odds/{match_id}",
    template: "/{provider}/odds/{id}",
    summary: "Every market and outcome for one match. Sportsbooks return a single price; exchanges add lay and volume.",
    capability: "odds",
    params: [
      { name: "provider", loc: "path", required: true, desc: "Provider slug." },
      { name: "match_id", loc: "path", required: true, desc: "Match / event id." },
    ],
    response: (slug, exch) => oddsEx(slug, exch),
  },
];

/* ============================================================ schema model */

interface Field {
  name: string;
  type: string;
  desc: string;
  exch?: boolean; // exchange-only field
}
interface Schema {
  id: string;
  name: string;
  desc: string;
  fields: Field[];
}

const SCHEMAS: Schema[] = [
  {
    id: "schema-match",
    name: "Match",
    desc: "A match or event. Outright / racing events use the event name as home_team with an empty away_team.",
    fields: [
      { name: "id", type: "integer", desc: "Stable provider event id." },
      { name: "provider", type: "string", desc: "Provider slug this row came from." },
      { name: "sport_name", type: "string", desc: "Sport, e.g. Football, Cricket." },
      { name: "league_name", type: "string | null", desc: "League / tournament name." },
      { name: "home_team", type: "string", desc: "Home team, or the event name for outrights." },
      { name: "away_team", type: "string", desc: "Away team, or empty for single-entity events." },
      { name: "status", type: "string", desc: "prematch · live · finished." },
      { name: "home_score", type: "integer | null", desc: "Live home score." },
      { name: "away_score", type: "integer | null", desc: "Live away score." },
      { name: "match_time", type: "string | null", desc: "Clock / live state, e.g. 63:21 or a cricket scoreline." },
      { name: "suspended", type: "boolean", desc: "Event is locked in-play (all markets padlocked)." },
      { name: "featured", type: "boolean", desc: "Promoted in the provider's featured / highlights strip." },
      { name: "header", type: "boolean", desc: "Listed in the provider's header match strip." },
      { name: "result", type: "string | null", desc: "Derived winner once finished (W1 / Draw / W2)." },
      { name: "updated_at", type: "timestamp", desc: "Last time this row changed." },
    ],
  },
  {
    id: "schema-odd",
    name: "Odd",
    desc: "One market line. Sportsbooks quote a single decimal value; exchanges add a lay price and matched volume.",
    fields: [
      { name: "market", type: "string", desc: "Market name, e.g. Match Result, Total, Match Odds, Bookmaker." },
      { name: "outcome", type: "string", desc: "Outcome / runner, e.g. W1, Over, a team or horse name." },
      { name: "value", type: "decimal", desc: "Primary price (sportsbook odd, or exchange best back)." },
      { name: "lay", type: "decimal | null", desc: "Exchange best lay price.", exch: true },
      { name: "volume", type: "decimal | null", desc: "Exchange matched volume / size at this price.", exch: true },
      { name: "param", type: "decimal | null", desc: "Line parameter for totals / handicaps (e.g. 2.5)." },
      { name: "suspended", type: "boolean", desc: "This specific line / runner is locked." },
      { name: "provider", type: "string", desc: "Provider slug." },
    ],
  },
  {
    id: "schema-sport",
    name: "Sport / League",
    desc: "Catalog entities used to filter matches.",
    fields: [
      { name: "id", type: "integer", desc: "Stable id (scope a matches query with sport_id / league_id)." },
      { name: "name", type: "string", desc: "Display name." },
      { name: "slug", type: "string", desc: "URL-safe slug (sports only)." },
      { name: "country", type: "string | null", desc: "League country (leagues only)." },
      { name: "match_count", type: "integer", desc: "Current matches under this entity." },
    ],
  },
];

const ERRORS: [string, string][] = [
  ["400", "Bad request. Unknown provider/endpoint, missing ?provider, or a capability the provider does not expose."],
  ["401", "Unauthorized. Missing, invalid, expired or revoked API key, or the key is not allowed from this IP."],
  ["402", "Payment required. Monthly quota exceeded. Upgrade your plan (metered plans bill overage instead)."],
  ["403", "Forbidden. The key is scoped to other providers or source IPs."],
  ["404", "Not found. Unknown match / event id."],
  ["429", "Too many requests. Per-minute (or per-second) rate limit exceeded."],
];

/* ============================================================ sidebar nav */

const NAV_GROUPS: { title: string; items: { id: string; label: string; mono?: boolean; href?: string }[] }[] = [
  {
    title: "Getting started",
    items: [
      { id: "intro", label: "Introduction" },
      { id: "auth", label: "Authentication" },
      { id: "limits", label: "Rate limits & plans" },
    ],
  },
  {
    title: "Providers",
    items: [
      { id: "providers", label: "All providers" },
      ...PROVIDER_DOCS.map((d) => ({ id: `pv-${d.slug}`, label: d.name, href: `/docs/${d.slug}` })),
    ],
  },
  {
    title: "Endpoints",
    items: ENDPOINTS.map((e) => ({ id: e.id, label: e.display.replace("/v1/", ""), mono: true })),
  },
  {
    title: "Reference",
    items: [
      { id: "schemas", label: "Data types" },
      { id: "errors", label: "Errors" },
      { id: "sdks", label: "SDKs" },
    ],
  },
];

function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        });
        let best = "";
        let bestRatio = 0;
        seen.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = id;
          }
        });
        if (best) setActive(best);
      },
      { rootMargin: "-72px 0px -65% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return active;
}

/* ============================================================ page */

export default function DocsPage() {
  const [providersApi, setProvidersApi] = useState<PublicProvider[]>([]);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [selected, setSelected] = useState("melbet");

  useEffect(() => {
    getProviders().then((p) => {
      setProvidersApi(p);
      const merged = mergeProviders(p);
      if (merged.length && !merged.some((m) => m.slug === "melbet")) setSelected(merged[0].slug);
    });
    getPublicPlans().then(setPlans);
  }, []);

  const providers = useMemo(() => mergeProviders(providersApi), [providersApi]);
  const current = providers.find((p) => p.slug === selected) ?? providers[0];
  const isExchange = current?.type === "exchange";
  const slug = current?.slug ?? "melbet";

  const allIds = useMemo(() => NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)), []);
  const activeId = useScrollSpy(allIds);

  return (
    <div style={{ colorScheme: "light" }} className="min-h-screen bg-[#fbfcff] font-sans text-slate-700 antialiased">
      {/* ---------------- Top nav ---------------- */}
      <DocsHeader />

      <div className="mx-auto flex max-w-[1280px] gap-10 px-5">
        {/* ---------------- Sidebar ---------------- */}
        <aside className="hidden w-60 shrink-0 lg:block">
          <nav className="sticky top-16 max-h-[calc(100dvh-4rem)] space-y-6 overflow-y-auto py-10 pr-2">
            {NAV_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {group.title}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const on = activeId === item.id;
                    const cls = `block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      item.mono ? "font-mono text-[12.5px]" : ""
                    } ${
                      on
                        ? "bg-emerald-50 font-semibold text-emerald-700"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    }`;
                    return item.href ? (
                      <Link key={item.id} href={item.href} className={cls}>
                        {item.label}
                      </Link>
                    ) : (
                      <a key={item.id} href={`#${item.id}`} className={cls}>
                        {item.label}
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* ---------------- Content ---------------- */}
        <main className="min-w-0 flex-1 space-y-16 py-10">
          {/* Intro */}
          <section id="intro" className="scroll-mt-24">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> REST · JSON · v1
            </span>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">API reference</h1>
            <p className="mt-4 max-w-[60ch] text-lg leading-relaxed text-slate-600">
              One REST API for real-time sports data across every provider. Each provider is
              namespaced and returns its own native shape: sportsbooks quote a single price,
              exchanges quote back, lay and volume, and any locked line is flagged suspended.
            </p>
            <div className="mt-6 max-w-xl">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Base URL</p>
              <CodeBlock code={API_V1} label="base url" />
            </div>
            <p className="mt-4 text-sm text-slate-500">
              Every endpoint is static per provider: the provider is part of the path
              (<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-emerald-700">/v1/{`{provider}`}/live</code>).
              Each provider also exposes only its own kind of endpoints.
            </p>
          </section>

          {/* Auth */}
          <section id="auth" className="scroll-mt-24 border-t border-slate-200 pt-12">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><KeyRound size={20} /></span>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Authentication</h2>
            </div>
            <p className="mb-4 max-w-[62ch] text-slate-600">
              Send your key in the <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-emerald-700">X-API-Key</code> header
              {" "}on every request (or <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-emerald-700">?api_key=</code>). Create and scope keys to specific
              providers, source IPs and an expiry in the{" "}
              <Link href="/portal" className="font-semibold text-emerald-600 underline-offset-2 hover:underline">developer portal</Link>.
            </p>
            <CodeBlock code={`curl -H "X-API-Key: $ZEROAPI_KEY" "${API_V1}/melbet/live"`} label="cURL" />
            <p className="mt-3 text-sm text-slate-500">
              Every response carries <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-emerald-700">X-RateLimit-Limit</code>,
              {" "}<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-emerald-700">X-RateLimit-Remaining</code> and
              {" "}<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-emerald-700">X-RateLimit-Window-Seconds</code> headers, so you can back off before you hit a wall.
            </p>
          </section>

          {/* Limits & plans */}
          <section id="limits" className="scroll-mt-24 border-t border-slate-200 pt-12">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><Gauge size={20} /></span>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Rate limits &amp; plans</h2>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-left">
                    <th className="px-5 py-3 font-semibold text-slate-600">Plan</th>
                    <th className="px-5 py-3 font-semibold text-slate-600">Requests / min</th>
                    <th className="px-5 py-3 font-semibold text-slate-600">Monthly quota</th>
                    <th className="px-5 py-3 font-semibold text-slate-600">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plans.length === 0 ? (
                    <tr><td className="px-5 py-4 text-slate-400" colSpan={4}>Loading plans…</td></tr>
                  ) : (
                    plans.map((p) => (
                      <tr key={p.slug} className="transition-colors hover:bg-slate-50/60">
                        <td className="px-5 py-3 font-semibold text-slate-900">{p.name}</td>
                        <td className="px-5 py-3 tabular-nums text-slate-700">{p.rate_limit_per_min.toLocaleString()}</td>
                        <td className="px-5 py-3 tabular-nums text-slate-700">{formatQuota(p.monthly_quota).replace(" requests / mo", "")}</td>
                        <td className="px-5 py-3 tabular-nums font-semibold text-slate-900">{formatPrice(p.price_cents)}<span className="font-normal text-slate-400">/mo</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Over the per-minute limit returns <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-rose-600">429</code>;
              {" "}over the monthly quota returns <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-rose-600">402</code>.
            </p>
          </section>

          {/* Providers */}
          <section id="providers" className="scroll-mt-24 border-t border-slate-200 pt-12">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-600"><Boxes size={20} /></span>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">All providers</h2>
            </div>
            <p className="mb-5 max-w-[62ch] text-slate-600">
              Each provider exposes only the endpoints in its capability set, and returns its own
              native data shape. Sportsbooks give a single price per outcome; exchanges add lay and
              matched volume, and lock markets in-play.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map((p) => {
                const hasDocs = PROVIDER_DOCS.some((d) => d.slug === p.slug);
                const card = (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{p.name}</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          p.type === "exchange" ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-600"
                        }`}
                      >
                        {p.type}
                      </span>
                    </div>
                    <code className="mt-0.5 block font-mono text-[12.5px] text-slate-400">{p.slug}</code>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.caps.map((c) => (
                        <span key={c} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">{c}</span>
                      ))}
                    </div>
                    {hasDocs && (
                      <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
                        View full docs <ArrowRight size={14} />
                      </p>
                    )}
                  </>
                );
                return hasDocs ? (
                  <Link
                    key={p.slug}
                    href={`/docs/${p.slug}`}
                    className="group rounded-2xl border border-slate-200 bg-white p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                  >
                    {card}
                  </Link>
                ) : (
                  <div key={p.slug} className="rounded-2xl border border-slate-200 bg-white p-4">{card}</div>
                );
              })}
            </div>
          </section>

          {/* Endpoints */}
          <section id="endpoints-head" className="scroll-mt-24 border-t border-slate-200 pt-12">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Layers size={20} /></span>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Endpoints</h2>
            </div>
            <p className="mb-4 max-w-[62ch] text-slate-600">
              Every endpoint is <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-emerald-700">GET</code> and returns JSON.
              Pick a provider to tailor the snippets and response shapes below.
            </p>
            {/* Provider switcher */}
            <div className="sticky top-16 z-10 -mx-1 mb-2 flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white/90 p-1.5 backdrop-blur">
              {providers.map((p) => {
                const on = p.slug === slug;
                return (
                  <button
                    key={p.slug}
                    onClick={() => setSelected(p.slug)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.97] ${
                      on ? "bg-emerald-500 text-white shadow-[0_6px_18px_-8px_rgba(16,185,129,0.8)]" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
            {current && (
              <p className="text-sm text-slate-500">
                Showing <span className="font-semibold text-slate-700">{current.name}</span>
                {" "}(<span className="font-mono text-[12.5px] text-emerald-700">{current.type}</span>). Endpoints it does not support are marked below.
              </p>
            )}
          </section>

          <div className="space-y-12">
            {ENDPOINTS.map((ep) => {
              // Exchange (d247) exposes EXACTLY 6 endpoints; everything else is "not on" it.
              const EXCHANGE_OK = new Set(["ep-sports", "ep-matches", "ep-match", "ep-leagues", "ep-sidebar", "ep-headermatches"]);
              const available = isExchange
                ? EXCHANGE_OK.has(ep.id)
                : !ep.capability || (current?.caps.includes(ep.capability) ?? true);
              const examplePath = ep.template.replace("{provider}", slug).replace("{id}", isExchange ? "884213" : "887542438404651");
              const displayPath = ep.display;
              return (
                <section key={ep.id} id={ep.id} className="scroll-mt-32">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <MethodBadge />
                    <code className="font-mono text-[15px] font-semibold text-slate-900">{displayPath}</code>
                    {ep.capability && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500">
                        requires {ep.capability}
                      </span>
                    )}
                    {!available && (
                      <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
                        not on {current?.name}
                      </span>
                    )}
                  </div>
                  <p className="mb-4 max-w-[64ch] text-slate-600">{ep.summary}</p>

                  {ep.params && ep.params.length > 0 && (
                    <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/70 text-left">
                            <th className="px-4 py-2.5 font-semibold text-slate-600">Parameter</th>
                            <th className="px-4 py-2.5 font-semibold text-slate-600">In</th>
                            <th className="px-4 py-2.5 font-semibold text-slate-600">Required</th>
                            <th className="px-4 py-2.5 font-semibold text-slate-600">Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ep.params.map((p) => (
                            <tr key={p.name}>
                              <td className="px-4 py-2.5 font-mono text-[12.5px] font-semibold text-emerald-700">{p.name}</td>
                              <td className="px-4 py-2.5 text-slate-500">{p.loc}</td>
                              <td className="px-4 py-2.5 text-slate-500">{p.required ? "yes" : "no"}</td>
                              <td className="px-4 py-2.5 text-slate-600">{p.desc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Request</p>
                      <RequestTabs path={examplePath} />
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Example response</p>
                      <CodeBlock code={ep.response(slug, isExchange)} label="json" />
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          {/* Schemas */}
          <section id="schemas" className="scroll-mt-24 border-t border-slate-200 pt-12">
            <h2 className="mb-4 text-2xl font-bold tracking-tight text-slate-900">Data types</h2>
            <p className="mb-6 max-w-[62ch] text-slate-600">
              The shapes returned across endpoints. Fields marked <span className="font-mono text-[12.5px] text-violet-600">exchange</span> only appear for exchange providers.
            </p>
            <div className="space-y-6">
              {SCHEMAS.map((s) => (
                <div key={s.id} id={s.id} className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-5 py-3.5">
                    <h3 className="font-bold text-slate-900">{s.name}</h3>
                    <p className="mt-0.5 text-sm text-slate-500">{s.desc}</p>
                  </div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {s.fields.map((f) => (
                        <tr key={f.name}>
                          <td className="w-44 px-5 py-2.5 align-top font-mono text-[12.5px] font-semibold text-slate-900">{f.name}</td>
                          <td className="w-40 px-2 py-2.5 align-top font-mono text-[12px] text-slate-400">{f.type}</td>
                          <td className="px-5 py-2.5 text-slate-600">
                            {f.desc}
                            {f.exch && <span className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[10.5px] text-violet-600">exchange</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>

          {/* Errors */}
          <section id="errors" className="scroll-mt-24 border-t border-slate-200 pt-12">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-rose-500"><AlertTriangle size={20} /></span>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Errors</h2>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {ERRORS.map(([code, desc]) => (
                    <tr key={code}>
                      <td className="w-20 px-5 py-3 align-top font-mono text-[13px] font-bold text-rose-600">{code}</td>
                      <td className="px-5 py-3 text-slate-600">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Errors return <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-slate-700">{`{ "error": "message" }`}</code> with the matching status.
            </p>
          </section>

          {/* SDKs */}
          <section id="sdks" className="scroll-mt-24 border-t border-slate-200 pt-12 pb-16">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><Terminal size={20} /></span>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">SDKs</h2>
            </div>
            <p className="mb-4 max-w-[62ch] text-slate-600">
              Typed clients with retries and rate-limit-aware backoff. Or just call the REST API directly with any HTTP client.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <CodeBlock
                label="JavaScript"
                code={`npm i @zeroapi/sdk

import { ZeroApi } from "@zeroapi/sdk";
const c = new ZeroApi({ apiKey: process.env.ZEROAPI_KEY });
const live = await c.live("${slug}");`}
              />
              <CodeBlock
                label="Python"
                code={`pip install zeroapi

from zeroapi import ZeroApi
c = ZeroApi(api_key=os.environ["ZEROAPI_KEY"])
live = c.live("${slug}")`}
              />
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-sky-50 p-6">
              <div>
                <p className="text-lg font-bold text-slate-900">Ready to build?</p>
                <p className="text-sm text-slate-600">Create a free key and pull live odds in minutes.</p>
              </div>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(16,185,129,0.7)] transition-all duration-150 hover:bg-emerald-600 active:scale-[0.97]"
              >
                Get API key <ChevronRight size={16} />
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

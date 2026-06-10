// Per-provider documentation content — the source of truth for /docs/[provider].
// Every provider gets a genuinely different page: its own copy, its own example
// sport/league/teams, its own market list, its own endpoint set and its own
// sample payloads, because the providers are NOT interchangeable.

export interface DocParam {
  name: string;
  loc: "path" | "query";
  required?: boolean;
  desc: string;
}

export interface DocEndpoint {
  id: string;
  path: string; // concrete path, e.g. /melbet/live
  display: string; // pretty path with placeholders, e.g. /v1/melbet/odds/{match_id}
  summary: string;
  params: DocParam[];
  /** Concrete request path used in code snippets (ids substituted). */
  example: string;
  response: string; // sample JSON
}

export interface OddField {
  name: string;
  type: string;
  desc: string;
}

export interface ProviderDoc {
  slug: string;
  name: string;
  kind: "sportsbook" | "exchange";
  accent: string;
  tagline: string;
  dataSource: string;
  cadence: string; // how fresh the feed is
  about: string[]; // unique paragraphs
  quirks: string[]; // unique "good to know" notes
  markets: string[];
  oddFields: OddField[];
  endpoints: DocEndpoint[];
}

/* ------------------------------------------------------------------ seeds */

interface Seed {
  slug: string;
  name: string;
  kind: "sportsbook" | "exchange";
  accent: string;
  tagline: string;
  dataSource: string;
  cadence: string;
  caps: string[];
  sport: { id: number; name: string; slug: string; count: number };
  sport2: { id: number; name: string; slug: string; count: number };
  league: { id: number; name: string; country: string; count: number };
  home: string;
  away: string;
  matchId: string;
  liveTime: string;
  score: [number | null, number | null];
  markets: string[];
  oddFields: OddField[];
  oddsRows: string; // sample odds JSON (array)
  marketsGrouped: string; // sample /markets JSON
  about: string[];
  quirks: string[];
}

const SB_ODD_FIELDS: OddField[] = [
  { name: "market", type: "string", desc: "Market name, e.g. Match Result, Total." },
  { name: "outcome", type: "string", desc: "Outcome label, e.g. W1, Over, a team name." },
  { name: "value", type: "decimal", desc: "Decimal price for this outcome." },
  { name: "param", type: "decimal | null", desc: "Line for totals / handicaps, e.g. 2.5." },
  { name: "suspended", type: "boolean", desc: "This line is currently locked." },
];

const EX_ODD_FIELDS: OddField[] = [
  { name: "market", type: "string", desc: "Market name: Match Odds, Bookmaker, Fancy, Winner." },
  { name: "outcome", type: "string", desc: "Runner name (team / player / line)." },
  { name: "value", type: "decimal", desc: "Best available back price." },
  { name: "lay", type: "decimal | null", desc: "Best available lay price." },
  { name: "volume", type: "decimal | null", desc: "Matched volume / size behind the price." },
  { name: "suspended", type: "boolean", desc: "Runner or whole market locked in-play." },
];

const SEEDS: Seed[] = [
  {
    slug: "melbet",
    name: "MelBet",
    kind: "sportsbook",
    accent: "#059669",
    tagline: "The reference sportsbook feed — native JSON with the full market tree.",
    dataSource: "1xbet-family LineFeed / LiveFeed JSON (native, no scraping)",
    cadence: "Live matches refresh roughly every 5 seconds; prematch every minute.",
    caps: ["sports", "leagues", "matches", "live", "odds", "full_markets"],
    sport: { id: 1, name: "Football", slug: "football", count: 312 },
    sport2: { id: 3, name: "Basketball", slug: "basketball", count: 64 },
    league: { id: 88, name: "LaLiga", country: "Spain", count: 18 },
    home: "Real Madrid",
    away: "Barcelona",
    matchId: "887542438404651",
    liveTime: "63:21",
    score: [1, 0],
    markets: ["1x2", "Double Chance", "Total", "Handicap", "Individual Total", "1x2 (incl. OT)"],
    oddFields: SB_ODD_FIELDS,
    oddsRows: `[
  { "market": "1x2", "outcome": "W1", "value": "1.92", "param": null, "suspended": false, "provider": "melbet" },
  { "market": "1x2", "outcome": "X", "value": "3.60", "param": null, "suspended": false, "provider": "melbet" },
  { "market": "Total", "outcome": "Over", "value": "1.85", "param": "2.5", "suspended": false, "provider": "melbet" },
  { "market": "Handicap", "outcome": "W2", "value": "2.04", "param": "-1.0", "suspended": false, "provider": "melbet" }
]`,
    marketsGrouped: `[
  {
    "market": "1x2",
    "outcomes": [
      { "outcome": "W1", "value": "1.92" },
      { "outcome": "X", "value": "3.60" },
      { "outcome": "W2", "value": "4.10" }
    ]
  },
  {
    "market": "Total",
    "outcomes": [
      { "outcome": "Over", "value": "1.85", "param": "2.5" },
      { "outcome": "Under", "value": "1.95", "param": "2.5" }
    ]
  }
]`,
    about: [
      "MelBet is served from the 1xbet-family LineFeed / LiveFeed JSON endpoints — the same payloads the bookmaker's own site renders from. Because nothing is scraped from a DOM, this is the fastest and most complete feed on the platform and the best default choice for a new integration.",
      "It is the only sportsbook here with the full market-group tree: alongside the flat odds list you can query /marketgroups to mirror the bookmaker's own market navigation, and every odd carries its group and type codes so you can rebuild the exact site layout.",
    ],
    quirks: [
      "Odds carry extra group_id and type_code fields you won't see on scraped providers — use them to group and order markets exactly like the source site.",
      "match_time is the running clock (e.g. 63:21) for football and a period label for other sports.",
      "Totals and handicaps put the line in param; the same market name repeats once per line.",
      "This provider supports the full_markets capability — /marketgroups is exclusive to it.",
    ],
  },
  {
    slug: "1xbet",
    name: "1xBet",
    kind: "sportsbook",
    accent: "#3b82f6",
    tagline: "Main-market prices scraped from the rendered 1xBet SPA.",
    dataSource: "1xBet SPA, rendered DOM via headless browser",
    cadence: "Live pages re-rendered roughly every 10–15 seconds.",
    caps: ["sports", "leagues", "matches", "live", "odds"],
    sport: { id: 1, name: "Football", slug: "football", count: 286 },
    sport2: { id: 2, name: "Tennis", slug: "tennis", count: 92 },
    league: { id: 12, name: "Premier League", country: "England", count: 20 },
    home: "Arsenal",
    away: "Chelsea",
    matchId: "532117440",
    liveTime: "71:08",
    score: [2, 1],
    markets: ["Match Result", "Double Chance", "Total"],
    oddFields: SB_ODD_FIELDS,
    oddsRows: `[
  { "market": "Match Result", "outcome": "W1", "value": "1.65", "param": null, "suspended": false, "provider": "1xbet" },
  { "market": "Double Chance", "outcome": "1X", "value": "1.22", "param": null, "suspended": false, "provider": "1xbet" },
  { "market": "Total", "outcome": "Under", "value": "2.02", "param": "3.5", "suspended": true, "provider": "1xbet" }
]`,
    marketsGrouped: `[
  {
    "market": "Match Result",
    "outcomes": [
      { "outcome": "W1", "value": "1.65" },
      { "outcome": "X", "value": "4.00" },
      { "outcome": "W2", "value": "5.25" }
    ]
  }
]`,
    about: [
      "The 1xBet provider drives a real headless browser over the 1xBet single-page app and reads prices out of the rendered DOM. You get the headline markets the site shows on its match rows — Match Result, Double Chance and Total — rather than the full depth of the book.",
      "Because the feed is screen-derived it is a touch slower than MelBet's native JSON, but it reflects exactly what a visitor to 1xbet.com sees, including in-play suspensions the instant the site padlocks a line.",
    ],
    quirks: [
      "Only the headline markets (Match Result / Double Chance / Total) are captured — for the full tree use melbet, which shares the same bookmaker family.",
      "When the site padlocks a price, the row stays in the response with suspended: true rather than disappearing.",
      "Event ids are stable for the lifetime of the event but are NOT interchangeable with melbet ids.",
      "Mirror-domain rotation is handled server-side; you never need to care which 1xBet mirror is being read.",
    ],
  },
  {
    slug: "betwinner",
    name: "BetWinner",
    kind: "sportsbook",
    accent: "#d97706",
    tagline: "Headline odds from the BetWinner site, tennis and football first.",
    dataSource: "BetWinner SPA, rendered DOM via headless browser",
    cadence: "Live pages re-rendered roughly every 10–15 seconds.",
    caps: ["sports", "leagues", "matches", "live", "odds"],
    sport: { id: 2, name: "Tennis", slug: "tennis", count: 118 },
    sport2: { id: 1, name: "Football", slug: "football", count: 240 },
    league: { id: 301, name: "ATP Roland Garros", country: "France", count: 16 },
    home: "Novak Djokovic",
    away: "Carlos Alcaraz",
    matchId: "771203998",
    liveTime: "Set 3, 4-3",
    score: [1, 1],
    markets: ["Match Result", "Double Chance", "Total"],
    oddFields: SB_ODD_FIELDS,
    oddsRows: `[
  { "market": "Match Result", "outcome": "W1", "value": "2.45", "param": null, "suspended": false, "provider": "betwinner" },
  { "market": "Match Result", "outcome": "W2", "value": "1.55", "param": null, "suspended": false, "provider": "betwinner" },
  { "market": "Total", "outcome": "Over", "value": "1.80", "param": "38.5", "suspended": false, "provider": "betwinner" }
]`,
    marketsGrouped: `[
  {
    "market": "Match Result",
    "outcomes": [
      { "outcome": "W1", "value": "2.45" },
      { "outcome": "W2", "value": "1.55" }
    ]
  }
]`,
    about: [
      "BetWinner is read from the rendered BetWinner web app. It belongs to the same bookmaker family as 1xBet, so the market vocabulary is identical, but the line-up of events differs: BetWinner surfaces a noticeably deeper tennis and table-tennis schedule.",
      "Use it when you want a second price source for cross-checking the 1xbet-family books, or when you specifically need its racquet-sport coverage.",
    ],
    quirks: [
      "Two-outcome sports (tennis, volleyball) return only W1/W2 in Match Result — there is no X row.",
      "match_time carries a set/leg description (e.g. \"Set 3, 4-3\") instead of a clock.",
      "Same family as 1xBet but a different book — prices and event ids do not match across the two.",
      "Headline markets only; suspended lines stay in the payload flagged suspended: true.",
    ],
  },
  {
    slug: "megapari",
    name: "MegaPari",
    kind: "sportsbook",
    accent: "#8b5cf6",
    tagline: "Long-tail sports and esports coverage from the MegaPari SPA.",
    dataSource: "MegaPari SPA, rendered DOM via headless browser",
    cadence: "Live pages re-rendered roughly every 15 seconds.",
    caps: ["sports", "leagues", "matches", "live", "odds"],
    sport: { id: 3, name: "Basketball", slug: "basketball", count: 74 },
    sport2: { id: 40, name: "Esports", slug: "esports", count: 55 },
    league: { id: 410, name: "NBA", country: "USA", count: 12 },
    home: "LA Lakers",
    away: "Boston Celtics",
    matchId: "640881223",
    liveTime: "Q3 04:12",
    score: [78, 81],
    markets: ["Match Result", "Double Chance", "Total"],
    oddFields: SB_ODD_FIELDS,
    oddsRows: `[
  { "market": "Match Result", "outcome": "W1", "value": "2.30", "param": null, "suspended": false, "provider": "megapari" },
  { "market": "Match Result", "outcome": "W2", "value": "1.62", "param": null, "suspended": false, "provider": "megapari" },
  { "market": "Total", "outcome": "Over", "value": "1.90", "param": "215.5", "suspended": false, "provider": "megapari" }
]`,
    marketsGrouped: `[
  {
    "market": "Total",
    "outcomes": [
      { "outcome": "Over", "value": "1.90", "param": "215.5" },
      { "outcome": "Under", "value": "1.90", "param": "215.5" }
    ]
  }
]`,
    about: [
      "MegaPari is scraped from the rendered MegaPari app. It shares the 1xbet-family market vocabulary, and its standout trait is breadth: minor leagues, niche sports and a busy esports section appear here that the bigger books often skip.",
      "Treat it as your long-tail source — when an event is missing on melbet or 1xbet, check megapari before giving up on it.",
    ],
    quirks: [
      "Esports events appear under their own sport with the game name in league_name (e.g. \"CS2 — ESL Pro League\").",
      "US-sport totals quote high lines in param (e.g. 215.5 points) — same field, different scale.",
      "Headline markets only (Match Result / Double Chance / Total).",
      "match_time uses period notation: Q3 04:12 for basketball, map period for esports.",
    ],
  },
  {
    slug: "1win",
    name: "1Win",
    kind: "sportsbook",
    accent: "#ec4899",
    tagline: "Structured lp-feed JSON with period-level live state.",
    dataSource: "1Win top-parser lp-feed JSON",
    cadence: "Feed polled every few seconds; near-real-time in play.",
    caps: ["sports", "leagues", "matches", "live", "odds"],
    sport: { id: 1, name: "Football", slug: "football", count: 268 },
    sport2: { id: 6, name: "Ice Hockey", slug: "ice-hockey", count: 48 },
    league: { id: 207, name: "Serie A", country: "Italy", count: 20 },
    home: "Inter",
    away: "Juventus",
    matchId: "915530227",
    liveTime: "2H 58:44",
    score: [0, 0],
    markets: ["Match Result", "Total", "Handicap", "Both Teams To Score"],
    oddFields: SB_ODD_FIELDS,
    oddsRows: `[
  { "market": "Match Result", "outcome": "X", "value": "2.95", "param": null, "suspended": false, "provider": "1win" },
  { "market": "Both Teams To Score", "outcome": "Yes", "value": "2.10", "param": null, "suspended": false, "provider": "1win" },
  { "market": "Handicap", "outcome": "W1", "value": "1.98", "param": "+0.5", "suspended": false, "provider": "1win" }
]`,
    marketsGrouped: `[
  {
    "market": "Both Teams To Score",
    "outcomes": [
      { "outcome": "Yes", "value": "2.10" },
      { "outcome": "No", "value": "1.68" }
    ]
  }
]`,
    about: [
      "1Win is consumed through its top-parser lp-feed — structured JSON rather than a scraped page — which makes it the second \"native\" feed on the platform after MelBet. It carries prematch and live with a richer live state: the current period travels with every match.",
      "Its market set is a different cut from the 1xbet family: you get Both Teams To Score and proper Handicap lines, which makes it a good complement rather than a duplicate.",
    ],
    quirks: [
      "match_time is prefixed with the period: \"2H 58:44\" (second half) or \"P1 12:02\" for hockey.",
      "Both Teams To Score is exclusive to this provider on the platform.",
      "Handicap params carry an explicit sign: +0.5 / -1.5.",
      "Blocked outcomes arrive flagged suspended: true within a second or two of the feed locking them.",
    ],
  },
  {
    slug: "bcgame",
    name: "BC.Game",
    kind: "sportsbook",
    accent: "#14b8a6",
    tagline: "BetBy JSON API — outrights and alternative lines included.",
    dataSource: "BC.Game BetBy / sptpub JSON API",
    cadence: "API polled continuously; updates land within seconds.",
    caps: ["sports", "leagues", "matches", "live", "odds"],
    sport: { id: 6, name: "Ice Hockey", slug: "ice-hockey", count: 56 },
    sport2: { id: 40, name: "Esports", slug: "esports", count: 88 },
    league: { id: 540, name: "NHL", country: "USA", count: 14 },
    home: "Toronto Maple Leafs",
    away: "NY Rangers",
    matchId: "2387511046",
    liveTime: "P2 09:31",
    score: [2, 2],
    markets: ["1x2", "Total", "Handicap", "Double Chance", "Outright"],
    oddFields: [
      ...SB_ODD_FIELDS.filter((f) => f.name !== "suspended"),
      { name: "suspended", type: "boolean", desc: "Line removed from the BetBy book (rare; lines usually just vanish)." },
    ],
    oddsRows: `[
  { "market": "1x2", "outcome": "W1", "value": "2.55", "param": null, "suspended": false, "provider": "bcgame" },
  { "market": "Total", "outcome": "Over", "value": "1.87", "param": "5.5", "suspended": false, "provider": "bcgame" },
  { "market": "Total", "outcome": "Over", "value": "2.60", "param": "6.5", "suspended": false, "provider": "bcgame" },
  { "market": "Outright", "outcome": "Toronto Maple Leafs", "value": "8.50", "param": null, "suspended": false, "provider": "bcgame" }
]`,
    marketsGrouped: `[
  {
    "market": "Total",
    "outcomes": [
      { "outcome": "Over", "value": "1.87", "param": "5.5" },
      { "outcome": "Under", "value": "1.93", "param": "5.5" },
      { "outcome": "Over", "value": "2.60", "param": "6.5" },
      { "outcome": "Under", "value": "1.48", "param": "6.5" }
    ]
  }
]`,
    about: [
      "BC.Game runs on the BetBy sportsbook platform, and this provider reads BetBy's sptpub JSON API directly. It is a clean structured feed with two things the scraped books don't give you: outright (tournament winner) markets, and alternative lines — multiple Over/Under and handicap lines per match instead of just the main one.",
      "Scheduling data is strong too: prematch events carry exact start timestamps, which makes this the best provider for building an upcoming-fixtures view.",
    ],
    quirks: [
      "Alternative lines mean the same market name repeats with different param values — group by (market, param) when rendering.",
      "Outrights come through as events with the competition name in home_team and an empty away_team.",
      "Lines that get cut are usually removed from the book entirely rather than flagged suspended.",
      "Esports coverage (CS2, Dota 2, LoL) is the deepest on the platform.",
    ],
  },
  {
    slug: "diamondexch",
    name: "Diamond Exch (d247)",
    kind: "exchange",
    accent: "#6366f1",
    tagline: "A real betting exchange: back, lay and matched volume — cricket first.",
    dataSource: "Diamond Exch (d247) SPA, rendered DOM via Playwright",
    cadence: "In-play markets re-read every few seconds; suspensions propagate immediately.",
    caps: ["sports", "leagues", "matches", "live", "odds", "exchange"],
    sport: { id: 4, name: "Cricket", slug: "cricket", count: 38 },
    sport2: { id: 1, name: "Football", slug: "football", count: 122 },
    league: { id: 2542291, name: "Indian Premier League", country: "India", count: 10 },
    home: "Mumbai Indians",
    away: "Chennai Super Kings",
    matchId: "884213",
    liveTime: "MI 142/3 (15.3)",
    score: [null, null],
    markets: ["Match Odds", "Bookmaker", "Fancy", "Winner"],
    oddFields: EX_ODD_FIELDS,
    oddsRows: `[
  { "market": "Match Odds", "outcome": "Mumbai Indians", "value": "1.85", "lay": "1.87", "volume": "240310.00", "suspended": false, "provider": "diamondexch" },
  { "market": "Match Odds", "outcome": "Chennai Super Kings", "value": "2.12", "lay": "2.16", "volume": "198450.00", "suspended": false, "provider": "diamondexch" },
  { "market": "Bookmaker", "outcome": "Mumbai Indians", "value": "78", "lay": "82", "volume": null, "suspended": true, "provider": "diamondexch" },
  { "market": "Fancy", "outcome": "15 Over Runs MI", "value": "148", "lay": "150", "volume": null, "suspended": false, "provider": "diamondexch" }
]`,
    marketsGrouped: "",
    about: [
      "Diamond Exch (d247) is the one exchange on the platform, and its data shape is fundamentally different from every sportsbook here. Each runner quotes a back price, a lay price and the matched volume behind it, and whole markets lock (suspend) the moment a ball is bowled or a goal goes in.",
      "Coverage is cricket-first — Match Odds, Bookmaker and Fancy (session) markets on every televised game — with football and tennis exchanges alongside. The site is a heavily protected SPA, so the feed is produced by Playwright rendering the real app and reading its DOM.",
      "The endpoint surface is deliberately small: six endpoints, and odds are only delivered inside /matchdetails/{id} — there is no separate odds endpoint, because on an exchange the prices are meaningless without the suspension state that travels with the match.",
    ],
    quirks: [
      "Odds live ONLY inside /matchdetails/{id} — there is no /odds or /markets endpoint on this provider.",
      "Bookmaker and Fancy prices are quoted in exchange ticks (e.g. 78/82), not decimal odds — divide by 100 and add 1 to convert.",
      "Fancy markets are cricket session lines: the outcome is the line description, value/lay are the run brackets.",
      "suspended flips constantly in-play; always render it, never cache through it.",
      "match_time for cricket is the scoreline string, e.g. \"MI 142/3 (15.3)\" — there is no clock.",
    ],
  },
];

/* ------------------------------------------------------------ doc builder */

const P = (slug: string): DocParam => ({
  name: "provider",
  loc: "path",
  required: true,
  desc: `Provider slug — here always ${slug}.`,
});

function matchId(s: Seed): string {
  return JSON.stringify(Number.isSafeInteger(Number(s.matchId)) ? Number(s.matchId) : s.matchId);
}

// Inner fields of a Match object, indented one level relative to `indent`.
function matchFields(s: Seed, status: string, indent: string): string {
  const [hs, as] = status === "prematch" ? [null, null] : s.score;
  const lines = [
    `"id": ${matchId(s)},`,
    `"provider": "${s.slug}",`,
    `"sport_name": "${s.sport.name}",`,
    `"league_name": "${s.league.name}",`,
    `"home_team": "${s.home}",`,
    `"away_team": "${s.away}",`,
    `"status": "${status}",`,
    `"home_score": ${hs === null ? "null" : hs},`,
    `"away_score": ${as === null ? "null" : as},`,
    `"match_time": ${status === "live" ? `"${s.liveTime}"` : "null"},`,
    `"suspended": false,`,
    `"featured": ${s.kind === "exchange"},`,
    `"updated_at": "2026-06-10T09:30:00Z"`,
  ];
  return lines.map((l) => indent + "  " + l).join("\n");
}

function matchRow(s: Seed, status: string, indent = "  "): string {
  return `${indent}{\n${matchFields(s, status, indent)}\n${indent}}`;
}

function buildEndpoints(s: Seed): DocEndpoint[] {
  const eps: DocEndpoint[] = [];
  const base = `/${s.slug}`;
  const add = (
    id: string,
    suffix: string,
    summary: string,
    params: DocParam[],
    response: string,
    exampleSuffix?: string,
  ) =>
    eps.push({
      id,
      path: `${base}${suffix}`,
      display: `/v1${base}${suffix}`,
      summary,
      params,
      example: `${base}${exampleSuffix ?? suffix}`,
      response,
    });

  add(
    "sports",
    "/sports",
    `Every sport currently carried on ${s.name}, ordered by match volume.`,
    [P(s.slug)],
    `[
  { "id": ${s.sport.id}, "name": "${s.sport.name}", "slug": "${s.sport.slug}", "match_count": ${s.sport.count}, "provider": "${s.slug}" },
  { "id": ${s.sport2.id}, "name": "${s.sport2.name}", "slug": "${s.sport2.slug}", "match_count": ${s.sport2.count}, "provider": "${s.slug}" }
]`,
  );

  add(
    "matches",
    "/matches",
    "Matches and events (prematch + live), live first. Filterable and paginated.",
    [
      P(s.slug),
      { name: "status", loc: "query", desc: "live · prematch · finished" },
      { name: "sport_id", loc: "query", desc: `Filter by sport id (e.g. ${s.sport.id} = ${s.sport.name}).` },
      { name: "league_id", loc: "query", desc: "Filter by league id." },
      { name: "search", loc: "query", desc: "Match home/away team name." },
      { name: "limit", loc: "query", desc: "1–500, default 50." },
      { name: "offset", loc: "query", desc: "Pagination offset." },
    ],
    `[\n${matchRow(s, "live")}\n]`,
    `/matches?status=live&sport_id=${s.sport.id}`,
  );

  add(
    "matchdetails",
    "/matchdetails/{id}",
    s.kind === "exchange"
      ? "Full match detail plus every market — back, lay, volume and suspension per runner. The only place odds appear on this provider."
      : "Full detail for one match including every captured odd. Also available as /matches/{id}.",
    [P(s.slug), { name: "id", loc: "path", required: true, desc: `Match id, e.g. ${s.matchId}.` }],
    `{
${matchFields(s, "live", "")},
  "odds": ${s.oddsRows.replace(/\n/g, "\n  ")}
}`,
    `/matchdetails/${s.matchId}`,
  );

  add(
    "leagues",
    "/leagues",
    "Leagues / competitions, optionally scoped to one sport.",
    [P(s.slug), { name: "sport_id", loc: "query", desc: "Filter to one sport." }],
    `[
  { "id": ${s.league.id}, "sport_id": ${s.sport.id}, "sport_name": "${s.sport.name}", "name": "${s.league.name}", "country": "${s.league.country}", "match_count": ${s.league.count} }
]`,
  );

  add(
    "sidebar",
    "/sidebar",
    "The full sports tree — every sport with its nested leagues, including ones with no live match right now.",
    [P(s.slug)],
    `[
  {
    "id": ${s.sport.id},
    "name": "${s.sport.name}",
    "slug": "${s.sport.slug}",
    "match_count": ${s.sport.count},
    "leagues": [
      { "id": ${s.league.id}, "name": "${s.league.name}", "country": "${s.league.country}", "match_count": ${s.league.count} }
    ]
  }
]`,
  );

  if (s.kind === "exchange") {
    add(
      "headermatches",
      "/headermatches",
      "Matches promoted in the d247 header strip — the events the exchange itself is pushing right now.",
      [P(s.slug)],
      `[\n${matchRow(s, "prematch")}\n]`,
    );
    return eps;
  }

  add("live", "/live", "Currently in-play matches with scores, freshest first.", [P(s.slug)], `[\n${matchRow(s, "live")}\n]`);

  add(
    "prematch",
    "/prematch",
    "Scheduled (not yet started) matches only.",
    [P(s.slug)],
    `[\n${matchRow(s, "prematch")}\n]`,
  );

  add(
    "featured",
    "/featured",
    `Events ${s.name} is promoting in its highlights strip.`,
    [P(s.slug)],
    `[\n${matchRow(s, "prematch")}\n]`,
  );

  add(
    "headermatches",
    "/headermatches",
    "Matches shown in the provider's header ticker (distinct from the main list).",
    [P(s.slug)],
    `[\n${matchRow(s, "prematch")}\n]`,
  );

  add(
    "results",
    "/results",
    "Recently finished matches with a derived winner (W1 / Draw / W2).",
    [P(s.slug)],
    `[
  {
    "id": ${JSON.stringify(Number.isSafeInteger(Number(s.matchId)) ? Number(s.matchId) : s.matchId)},
    "provider": "${s.slug}",
    "home_team": "${s.home}",
    "away_team": "${s.away}",
    "status": "finished",
    "home_score": 2,
    "away_score": 1,
    "result": "W1",
    "finished_at": "2026-06-09T21:05:00Z"
  }
]`,
  );

  add(
    "odds",
    "/odds/{match_id}",
    `Flat list of every captured odd for one match — ${s.name}'s native markets: ${s.markets.slice(0, 3).join(", ")}…`,
    [P(s.slug), { name: "match_id", loc: "path", required: true, desc: `Match id, e.g. ${s.matchId}.` }],
    s.oddsRows,
    `/odds/${s.matchId}`,
  );

  add(
    "markets",
    "/markets/{match_id}",
    "The same odds grouped by market, each with its outcomes in display order.",
    [P(s.slug), { name: "match_id", loc: "path", required: true, desc: "Match id." }],
    s.marketsGrouped,
    `/markets/${s.matchId}`,
  );

  if (s.caps.includes("full_markets")) {
    add(
      "marketgroups",
      "/marketgroups",
      "The bookmaker's own market-group tree (exclusive to providers with the full_markets capability).",
      [P(s.slug)],
      `[
  { "group_id": 1, "name": "Main", "markets": ["1x2", "Double Chance", "Total"] },
  { "group_id": 8, "name": "Totals", "markets": ["Total", "Individual Total"] },
  { "group_id": 17, "name": "Handicaps", "markets": ["Handicap"] }
]`,
    );
  }

  return eps;
}

/* -------------------------------------------------------------- exports */

export const PROVIDER_DOCS: ProviderDoc[] = SEEDS.map((s) => ({
  slug: s.slug,
  name: s.name,
  kind: s.kind,
  accent: s.accent,
  tagline: s.tagline,
  dataSource: s.dataSource,
  cadence: s.cadence,
  about: s.about,
  quirks: s.quirks,
  markets: s.markets,
  oddFields: s.oddFields,
  endpoints: buildEndpoints(s),
}));

export const DOC_SLUGS = PROVIDER_DOCS.map((d) => d.slug);

export function getProviderDoc(slug: string): ProviderDoc | undefined {
  return PROVIDER_DOCS.find((d) => d.slug === slug);
}

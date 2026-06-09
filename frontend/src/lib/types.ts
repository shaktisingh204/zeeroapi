export interface User {
  id: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Sport {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  match_count: number;
  logo_url: string | null;
  updated_at: string;
}

export interface LeagueView {
  id: number;
  sport_id: number;
  sport_name: string;
  name: string;
  country: string | null;
  logo_url: string | null;
  match_count: number;
  live_count: number;
  updated_at: string;
}

export interface Provider {
  slug: string;
  name: string;
  base_url: string;
  is_active: boolean;
  created_at: string;
}

export interface Plan {
  slug: string;
  name: string;
  price_cents: number;
  rate_limit_per_min: number;
  rate_limit_per_sec?: number | null;
  monthly_quota: number;
  features: string[];
  sort_order: number;
  stripe_price_id?: string | null;
  metered_price_id?: string | null;
}

export interface Customer {
  id: string;
  email: string;
  name: string | null;
  plan_slug: string;
  is_active: boolean;
  alert_threshold: number;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  subscription_status?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  customer_id: string;
  name: string | null;
  key_prefix: string;
  revoked: boolean;
  last_used_at: string | null;
  created_at: string;
  allowed_providers: string[] | null;
  allowed_ips: string[] | null;
  expires_at: string | null;
}

// --- Analytics (portal + admin) ---
export interface EndpointStat {
  provider: string;
  endpoint: string;
  count: number;
  avg_latency_ms: number;
}
export interface StatusStat {
  status_class: number; // 2 | 4 | 5
  count: number;
}
export interface LatencyPoint {
  day: string;
  avg_latency_ms: number;
  count: number;
}

export interface CustomerUsage {
  customer_id: string;
  plan: string;
  used_this_month: number;
  monthly_quota: number;
}

export interface Image {
  url: string;
  kind: "sport" | "league" | "team";
  name: string | null;
  seen_count: number;
  created_at: string;
  last_seen: string;
}

export interface MatchView {
  id: number;
  sport_id: number;
  sport_name: string;
  league_id: number | null;
  league_name: string | null;
  provider: string;
  home_team: string;
  away_team: string;
  home_logo: string | null;
  away_logo: string | null;
  start_time: string | null;
  status: "prematch" | "live" | "finished";
  home_score: number | null;
  away_score: number | null;
  period: string | null;
  match_time: string | null;
  result: "W1" | "Draw" | "W2" | null;
  finished_at: string | null;
  /** Event is locked in-play (exchange padlock / all markets suspended). */
  suspended: boolean;
  /** Promoted in the provider's featured / highlights strip. */
  featured: boolean;
  /** Listed in the provider's header match strip. */
  header: boolean;
  updated_at: string;
}

export interface Odd {
  id: number;
  match_id: number;
  market: string;
  outcome: string;
  /** Primary price (sportsbook decimal odd, or exchange best back). */
  value: string;
  /** Exchange best lay price (null for sportsbooks). */
  lay: string | null;
  /** Exchange matched volume / size (null for sportsbooks). */
  volume: string | null;
  param: string | null;
  /** This specific line / runner is suspended or blocked. */
  suspended: boolean;
  updated_at: string;
}

export interface MatchDetail extends MatchView {
  odds: Odd[];
}

export interface ScrapeLog {
  id: number;
  job: string;
  status: "success" | "error";
  items: number;
  duration_ms: number;
  message: string | null;
  started_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface SportCount {
  sport_name: string;
  count: number;
}

// --- Admin analytics ---
export interface HealthTimelinePoint {
  hour: string;
  success: number;
  error: number;
  avg_ms: number;
}
export interface AdminHealth {
  runs_24h: number;
  success_24h: number;
  error_24h: number;
  success_rate: number;
  last_run: string | null;
  page_sync_enabled: boolean;
  timeline: HealthTimelinePoint[];
  recent: ScrapeLog[];
}
export interface ProviderCoverage {
  slug: string;
  name: string;
  is_active: boolean;
  capabilities: string[];
  matches: number;
  live: number;
  odds: number;
  sports: number;
}
export interface Freshness {
  live_oldest_secs: number | null;
  live_avg_secs: number | null;
  odds_last_update_secs: number | null;
  matches_last_update_secs: number | null;
  last_ingest: string | null;
}
export interface Business {
  total_customers: number;
  mrr_cents: number;
  by_plan: { plan: string; count: number }[];
  signups: { day: string; count: number }[];
  top_customers: { email: string; requests: number }[];
}
export interface OddPoint {
  market: string;
  outcome: string;
  value: string;
  param: string | null;
  recorded_at: string;
}

export interface ChangelogEntry {
  id: number;
  version: string | null;
  title: string;
  body: string;
  tag: string;
  published_at: string;
}
export interface Incident {
  id: number;
  title: string;
  severity: string;
  status: string;
  body: string;
  started_at: string;
  resolved_at: string | null;
}

export interface DashboardStats {
  total_sports: number;
  total_leagues: number;
  total_matches: number;
  live_matches: number;
  prematch_matches: number;
  total_odds: number;
  last_scrape: ScrapeLog | null;
  matches_by_sport: SportCount[];
  scrapes_last_24h: number;
}

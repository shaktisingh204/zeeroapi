/**
 * ZeroApi TypeScript SDK — thin typed client for the public sports-odds API.
 * Auth via X-API-Key, automatic retry with rate-limit-aware backoff.
 */

export interface ZeroApiOptions {
  apiKey: string;
  baseUrl?: string;
  /** Max retries on 429 / 5xx (default 3). */
  maxRetries?: number;
}

export interface MatchView {
  id: number;
  provider: string;
  sport_id: number;
  sport_name: string;
  league_id: number | null;
  league_name: string | null;
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
  updated_at: string;
}

export interface Odd {
  id: number;
  match_id: number;
  market: string;
  outcome: string;
  value: string;
  param: string | null;
  updated_at: string;
}

export interface MatchesParams {
  status?: "live" | "prematch" | "finished";
  sport_id?: number;
  league_id?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SidebarLeague {
  id: number;
  name: string;
  country: string | null;
  match_count: number;
}

export interface SidebarSport {
  id: number;
  name: string;
  slug: string;
  match_count: number;
  logo_url: string | null;
  leagues: SidebarLeague[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ZeroApi {
  private apiKey: string;
  private baseUrl: string;
  private maxRetries: number;

  constructor(opts: ZeroApiOptions) {
    if (!opts.apiKey) throw new Error("ZeroApi: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "http://localhost:8081/api/v1").replace(/\/$/, "");
    this.maxRetries = opts.maxRetries ?? 3;
  }

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { "X-API-Key": this.apiKey } });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < this.maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after")) || 0;
          await sleep(retryAfter * 1000 || 2 ** attempt * 250);
          continue;
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ZeroApiError(res.status, body?.error ?? res.statusText);
      }
      return res.json() as Promise<T>;
    }
  }

  providers() {
    return this.get<{ slug: string; name: string }[]>("/providers");
  }
  sports(provider: string) {
    return this.get<unknown[]>(`/${provider}/sports`);
  }
  leagues(provider: string, params?: { sport_id?: number }) {
    return this.get<unknown[]>(`/${provider}/leagues`, params);
  }
  /** Full "All Sports" sidebar tree: every sport with its nested leagues. */
  sidebar(provider: string) {
    return this.get<SidebarSport[]>(`/${provider}/sidebar`);
  }
  matches(provider: string, params?: MatchesParams) {
    return this.get<MatchView[]>(`/${provider}/matches`, params as Record<string, unknown>);
  }
  match(provider: string, id: number) {
    return this.get<MatchView & { odds: Odd[] }>(`/${provider}/matches/${id}`);
  }
  live(provider: string) {
    return this.get<MatchView[]>(`/${provider}/live`);
  }
  /** Finished matches with derived winners. */
  results(provider: string) {
    return this.get<MatchView[]>(`/${provider}/results`);
  }
  odds(provider: string, matchId: number) {
    return this.get<Odd[]>(`/${provider}/odds/${matchId}`);
  }
}

export class ZeroApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ZeroApiError";
  }
}

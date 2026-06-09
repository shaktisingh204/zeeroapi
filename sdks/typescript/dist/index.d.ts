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
export declare class ZeroApi {
    private apiKey;
    private baseUrl;
    private maxRetries;
    constructor(opts: ZeroApiOptions);
    private get;
    providers(): Promise<{
        slug: string;
        name: string;
    }[]>;
    sports(provider: string): Promise<unknown[]>;
    leagues(provider: string, params?: {
        sport_id?: number;
    }): Promise<unknown[]>;
    /** Full "All Sports" sidebar tree: every sport with its nested leagues. */
    sidebar(provider: string): Promise<SidebarSport[]>;
    matches(provider: string, params?: MatchesParams): Promise<MatchView[]>;
    match(provider: string, id: number): Promise<MatchView & {
        odds: Odd[];
    }>;
    live(provider: string): Promise<MatchView[]>;
    /** Finished matches with derived winners. */
    results(provider: string): Promise<MatchView[]>;
    odds(provider: string, matchId: number): Promise<Odd[]>;
}
export declare class ZeroApiError extends Error {
    status: number;
    constructor(status: number, message: string);
}

import type {
  AdminHealth,
  ApiKey,
  Business,
  Customer,
  CustomerUsage,
  DashboardStats,
  ChangelogEntry,
  Freshness,
  Image,
  Incident,
  LeagueView,
  MatchDetail,
  MatchView,
  Odd,
  OddPoint,
  Plan,
  Provider,
  ProviderCoverage,
  ScrapeLog,
  Setting,
  Sport,
  User,
} from "./types";
import { API_BASE, ADMIN_TOKEN_KEY } from "./config";

const BASE = API_BASE;
const TOKEN_KEY = ADMIN_TOKEN_KEY;

// Admin "active provider" — scopes the data views (matches/live/sports/leagues/stats).
// Empty string = all providers.
export const ADMIN_PROVIDER_KEY = "zeroapi_admin_provider";
export function getAdminProvider(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ADMIN_PROVIDER_KEY) || "";
}
export function setAdminProvider(p: string) {
  localStorage.setItem(ADMIN_PROVIDER_KEY, p);
}
function provQS(): string {
  const p = getAdminProvider();
  return p ? `?provider=${encodeURIComponent(p)}` : "";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Never serve stale list/stat responses — data (and the active provider
  // filter) is dynamic, so we must always hit the backend fresh.
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", ...options, headers });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new ApiError(401, "unauthorized");
  }

  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>("/auth/me"),

  // catalog (provider-scoped by the admin's active provider)
  sports: () => request<Sport[]>(`/sports${provQS()}`),
  toggleSport: (id: number) =>
    request<Sport>(`/sports/${id}/toggle`, { method: "PATCH" }),

  leagues: (params: Record<string, string | number | undefined> = {}) => {
    const p = getAdminProvider();
    const merged = p ? { provider: p, ...params } : params;
    const qs = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    const q = qs.toString();
    return request<LeagueView[]>(`/leagues${q ? `?${q}` : ""}`);
  },

  images: (kind?: string) => {
    const qs = new URLSearchParams();
    const p = getAdminProvider();
    if (kind) qs.set("kind", kind);
    if (p) qs.set("provider", p);
    const q = qs.toString();
    return request<Image[]>(`/images${q ? `?${q}` : ""}`);
  },

  matches: (params: Record<string, string | number | undefined> = {}) => {
    const p = getAdminProvider();
    const merged = p ? { provider: p, ...params } : params;
    const qs = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    const q = qs.toString();
    return request<MatchView[]>(`/matches${q ? `?${q}` : ""}`);
  },
  match: (id: number) => request<MatchDetail>(`/matches/${id}${provQS()}`),
  matchOdds: (id: number) => request<Odd[]>(`/matches/${id}/odds${provQS()}`),

  live: () => request<MatchView[]>(`/live${provQS()}`),

  // admin
  stats: () => request<DashboardStats>(`/admin/stats${provQS()}`),
  logs: (limit = 100) => request<ScrapeLog[]>(`/admin/logs?limit=${limit}`),
  triggerScrape: (job: "sports" | "prematch" | "live" | "full") =>
    request<{ job: string; matches: number; odds: number }>(`/admin/scrape/${job}`, {
      method: "POST",
    }),
  settings: () => request<Setting[]>("/admin/settings"),
  updateSetting: (key: string, value: string) =>
    request<Setting>(`/admin/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  // --- SaaS: providers / plans / customers / API keys ---
  providers: () => request<Provider[]>("/admin/providers"),
  toggleProvider: (slug: string) =>
    request<Provider>(`/admin/providers/${slug}/toggle`, { method: "PATCH" }),
  plans: () => request<Plan[]>("/admin/plans"),
  customers: () => request<Customer[]>("/admin/customers"),
  createCustomer: (email: string, name: string, plan_slug: string) =>
    request<Customer>("/admin/customers", {
      method: "POST",
      body: JSON.stringify({ email, name, plan_slug }),
    }),
  deleteCustomer: (id: string) =>
    request<{ deleted: string }>(`/admin/customers/${id}`, { method: "DELETE" }),
  customerKeys: (id: string) => request<ApiKey[]>(`/admin/customers/${id}/keys`),
  issueKey: (id: string, name: string) =>
    request<{ id: string; key: string; key_prefix: string; note: string }>(
      `/admin/customers/${id}/keys`,
      { method: "POST", body: JSON.stringify({ name }) }
    ),
  revokeKey: (id: string) =>
    request<{ revoked: string }>(`/admin/keys/${id}`, { method: "DELETE" }),
  customerUsage: (id: string) =>
    request<CustomerUsage>(`/admin/customers/${id}/usage`),

  // --- Analytics ---
  // health + freshness are scoped to the active provider; coverage stays
  // cross-provider (it's the per-provider comparison view).
  health: () => request<AdminHealth>(`/admin/health${provQS()}`),
  coverage: () => request<{ coverage: ProviderCoverage[] }>("/admin/coverage"),
  freshness: () => request<Freshness>(`/admin/freshness${provQS()}`),
  business: () => request<Business>("/admin/business"),
  oddsHistory: (matchId: number, market?: string, outcome?: string) => {
    const qs = new URLSearchParams();
    if (market) qs.set("market", market);
    if (outcome) qs.set("outcome", outcome);
    const q = qs.toString();
    return request<OddPoint[]>(`/odds/${matchId}/history${q ? `?${q}` : ""}`);
  },

  // --- Changelog + incidents ---
  changelogList: () => request<{ entries: ChangelogEntry[] }>("/changelog"),
  createChangelog: (body: { version?: string; title: string; body?: string; tag?: string }) =>
    request<{ id: number }>("/admin/changelog", { method: "POST", body: JSON.stringify(body) }),
  deleteChangelog: (id: number) =>
    request<{ deleted: number }>(`/admin/changelog/${id}`, { method: "DELETE" }),
  incidents: () => request<{ incidents: Incident[] }>("/admin/incidents"),
  createIncident: (body: { title: string; body?: string; severity?: string; status?: string }) =>
    request<{ id: number }>("/admin/incidents", { method: "POST", body: JSON.stringify(body) }),
  resolveIncident: (id: number) =>
    request<{ resolved: number }>(`/admin/incidents/${id}/resolve`, { method: "PATCH" }),

  users: () => request<User[]>("/admin/users"),
  createUser: (email: string, password: string, role: string) =>
    request<User>("/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, role }),
    }),
  deleteUser: (id: string) =>
    request<{ deleted: string }>(`/admin/users/${id}`, { method: "DELETE" }),
};

export { ApiError };

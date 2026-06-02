// Client for the ZeroApi self-serve customer portal (separate auth from admin).
import type { ApiKey, Customer, Plan, EndpointStat, StatusStat, LatencyPoint } from "./types";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://15.235.234.216:8081/api").replace(/\/$/, "");
const TOKEN_KEY = "zeroapi_customer_token";

export function getCustomerToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setCustomerToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearCustomerToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, options: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const token = getCustomerToken();
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/portal${path}`, { ...options, headers });
  if (res.status === 401 && auth) {
    clearCustomerToken();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/portal/login")) {
      window.location.href = "/portal/login";
    }
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    let msg = `request failed (${res.status})`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface AuthResponse {
  token: string;
  customer: Customer;
}
export interface MeResponse {
  customer: Customer;
  plan: Plan;
}
export interface UsageResponse {
  used_this_month: number;
  monthly_quota: number;
}
export interface UsagePoint {
  date: string;
  count: number;
}
export interface RequestLogEntry {
  t: number; // unix seconds
  m: string; // method
  p: string; // path
  provider?: string | null;
  endpoint?: string;
  status?: number;
  latency_ms?: number;
}

export interface CreateKeyOptions {
  allowed_providers?: string[];
  allowed_ips?: string[];
  expires_at?: string | null;
}

function qs(params: Record<string, string | number | undefined>): string {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "") s.set(k, String(v));
  });
  const out = s.toString();
  return out ? `?${out}` : "";
}

export const portal = {
  signup: (email: string, name: string, password: string) =>
    req<AuthResponse>("/signup", { method: "POST", body: JSON.stringify({ email, name, password }) }, false),
  login: (email: string, password: string) =>
    req<AuthResponse>("/login", { method: "POST", body: JSON.stringify({ email, password }) }, false),
  plans: () => req<Plan[]>("/plans", {}, false),
  me: () => req<MeResponse>("/me"),
  usage: () => req<UsageResponse>("/usage"),
  usageHistory: () => req<{ history: UsagePoint[] }>("/usage/history"),
  usageBreakdown: (days = 14) =>
    req<{ breakdown: EndpointStat[] }>(`/usage/breakdown${qs({ days })}`),
  usageStatus: (days = 14) => req<{ status: StatusStat[] }>(`/usage/status${qs({ days })}`),
  usageLatency: (days = 14) => req<{ latency: LatencyPoint[] }>(`/usage/latency${qs({ days })}`),
  requests: (params: { provider?: string; status_class?: number; limit?: number; offset?: number } = {}) =>
    req<{ requests: RequestLogEntry[] }>(`/requests${qs(params)}`),
  updateAccount: (body: { name?: string; password?: string; alert_threshold?: number }) =>
    req<Customer>("/account", { method: "PATCH", body: JSON.stringify(body) }),
  keys: () => req<ApiKey[]>("/keys"),
  createKey: (name: string, opts: CreateKeyOptions = {}) =>
    req<{ id: string; key: string; key_prefix: string; note: string }>("/keys", {
      method: "POST",
      body: JSON.stringify({ name, ...opts }),
    }),
  revokeKey: (id: string) => req<{ revoked: string }>(`/keys/${id}`, { method: "DELETE" }),
  changePlan: (plan_slug: string) =>
    req<Customer>("/plan", { method: "POST", body: JSON.stringify({ plan_slug }) }),
  // Billing (Stripe) — wired in Phase 4.
  billingSummary: () => req<BillingSummary>("/billing/summary"),
  checkout: (plan_slug: string) =>
    req<{ url: string }>("/billing/checkout", { method: "POST", body: JSON.stringify({ plan_slug }) }),
  billingPortal: () => req<{ url: string }>("/billing/portal-session", { method: "POST" }),
};

export interface BillingSummary {
  plan: Plan;
  subscription_status: string | null;
  used_this_month: number;
  monthly_quota: number;
  overage: number;
  estimated_cost_cents: number;
  has_payment_method: boolean;
}

// Where the public API + docs live (for quick-start snippets in the portal).
export const API_BASE = `${BASE}/v1`;
// The hand-built Next.js docs page (replaces the backend swagger-ui blob, which
// is still available at `${BASE}/v1/docs` if you want the raw OpenAPI explorer).
export const DOCS_URL = "/docs";

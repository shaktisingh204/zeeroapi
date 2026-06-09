// Public, unauthenticated data for the marketing landing + auth pages.
// Every fetch degrades gracefully to a fallback, so the page renders fully
// even when the backend is unreachable (e.g. during a static preview build).
import { API_BASE } from "./config";

export interface PublicProvider {
  slug: string;
  name: string;
  capabilities?: string[];
}

export interface PublicPlan {
  slug: string;
  name: string;
  price_cents: number;
  rate_limit_per_min: number;
  monthly_quota: number;
  features: string[];
  sort_order: number;
}

export interface LandingStats {
  providers: number;
  sports: number;
  live_matches: number;
  markets: number;
  top_sports: { name: string; matches: number }[];
}

export interface PublicStatus {
  overall: "operational" | "degraded" | "down" | string;
}

async function safe<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export const getProviders = () => safe<PublicProvider[]>("/providers", []);
export const getPublicPlans = () => safe<PublicPlan[]>("/portal/plans", []);
export const getLandingStats = () => safe<LandingStats | null>("/landing", null);
export const getStatus = () => safe<PublicStatus | null>("/status", null);

// 1000000 -> "1M", 10000 -> "10k", -1 -> "Unlimited"
export function formatQuota(n: number): string {
  if (n < 0) return "Unlimited requests";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M requests / mo`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k requests / mo`;
  return `${n} requests / mo`;
}

export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

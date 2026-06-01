// One dynamic provider source (was hardcoded in app/page.tsx, playground, logs,
// portal/page.tsx with inconsistent casing). Backed by the public /api/providers.
import { API_BASE } from "./config";

export interface ProviderOption {
  slug: string;
  name: string;
}

// Fallback used only if the API is unreachable (keeps pickers usable offline).
const FALLBACK: ProviderOption[] = [
  { slug: "melbet", name: "MelBet" },
  { slug: "1xbet", name: "1xBet" },
  { slug: "betwinner", name: "BetWinner" },
  { slug: "megapari", name: "MegaPari" },
  { slug: "1win", name: "1Win" },
  { slug: "diamondexch", name: "Diamond Exch" },
  { slug: "bcgame", name: "BC.Game" },
];

let cache: ProviderOption[] | null = null;

export async function getProviders(): Promise<ProviderOption[]> {
  if (cache) return cache;
  try {
    const res = await fetch(`${API_BASE}/providers`, { cache: "no-store" });
    if (res.ok) {
      const list = (await res.json()) as ProviderOption[];
      if (Array.isArray(list) && list.length) {
        cache = list;
        return list;
      }
    }
  } catch {
    /* fall through */
  }
  return FALLBACK;
}

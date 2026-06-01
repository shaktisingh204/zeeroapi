"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Database, Check } from "lucide-react";
import type { Provider } from "./types";

interface Ctx {
  provider: string; // active provider slug
  providers: Provider[];
  choose: (slug: string) => void;
}

export const AdminProviderContext = createContext<Ctx | null>(null);

export function useAdminProvider(): Ctx {
  const c = useContext(AdminProviderContext);
  if (!c) throw new Error("useAdminProvider used outside AdminProviderContext");
  return c;
}

/** Full-screen gate shown on first entry until a provider is chosen. */
export function ProviderGate({
  providers,
  choose,
}: {
  providers: Provider[];
  choose: (slug: string) => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0e14] px-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <div className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center">
            <Database size={18} className="text-black" />
          </div>
          <span className="font-semibold text-white text-lg">ZeroApi Console</span>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold text-white mb-1">Select a provider</h1>
          <p className="text-sm text-muted mb-5">
            Choose which data provider this console should show. You can switch any time from the
            sidebar.
          </p>
          {providers.length === 0 ? (
            <p className="text-sm text-muted">No active providers. Enable one in the database first.</p>
          ) : (
            <div className="space-y-2">
              {providers.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => choose(p.slug)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border hover:border-brand hover:bg-brand/5 transition-colors text-left"
                >
                  <span>
                    <span className="block text-white font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">{p.base_url}</span>
                  </span>
                  <span className="badge bg-brand/15 text-brand">select</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Lightweight, fixed overlay shown the instant a provider switch is requested.
 * Renders a top progress bar plus a bottom-right "Viewing <name>" toast so the
 * (layout-driven) hard reload feels intentional instead of jarring. The toast
 * auto-dismisses after ~2s — though in the reload case the page navigates away
 * first; the immediate paint is what matters for perceived smoothness.
 */
function SwitchOverlay({ name, onDone }: { name: string; onDone: () => void }) {
  // Drives the top progress bar from 0% -> ~90% via a CSS width transition.
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    // Kick the bar forward on the next frame so the transition animates.
    const raf = requestAnimationFrame(() => setProgress(90));
    const t = setTimeout(onDone, 2000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [onDone]);

  return (
    <>
      {/* Top progress bar */}
      <div className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden pointer-events-none">
        <div
          className="h-full bg-brand transition-[width] duration-[1800ms] ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      {/* Bottom-right toast */}
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[100] flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm text-white shadow-lg"
      >
        <span className="live-dot inline-block" />
        Viewing <span className="font-medium text-brand">{name}</span>
      </div>
    </>
  );
}

/** Compact provider switcher for the sidebar. */
export function ProviderSwitcher() {
  const { provider, providers, choose } = useAdminProvider();
  const [switching, setSwitching] = useState<string | null>(null);

  function handleChange(slug: string) {
    if (slug === provider) return;
    // Show the toast + progress bar immediately, before choose() may trigger a
    // full reload in the layout — so the transition reads as intentional.
    const next = providers.find((p) => p.slug === slug);
    setSwitching(next?.name ?? slug);
    choose(slug);
  }

  return (
    <div className="px-3 pt-3">
      <label className="block text-[11px] uppercase tracking-wide text-muted mb-1.5 px-1">
        Provider
      </label>
      <div className="relative">
        <select
          value={provider}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full appearance-none bg-surface-2 border border-border rounded-lg pl-3 pr-8 py-2 text-sm text-white focus:border-brand outline-none"
        >
          {providers.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <Check size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand pointer-events-none" />
      </div>
      {switching && <SwitchOverlay name={switching} onDone={() => setSwitching(null)} />}
    </div>
  );
}

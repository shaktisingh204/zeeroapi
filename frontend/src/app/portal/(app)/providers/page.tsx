"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Copy, Check, PlayCircle, ArrowUpRight, Database, Layers, Activity } from "lucide-react";
import { API_BASE, DOCS_URL } from "@/lib/portal";
import { getProviderProfiles, endpointsFor, isExchange, type ProviderProfile } from "@/lib/providerProfiles";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";

type Filter = "all" | "exchange" | "sportsbook";

export default function ProvidersPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderProfile[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    getProviderProfiles().then(setProviders);
  }, []);

  async function copyCurl(path: string) {
    const curl = `curl -H "X-API-Key: YOUR_KEY" "${API_BASE}/v1${path}"`;
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(path);
      setTimeout(() => setCopied((c) => (c === path ? null : c)), 1800);
    } catch {
      /* ignore */
    }
  }

  function tryInPlayground(slug: string, endpoint?: string) {
    localStorage.setItem("zeroapi_pg_provider", slug);
    if (endpoint) localStorage.setItem("zeroapi_pg_endpoint", endpoint);
    router.push("/portal/playground");
  }

  const shown = (providers ?? []).filter((p) => filter === "all" || p.kind === filter);
  const counts = {
    all: providers?.length ?? 0,
    exchange: providers?.filter((p) => p.kind === "exchange").length ?? 0,
    sportsbook: providers?.filter((p) => p.kind === "sportsbook").length ?? 0,
  };

  return (
    <div>
      <PageHeader
        title="Providers"
        subtitle="Every provider is different. Exchanges return back/lay/volume and suspend in-play; sportsbooks return a single price with market groups. Pick the one whose data you need."
        actions={
          <a className="btn-ghost" href={DOCS_URL} target="_blank" rel="noreferrer">
            API Reference <ArrowUpRight size={14} />
          </a>
        }
      />

      {/* Filter by provider type */}
      <div className="mb-5 inline-flex rounded-lg border border-border bg-surface-2/40 p-1">
        {(["all", "exchange", "sportsbook"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              filter === f ? "bg-brand text-black" : "text-muted hover:text-white"
            }`}
          >
            {f} <span className="tabular-nums opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {providers === null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <EmptyState icon={<Boxes size={20} />} title="No providers" message="Check back shortly." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((p) => {
            const hue = p.accent;
            const rows = endpointsFor(p);
            const exch = isExchange(p);
            return (
              <div
                key={p.slug}
                className="card flex flex-col p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-pop"
                style={{ borderTop: `2px solid ${hue}` }}
              >
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold"
                      style={{ background: hue + "22", color: hue }}
                    >
                      {p.name[0]?.toUpperCase()}
                    </span>
                    <div>
                      <p className="font-semibold text-white">{p.name}</p>
                      <code className="text-xs text-muted">/{p.slug}</code>
                    </div>
                  </div>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize"
                    style={{ background: hue + "22", color: hue }}
                  >
                    {p.kind}
                  </span>
                </div>

                <p className="mt-3 text-sm text-muted">{p.blurb}</p>

                {/* Data source */}
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-2">
                  <Database size={13} className="shrink-0" />
                  <span className="truncate">{p.dataSource}</span>
                </div>

                {/* Native markets + odd fields — what makes this provider different */}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                      <Layers size={12} /> Markets
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {p.markets.map((m) => (
                        <span key={m} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-gray-300">{m}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                      <Activity size={12} /> Odd fields
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {p.oddFields.map((f) => (
                        <span
                          key={f}
                          className="rounded px-1.5 py-0.5 font-mono text-[11px]"
                          style={{ background: hue + "1a", color: hue }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Capabilities */}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {p.capabilities.map((c) => (
                    <span key={c} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                      {c.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>

                {/* This provider's endpoints */}
                <div className="mt-4 divide-y divide-border-soft rounded-lg border border-border-soft bg-surface-2/30">
                  {rows.map((r) => (
                    <div key={r.path} className="flex items-center gap-2 px-3 py-2">
                      <span className="rounded bg-brand/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand">
                        {r.method}
                      </span>
                      <code className="min-w-0 flex-1 truncate font-mono text-xs text-gray-300" title={r.desc}>
                        /v1{r.path}
                      </code>
                      <button
                        onClick={() => copyCurl(r.path)}
                        className="shrink-0 text-muted-2 transition-colors hover:text-white active:scale-95"
                        aria-label="Copy as curl"
                      >
                        {copied === r.path ? <Check size={14} className="text-brand" /> : <Copy size={14} />}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => tryInPlayground(p.slug, exch ? "headermatches" : "live")}
                    className="btn-primary flex-1 justify-center"
                  >
                    <PlayCircle size={15} /> Try in Playground
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

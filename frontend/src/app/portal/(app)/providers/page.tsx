"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Copy, Check, PlayCircle, ArrowUpRight } from "lucide-react";
import { API_BASE, DOCS_URL } from "@/lib/portal";
import { getProviders, type PublicProvider } from "@/lib/landing";
import { PageHeader, Spinner, EmptyState, Badge } from "@/components/ui";

const DEFAULT_CAPS = ["sports", "leagues", "matches", "live", "odds"];

// Capability -> the example endpoints it unlocks for a provider.
function endpointsFor(slug: string, caps: string[]): { method: string; path: string }[] {
  const has = (c: string) => caps.includes(c);
  const rows: { method: string; path: string }[] = [];
  if (has("sports")) rows.push({ method: "GET", path: `/${slug}/sports` });
  if (has("leagues")) rows.push({ method: "GET", path: `/${slug}/leagues` });
  if (has("matches")) rows.push({ method: "GET", path: `/${slug}/matches` });
  if (has("live")) rows.push({ method: "GET", path: `/${slug}/live` });
  if (has("matches")) rows.push({ method: "GET", path: `/${slug}/matches/{id}` });
  if (has("odds")) rows.push({ method: "GET", path: `/${slug}/odds/{match_id}` });
  return rows;
}

const HUES = ["#34d27b", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#14b8a6", "#ec4899", "#6366f1"];

export default function ProvidersPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<PublicProvider[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    getProviders().then((rows) => setProviders(rows));
  }, []);

  async function copyCurl(path: string) {
    const curl = `curl -H "X-API-Key: YOUR_KEY" "${API_BASE}${path}"`;
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

  return (
    <div>
      <PageHeader
        title="Providers"
        subtitle="Every provider speaks the same JSON schema. Pick one and switch with a single path segment."
        actions={
          <a className="btn-ghost" href={DOCS_URL} target="_blank" rel="noreferrer">
            API Reference <ArrowUpRight size={14} />
          </a>
        }
      />

      {providers === null ? (
        <Spinner />
      ) : providers.length === 0 ? (
        <EmptyState icon={<Boxes size={20} />} title="No providers available" message="Check back shortly." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {providers.map((p, i) => {
            const caps = p.capabilities?.length ? p.capabilities : DEFAULT_CAPS;
            const hue = HUES[i % HUES.length];
            const rows = endpointsFor(p.slug, caps);
            return (
              <div
                key={p.slug}
                className="card flex flex-col p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-pop"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold"
                      style={{ background: hue + "22", color: hue }}
                    >
                      {p.name[0]}
                    </span>
                    <div>
                      <p className="font-semibold text-white">{p.name}</p>
                      <code className="text-xs text-muted">/{p.slug}</code>
                    </div>
                  </div>
                  <Badge variant="success" dot>
                    active
                  </Badge>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {caps.map((c) => (
                    <span
                      key={c}
                      className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted"
                    >
                      {c.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>

                <div className="mt-4 divide-y divide-border-soft rounded-lg border border-border-soft bg-surface-2/30">
                  {rows.map((r) => (
                    <div key={r.path} className="flex items-center gap-2 px-3 py-2">
                      <span className="rounded bg-brand/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand">
                        {r.method}
                      </span>
                      <code className="min-w-0 flex-1 truncate font-mono text-xs text-gray-300">{r.path}</code>
                      <button
                        onClick={() => copyCurl(r.path)}
                        className="shrink-0 text-muted-2 transition-colors hover:text-white"
                        aria-label="Copy as curl"
                      >
                        {copied === r.path ? <Check size={14} className="text-brand" /> : <Copy size={14} />}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  <button onClick={() => tryInPlayground(p.slug, "live")} className="btn-primary flex-1 justify-center">
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Copy, Check, Rocket, PlayCircle } from "lucide-react";
import { portal, API_BASE, DOCS_URL } from "@/lib/portal";
import type { ApiKey, Plan } from "@/lib/types";
import type { MeResponse, UsageResponse } from "@/lib/portal";
import { getProviders, type ProviderOption } from "@/lib/providers";
import { PageHeader, StatCard, Spinner, EmptyState } from "@/components/ui";

interface IssuedKey {
  id: string;
  key: string;
  key_prefix: string;
  note: string;
}

export default function PortalDashboard() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [keyName, setKeyName] = useState("");
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [changing, setChanging] = useState(false);

  // Key scoping (advanced)
  const [showScope, setShowScope] = useState(false);
  const [keyProviders, setKeyProviders] = useState<string[]>([]);
  const [keyIps, setKeyIps] = useState("");
  const [keyExpiry, setKeyExpiry] = useState("");
  const [providerOpts, setProviderOpts] = useState<ProviderOption[]>([]);

  useEffect(() => {
    getProviders().then(setProviderOpts);
  }, []);

  function load() {
    setLoading(true);
    Promise.all([portal.me(), portal.usage(), portal.keys(), portal.plans()])
      .then(([m, u, k, p]) => {
        setMe(m);
        setUsage(u);
        setKeys(k);
        setPlans(p);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function createKey() {
    setError("");
    try {
      const ips = keyIps
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await portal.createKey(keyName, {
        allowed_providers: keyProviders.length ? keyProviders : undefined,
        allowed_ips: ips.length ? ips : undefined,
        expires_at: keyExpiry ? new Date(keyExpiry).toISOString() : undefined,
      });
      setIssued(res);
      setKeyName("");
      setKeyProviders([]);
      setKeyIps("");
      setKeyExpiry("");
      setShowScope(false);
      setCopied(false);
      const k = await portal.keys();
      setKeys(k);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  function toggleProvider(slug: string) {
    setKeyProviders((prev) =>
      prev.includes(slug) ? prev.filter((p) => p !== slug) : [...prev, slug]
    );
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key?")) return;
    setError("");
    try {
      await portal.revokeKey(id);
      const k = await portal.keys();
      setKeys(k);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function copyKey() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("copy failed");
    }
  }

  async function changePlan(slug: string) {
    if (changing) return;
    setError("");
    setChanging(true);
    try {
      await portal.changePlan(slug);
      const m = await portal.me();
      setMe(m);
      const u = await portal.usage();
      setUsage(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setChanging(false);
    }
  }

  function testNow() {
    if (!issued) return;
    // Prefill the Playground with this key, then jump there.
    localStorage.setItem("zeroapi_pg_key", issued.key);
    router.push("/portal/playground");
  }

  if (loading || !me) return <Spinner />;

  const plan = me.plan;
  const quotaLabel =
    usage && usage.monthly_quota > 0 ? usage.monthly_quota.toLocaleString() : "∞";
  const usedLabel = usage ? usage.used_this_month.toLocaleString() : "0";

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Your ZeroApi access"
        actions={
          <a className="btn-ghost" href={DOCS_URL} target="_blank">
            API Docs ↗
          </a>
        }
      />

      {error && (
        <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2 mb-4">{error}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <StatCard label="Current plan" value={plan.name} />
        <StatCard label="Rate limit" value={`${plan.rate_limit_per_min}/min`} />
        <StatCard label="This month" value={`${usedLabel} / ${quotaLabel}`} />
      </div>

      {/* First-run guide */}
      {keys.length === 0 && !issued && (
        <div className="card p-5 mb-6 border-brand/30">
          <div className="flex items-center gap-2 mb-4">
            <Rocket size={18} className="text-brand" />
            <h2 className="text-lg font-semibold text-white">Get started in 3 steps</h2>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3">
            <li className="rounded-lg bg-surface-2/50 p-4">
              <span className="badge bg-brand/15 text-brand mb-2">1</span>
              <p className="text-sm text-white font-medium">Create an API key</p>
              <p className="text-xs text-muted mt-1">Use the form below — you can scope it to a provider.</p>
            </li>
            <li className="rounded-lg bg-surface-2/50 p-4">
              <span className="badge bg-brand/15 text-brand mb-2">2</span>
              <p className="text-sm text-white font-medium">Make your first call</p>
              <p className="text-xs text-muted mt-1">Hit “Test now” to open the Playground with your key prefilled.</p>
            </li>
            <li className="rounded-lg bg-surface-2/50 p-4">
              <span className="badge bg-brand/15 text-brand mb-2">3</span>
              <p className="text-sm text-white font-medium">Build with an SDK</p>
              <p className="text-xs text-muted mt-1">Grab a typed client from the SDKs tab or read the docs.</p>
            </li>
          </ol>
        </div>
      )}

      {/* API keys */}
      <div className="card p-5 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">API keys</h2>

        <div className="flex flex-wrap items-end gap-2 mb-2">
          <div className="flex-1 min-w-[160px]">
            <label className="text-sm text-muted">Key name</label>
            <input
              className="input mt-1"
              type="text"
              value={keyName}
              placeholder="e.g. production"
              onChange={(e) => setKeyName(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowScope((s) => !s)}
            className="btn-ghost"
          >
            {showScope ? "Hide scoping" : "Scope key"}
          </button>
          <button onClick={createKey} className="btn-primary">
            <KeyRound size={15} /> Create new key
          </button>
        </div>

        {showScope && (
          <div className="rounded-lg border border-border bg-surface-2/40 p-4 mb-4 space-y-4">
            <div>
              <label className="text-sm text-muted">Allowed providers</label>
              <p className="text-xs text-muted/70 mb-2">Leave empty to allow all providers.</p>
              <div className="flex flex-wrap gap-2">
                {providerOpts.map((p) => (
                  <button
                    key={p.slug}
                    type="button"
                    onClick={() => toggleProvider(p.slug)}
                    className={`badge cursor-pointer ${
                      keyProviders.includes(p.slug)
                        ? "bg-brand/20 text-brand"
                        : "bg-surface-2 text-muted"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm text-muted">Allowed IPs</label>
                <input
                  className="input mt-1"
                  type="text"
                  value={keyIps}
                  placeholder="comma-separated, optional"
                  onChange={(e) => setKeyIps(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted">Expires</label>
                <input
                  className="input mt-1"
                  type="date"
                  value={keyExpiry}
                  onChange={(e) => setKeyExpiry(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {keys.length === 0 ? (
          <EmptyState message="No API keys." />
        ) : (
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className="th">Key</th>
                <th className="th">Name</th>
                <th className="th">Scope</th>
                <th className="th">Created</th>
                <th className="th">Last used</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keys.map((k) => (
                <tr
                  key={k.id}
                  className={k.revoked ? "line-through text-muted opacity-60" : ""}
                >
                  <td className="td">
                    <code className="text-white">{k.key_prefix}…</code>
                  </td>
                  <td className="td">{k.name ?? "—"}</td>
                  <td className="td">
                    {!k.allowed_providers && !k.allowed_ips && !k.expires_at ? (
                      <span className="text-muted">full</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {k.allowed_providers?.map((p) => (
                          <span key={p} className="badge bg-blue-500/15 text-blue-400">{p}</span>
                        ))}
                        {k.allowed_ips && (
                          <span className="badge bg-purple-500/15 text-purple-400">IP-locked</span>
                        )}
                        {k.expires_at && (
                          <span className="badge bg-surface-2 text-muted">
                            exp {new Date(k.expires_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="td text-muted">
                    {new Date(k.created_at).toLocaleDateString()}
                  </td>
                  <td className="td text-muted">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                  </td>
                  <td className="td text-right">
                    {!k.revoked && (
                      <button onClick={() => revoke(k.id)} className="btn-ghost">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick start */}
      <div className="card p-5 mb-6">
        <h2 className="text-lg font-semibold text-white mb-1">Quick start</h2>
        <p className="text-sm text-muted mb-4">
          Authenticate with the <code className="text-white">X-API-Key</code> header. Endpoints are
          provider-based (<code className="text-white">/{`{provider}`}/...</code>).
        </p>
        <pre className="bg-[#0b0e14] border border-border rounded-lg p-4 overflow-x-auto text-sm text-gray-300">
{`curl -H "X-API-Key: YOUR_KEY" "${API_BASE}/melbet/live"`}
        </pre>
      </div>

      {/* Plan / upgrade */}
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-white mb-1">Plan</h2>
        <p className="text-sm text-muted mb-4">
          Change your plan at any time. (No real billing — this is a demo.)
        </p>
        {plans.length === 0 ? (
          <EmptyState message="No plans available." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => {
              const current = p.slug === plan.slug;
              return (
                <div
                  key={p.slug}
                  className={`rounded-lg border p-4 flex flex-col ${
                    current ? "border-brand" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-white">{p.name}</p>
                    {current && <span className="badge bg-brand/15 text-brand">Current</span>}
                  </div>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    ${(p.price_cents / 100).toFixed(0)}
                    <span className="text-sm font-normal text-muted">/mo</span>
                  </p>
                  <ul className="mt-3 space-y-1 text-sm text-muted flex-1">
                    <li>{p.rate_limit_per_min}/min rate limit</li>
                    <li>
                      {p.monthly_quota > 0 ? p.monthly_quota.toLocaleString() : "Unlimited"} req/mo
                    </li>
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <button
                    onClick={() => changePlan(p.slug)}
                    disabled={current || changing}
                    className="btn-primary w-full mt-4 justify-center disabled:opacity-50"
                  >
                    {current ? "Current plan" : "Switch"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New-key modal: shown once on creation; full key is never retrievable again */}
      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg card p-6">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound size={18} className="text-brand" />
              <h2 className="text-lg font-semibold text-white">Your new API key</h2>
            </div>
            <p className="text-sm text-muted mb-4">
              Copy it now — for security it <strong className="text-white">won&apos;t be shown again</strong>.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 break-all rounded-lg bg-[#0b0e14] border border-border px-3 py-2 text-sm text-white">
                {issued.key}
              </code>
              <button onClick={copyKey} className="btn-ghost shrink-0">
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button onClick={() => setIssued(null)} className="btn-ghost">
                {copied ? "Done" : "I've copied it"}
              </button>
              <button onClick={testNow} className="btn-primary">
                <PlayCircle size={15} /> Test now in Playground
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

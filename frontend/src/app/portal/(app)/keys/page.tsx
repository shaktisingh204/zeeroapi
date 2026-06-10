"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Copy, Check, PlayCircle, ShieldCheck, Trash2, Plus, X } from "lucide-react";
import { portal } from "@/lib/portal";
import type { ApiKey } from "@/lib/types";
import { getProviders, type ProviderOption } from "@/lib/providers";
import { PageHeader, SectionCard, Spinner, EmptyState, Badge } from "@/components/ui";

interface IssuedKey {
  id: string;
  key: string;
  key_prefix: string;
  note: string;
}

export default function ApiKeysPage() {
  const router = useRouter();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Scoping
  const [keyProviders, setKeyProviders] = useState<string[]>([]);
  const [keyIps, setKeyIps] = useState("");
  const [keyExpiry, setKeyExpiry] = useState("");
  const [providerOpts, setProviderOpts] = useState<ProviderOption[]>([]);

  useEffect(() => {
    getProviders().then(setProviderOpts);
  }, []);

  function load() {
    setLoading(true);
    portal
      .keys()
      .then(setKeys)
      .catch((err) => setError(err instanceof Error ? err.message : "failed"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function resetForm() {
    setKeyName("");
    setKeyProviders([]);
    setKeyIps("");
    setKeyExpiry("");
    setCreating(false);
  }

  async function createKey() {
    if (!keyName.trim() || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const ips = keyIps.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      const res = await portal.createKey(keyName.trim(), {
        allowed_providers: keyProviders.length ? keyProviders : undefined,
        allowed_ips: ips.length ? ips : undefined,
        expires_at: keyExpiry ? new Date(keyExpiry).toISOString() : undefined,
      });
      setIssued(res);
      setCopied(false);
      resetForm();
      setKeys(await portal.keys());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleProvider(slug: string) {
    setKeyProviders((prev) =>
      prev.includes(slug) ? prev.filter((p) => p !== slug) : [...prev, slug]
    );
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Apps using it will stop working immediately.")) return;
    setError("");
    try {
      await portal.revokeKey(id);
      setKeys(await portal.keys());
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

  function testNow() {
    if (!issued) return;
    localStorage.setItem("zeroapi_pg_key", issued.key);
    router.push("/portal/playground");
  }

  const active = keys.filter((k) => !k.revoked);

  return (
    <div>
      <PageHeader
        title="API Keys"
        subtitle="Create and manage keys. Authenticate with the X-API-Key header."
        actions={
          !creating && (
            <button onClick={() => setCreating(true)} className="btn-primary">
              <Plus size={15} /> Create key
            </button>
          )
        }
      />

      {error && (
        <div className="mb-4 rounded-lg bg-live/15 px-3 py-2 text-sm text-live">{error}</div>
      )}

      {/* Create form (inline, expandable) */}
      {creating && (
        <div className="card mb-6 animate-fade-up border-brand/30 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-ink">
              <KeyRound size={17} className="text-brand" /> New API key
            </h2>
            <button onClick={resetForm} className="text-muted transition-colors hover:text-ink" aria-label="Cancel">
              <X size={18} />
            </button>
          </div>

          <label className="text-sm text-muted">Key name</label>
          <input
            className="input mt-1"
            type="text"
            value={keyName}
            placeholder="e.g. production-server"
            autoFocus
            onChange={(e) => setKeyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createKey()}
          />

          <div className="mt-5 space-y-4 rounded-lg border border-border bg-surface-2/40 p-4">
            <div>
              <label className="text-sm text-muted">Allowed providers</label>
              <p className="mb-2 text-xs text-muted-2">Leave empty to allow every provider.</p>
              <div className="flex flex-wrap gap-2">
                {providerOpts.map((p) => {
                  const on = keyProviders.includes(p.slug);
                  return (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => toggleProvider(p.slug)}
                      className={`badge cursor-pointer transition-colors active:scale-[0.97] ${
                        on ? "bg-brand/20 text-brand" : "bg-surface-2 text-muted hover:text-ink"
                      }`}
                    >
                      {on && <Check size={12} className="mr-1" />}
                      {p.name}
                    </button>
                  );
                })}
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

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={resetForm} className="btn-ghost">Cancel</button>
            <button onClick={createKey} disabled={!keyName.trim() || submitting} className="btn-primary">
              {submitting ? "Creating…" : "Create key"}
            </button>
          </div>
        </div>
      )}

      {/* Key list */}
      <SectionCard title={`Your keys${active.length ? ` (${active.length})` : ""}`}>
        {loading ? (
          <Spinner />
        ) : keys.length === 0 ? (
          <EmptyState
            icon={<KeyRound size={20} />}
            title="No API keys yet"
            message="Create your first key to start calling the API. You can scope it to a single provider."
            action={
              !creating && (
                <button onClick={() => setCreating(true)} className="btn-primary">
                  <Plus size={15} /> Create key
                </button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
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
                  <tr key={k.id} className={k.revoked ? "opacity-50" : "transition-colors hover:bg-surface-2/40"}>
                    <td className="td">
                      <code className={k.revoked ? "text-muted line-through" : "text-ink"}>
                        {k.key_prefix}…
                      </code>
                    </td>
                    <td className="td">{k.name ?? "untitled"}</td>
                    <td className="td">
                      {!k.allowed_providers && !k.allowed_ips && !k.expires_at ? (
                        <Badge variant="neutral">full access</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {k.allowed_providers?.map((p) => (
                            <Badge key={p} variant="info">{p}</Badge>
                          ))}
                          {k.allowed_ips && <Badge variant="purple">IP-locked</Badge>}
                          {k.expires_at && (
                            <Badge variant="neutral">exp {new Date(k.expires_at).toLocaleDateString()}</Badge>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="td text-muted">{new Date(k.created_at).toLocaleDateString()}</td>
                    <td className="td text-muted">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                    </td>
                    <td className="td text-right">
                      {k.revoked ? (
                        <span className="text-xs text-muted-2">revoked</span>
                      ) : (
                        <button
                          onClick={() => revoke(k.id)}
                          className="btn-ghost text-live hover:border-live/40"
                        >
                          <Trash2 size={14} /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Security note */}
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-border-soft bg-surface/60 p-4 text-sm text-muted">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand" />
        <p>
          Keys are shown in full only once, at creation. Store them in a secret manager, never in
          client-side code or git. Revoke and rotate anything that may have leaked.
        </p>
      </div>

      {/* New-key modal */}
      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg animate-fade-up p-6">
            <div className="mb-1 flex items-center gap-2">
              <KeyRound size={18} className="text-brand" />
              <h2 className="text-lg font-semibold text-ink">Your new API key</h2>
            </div>
            <p className="mb-4 text-sm text-muted">
              Copy it now. For security it{" "}
              <strong className="text-ink">won&apos;t be shown again</strong>.
            </p>
            <div className="mb-4 flex items-center gap-2">
              <code className="codeblock flex-1 break-all px-3 py-2 text-sm text-gray-100">
                {issued.key}
              </code>
              <button onClick={copyKey} className="btn-ghost shrink-0">
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/portal";
import {
  getProviderProfiles,
  endpointsFor,
  type ProviderProfile,
  type ApiEndpoint,
} from "@/lib/providerProfiles";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";

const KEY_STORAGE = "zeroapi_pg_key";
const SAMPLE_ID = "884213";

interface Result {
  line: string;
  status: number;
  ok: boolean;
  ms: number;
  rateRemaining: string | null;
  rateLimit: string | null;
  body: unknown;
}

const needsId = (path: string) => path.includes("{id}") || path.includes("{match_id}");

function buildPath(path: string, matchId: string): string {
  // Substitute the entered id; if empty keep the placeholder so the user sees
  // what is still required.
  const value = matchId.trim();
  return path
    .replace("{match_id}", value || "{match_id}")
    .replace("{id}", value || "{id}");
}

export default function PlaygroundPage() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [provider, setProvider] = useState("melbet");
  const [endpoint, setEndpoint] = useState("live");
  const [matchId, setMatchId] = useState(SAMPLE_ID);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(KEY_STORAGE);
    if (saved) setApiKey(saved);

    // Deep-link from the Providers page: preselect provider/endpoint once.
    const pv = localStorage.getItem("zeroapi_pg_provider");
    const ep = localStorage.getItem("zeroapi_pg_endpoint");

    getProviderProfiles().then((list) => {
      setProviders(list);
      if (!list.length) return;

      // Resolve the provider: deep-link, else keep melbet if present, else first.
      let chosen = list.find((x) => x.slug === pv);
      if (!chosen) chosen = list.find((x) => x.slug === "melbet") ?? list[0];
      setProvider(chosen.slug);

      // Clamp the endpoint to one this provider supports.
      const eps = endpointsFor(chosen);
      const wanted = ep && eps.some((e) => e.id === ep) ? ep : null;
      if (wanted) setEndpoint(wanted);
      else if (!eps.some((e) => e.id === endpoint)) setEndpoint(eps[0]?.id ?? "");

      if (pv) localStorage.removeItem("zeroapi_pg_provider");
      if (ep) localStorage.removeItem("zeroapi_pg_endpoint");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.slug === provider) ?? null,
    [providers, provider],
  );

  const providerEndpoints: ApiEndpoint[] = useMemo(
    () => (selectedProvider ? endpointsFor(selectedProvider) : []),
    [selectedProvider],
  );

  const selectedEndpoint: ApiEndpoint | null = useMemo(
    () => providerEndpoints.find((e) => e.id === endpoint) ?? null,
    [providerEndpoints, endpoint],
  );

  function onProviderChange(slug: string) {
    setProvider(slug);
    localStorage.setItem("zeroapi_pg_provider", slug);
    // Clamp the selected endpoint to one the new provider supports.
    const next = providers.find((p) => p.slug === slug);
    if (next) {
      const eps = endpointsFor(next);
      if (!eps.some((e) => e.id === endpoint)) {
        const fallback = eps[0]?.id ?? "";
        setEndpoint(fallback);
        localStorage.setItem("zeroapi_pg_endpoint", fallback);
      }
    }
  }

  function onEndpointChange(id: string) {
    setEndpoint(id);
    localStorage.setItem("zeroapi_pg_endpoint", id);
  }

  function onKeyChange(v: string) {
    setApiKey(v);
    localStorage.setItem(KEY_STORAGE, v);
  }

  const rawPath = selectedEndpoint?.path ?? "";
  const showIdInput = needsId(rawPath);
  const path = buildPath(rawPath, matchId);
  const requestLine = `GET ${path}`;
  const curl = `curl -H "X-API-Key: ${apiKey || "<your-key>"}" ${API_BASE}${path}`;

  async function send() {
    if (!selectedEndpoint) return;
    const url = `${API_BASE}${path}`;
    const started = performance.now();
    setLoading(true);
    try {
      const res = await fetch(url, {
        headers: { "X-API-Key": apiKey },
      });
      const ms = Math.round(performance.now() - started);
      let body: unknown;
      const text = await res.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      setResult({
        line: requestLine,
        status: res.status,
        ok: res.ok,
        ms,
        rateRemaining: res.headers.get("x-ratelimit-remaining"),
        rateLimit: res.headers.get("x-ratelimit-limit"),
        body,
      });
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      setResult({
        line: requestLine,
        status: 0,
        ok: false,
        ms,
        rateRemaining: null,
        rateLimit: null,
        body: { error: err instanceof Error ? err.message : "Network request failed" },
      });
    } finally {
      setLoading(false);
    }
  }

  // Disable Send while a required id is still a placeholder.
  const missingId = showIdInput && !matchId.trim();

  return (
    <div>
      <PageHeader title="Playground" subtitle="Try the API with your key" />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="card p-5">
        <div className="grid gap-4">
          <div>
            <label className="block text-sm text-white mb-1.5">API key</label>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1 font-mono"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => onKeyChange(e.target.value)}
                placeholder="zk_..."
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className="badge bg-surface-2 text-muted shrink-0"
                onClick={() => setShowKey((s) => !s)}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <p className="text-xs text-muted mt-1.5">
              Paste a key created on the Overview tab. Keys are shown once.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-white mb-1.5">Provider</label>
              <select
                className="input w-full"
                value={provider}
                onChange={(e) => onProviderChange(e.target.value)}
              >
                {providers.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
              {selectedProvider && (
                <div className="mt-1.5 flex flex-col gap-1">
                  <span
                    className={`badge w-fit ${
                      selectedProvider.kind === "exchange"
                        ? "bg-brand/15 text-brand"
                        : "bg-surface-2 text-muted"
                    }`}
                  >
                    {selectedProvider.kind}
                  </span>
                  <p className="text-xs text-muted">{selectedProvider.dataSource}</p>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm text-white mb-1.5">Endpoint</label>
              <select
                className="input w-full"
                value={endpoint}
                onChange={(e) => onEndpointChange(e.target.value)}
                disabled={!providerEndpoints.length}
              >
                {providerEndpoints.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.path} — {e.desc}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showIdInput && (
            <div>
              <label className="block text-sm text-white mb-1.5">Match id</label>
              <input
                className="input w-full font-mono"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
                placeholder={SAMPLE_ID}
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-xs text-muted mt-1.5">
                Substituted into the path. Try a sample like {SAMPLE_ID}.
              </p>
            </div>
          )}

          <div>
            <button
              className="btn-primary"
              onClick={send}
              disabled={loading || !apiKey || !selectedEndpoint || missingId}
            >
              {loading ? "Sending..." : "Send"}
            </button>
          </div>

          {selectedEndpoint && (
            <div>
              <label className="block text-sm text-white mb-1.5">curl</label>
              <pre className="bg-[#0b0e14] border border-border rounded-lg p-3 text-xs overflow-x-auto">
                <code className="text-gray-300">{curl}</code>
              </pre>
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner />
        ) : result ? (
          <div>
            <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
              <span className="font-mono text-sm text-brand">{result.line}</span>
              <span
                className={`badge ${
                  result.ok ? "bg-brand/15 text-brand" : "bg-live/15 text-live"
                }`}
              >
                {result.status === 0 ? "ERR" : result.status}
              </span>
              <span className="text-sm text-muted tabular-nums">{result.ms} ms</span>
              {result.rateRemaining !== null && (
                <span className="text-sm text-muted tabular-nums">
                  rate {result.rateRemaining}
                  {result.rateLimit !== null ? ` / ${result.rateLimit}` : ""}
                </span>
              )}
            </div>
            <pre className="bg-[#0b0e14] border border-border rounded-lg p-4 text-sm overflow-x-auto max-h-[420px] m-4">
              <code className="text-gray-300">
                {JSON.stringify(result.body, null, 2)}
              </code>
            </pre>
          </div>
        ) : (
          <EmptyState message="Send a request to see the response." />
        )}
      </div>
      </div>
    </div>
  );
}

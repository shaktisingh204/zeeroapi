"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/portal";
import { getProviders, type ProviderOption } from "@/lib/providers";
import { PageHeader, Spinner } from "@/components/ui";

const KEY_STORAGE = "zeroapi_pg_key";

const ENDPOINTS = ["live", "results", "sports", "leagues", "matches", "providers"];

interface Result {
  line: string;
  status: number;
  ok: boolean;
  ms: number;
  rateRemaining: string | null;
  rateLimit: string | null;
  body: unknown;
}

export default function PlaygroundPage() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [provider, setProvider] = useState("melbet");
  const [endpoint, setEndpoint] = useState("live");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(KEY_STORAGE);
    if (saved) setApiKey(saved);
    getProviders().then((p) => {
      setProviders(p);
      if (p.length && !p.some((x) => x.slug === "melbet")) setProvider(p[0].slug);
    });
  }, []);

  function onKeyChange(v: string) {
    setApiKey(v);
    localStorage.setItem(KEY_STORAGE, v);
  }

  const path = endpoint === "providers" ? "/providers" : `/${provider}/${endpoint}`;
  const requestLine = `GET ${path}`;

  async function send() {
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

  return (
    <div>
      <PageHeader title="Playground" subtitle="Try the API with your key" />

      <div className="card p-5 mb-6">
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
                onChange={(e) => setProvider(e.target.value)}
                disabled={endpoint === "providers"}
              >
                {providers.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-white mb-1.5">Endpoint</label>
              <select
                className="input w-full"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              >
                {ENDPOINTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <button
              className="btn-primary"
              onClick={send}
              disabled={loading || !apiKey}
            >
              {loading ? "Sending..." : "Send"}
            </button>
          </div>
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
          <div className="py-16 text-center text-muted text-sm">
            Send a request to see the response
          </div>
        )}
      </div>
    </div>
  );
}

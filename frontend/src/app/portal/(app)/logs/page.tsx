"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { portal } from "@/lib/portal";
import type { RequestLogEntry } from "@/lib/portal";
import { getProviders, type ProviderOption } from "@/lib/providers";
import { PageHeader, EmptyState, DataTable, Badge, type Column } from "@/components/ui";

const STATUS_FILTERS: { label: string; value?: number }[] = [
  { label: "All", value: undefined },
  { label: "2xx", value: 2 },
  { label: "4xx", value: 4 },
  { label: "5xx", value: 5 },
];
const PAGE = 50;

function statusColor(code?: number): string {
  if (!code) return "text-muted";
  if (code < 300) return "text-brand";
  if (code < 500) return "text-warn";
  return "text-live";
}

export default function LogsPage() {
  const [requests, setRequests] = useState<RequestLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("");
  const [statusClass, setStatusClass] = useState<number | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [providers, setProviders] = useState<ProviderOption[]>([]);

  useEffect(() => {
    getProviders().then(setProviders);
  }, []);

  const load = useCallback(() => {
    portal
      .requests({ provider: provider || undefined, status_class: statusClass, limit: PAGE, offset })
      .then((r) => setRequests(r.requests))
      .finally(() => setLoading(false));
  }, [provider, statusClass, offset]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  // Reset paging when filters change.
  useEffect(() => setOffset(0), [provider, statusClass]);

  const columns: Column<RequestLogEntry>[] = [
    {
      key: "m",
      header: "Method",
      render: (r) => <Badge variant="neutral">{r.m}</Badge>,
    },
    {
      key: "p",
      header: "Path",
      className: "text-brand font-mono",
      render: (r) => r.p,
    },
    {
      key: "status",
      header: "Status",
      className: "font-mono",
      render: (r) => <span className={statusColor(r.status)}>{r.status ?? "-"}</span>,
    },
    {
      key: "latency_ms",
      header: "Latency",
      className: "text-muted",
      render: (r) => (r.latency_ms != null ? `${r.latency_ms} ms` : "-"),
    },
    {
      key: "t",
      header: "When",
      className: "text-muted",
      render: (r) => new Date(r.t * 1000).toLocaleString(),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Request logs"
        subtitle="Every call made with your API keys: provider, status and latency"
        actions={
          <button className="btn-ghost" onClick={load}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-ink"
        >
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.label}
              onClick={() => setStatusClass(s.value)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                statusClass === s.value ? "bg-brand text-brand-contrast font-medium" : "text-muted hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <DataTable<RequestLogEntry>
          columns={columns}
          rows={requests}
          rowKey={(r) => `${r.t}-${r.m}-${r.p}-${r.status ?? ""}`}
          loading={loading}
          empty={
            <EmptyState message="No requests match. Make a call from the Playground or with your key." />
          }
        />
      </div>

      {!loading && requests.length > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-muted">
            Showing {offset + 1}-{offset + requests.length}
          </span>
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              Previous
            </button>
            <button
              className="btn-ghost"
              disabled={requests.length < PAGE}
              onClick={() => setOffset(offset + PAGE)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

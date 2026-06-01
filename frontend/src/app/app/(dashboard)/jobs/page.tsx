"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Globe, Activity } from "lucide-react";
import { api } from "@/lib/api";
import type { ScrapeLog } from "@/lib/types";
import {
  PageHeader,
  EmptyState,
  StatusBadge,
  DataTable,
  type Column,
} from "@/components/ui";

export default function JobsPage() {
  const [logs, setLogs] = useState<ScrapeLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(() => {
    api.logs(80).then(setLogs).finally(() => setLoading(false));
  }, []);

  const columns: Column<ScrapeLog>[] = [
    {
      key: "job",
      header: "Source",
      className: "text-white",
      render: (l) => l.job,
    },
    {
      key: "status",
      header: "Status",
      render: (l) => <StatusBadge status={l.status} />,
    },
    {
      key: "items",
      header: "Matches",
      className: "tabular-nums",
      render: (l) => l.items,
    },
    {
      key: "message",
      header: "Detail",
      className: "text-muted max-w-[280px] truncate",
      render: (l) => l.message,
    },
    {
      key: "started_at",
      header: "When",
      className: "text-muted",
      render: (l) => new Date(l.started_at).toLocaleString(),
    },
  ];

  useEffect(() => {
    loadLogs();
    const t = setInterval(loadLogs, 10000);
    return () => clearInterval(t);
  }, [loadLogs]);

  return (
    <div>
      <PageHeader
        title="Scrape Activity"
        subtitle="All data is synced by the page scraper (scraper-py/realtime.py)"
        actions={
          <button onClick={loadLogs} className="btn-ghost">
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />

      <div className="card p-5 mb-6 flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-brand/15 text-brand flex items-center justify-center shrink-0">
          <Globe size={20} />
        </div>
        <div className="text-sm text-gray-300">
          <p className="text-white font-medium">Page scraping is the only engine.</p>
          <p className="text-muted mt-1">
            A real browser renders melbet&apos;s pages and streams matches, markets
            (with real names) and team logos in real time. Start the background
            sync with{" "}
            <code className="text-brand">python scraper-py/realtime.py --interval 1</code>.
            Each ingest pass is logged below.
          </p>
        </div>
      </div>

      <h2 className="font-semibold text-white mb-3">Recent sync passes</h2>
      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          rows={logs}
          rowKey={(l) => l.id}
          loading={loading}
          empty={
            <EmptyState
              icon={<Activity size={20} />}
              title="No sync activity yet"
              message="Start the page scraper to begin ingesting matches. Each pass will appear here."
            />
          }
        />
      </div>
    </div>
  );
}

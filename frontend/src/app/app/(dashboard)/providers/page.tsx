"use client";

import { useEffect, useState } from "react";
import { ServerOff } from "lucide-react";
import { api } from "@/lib/api";
import type { Provider } from "@/lib/types";
import { PageHeader, EmptyState, DataTable, type Column } from "@/components/ui";

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.providers().then(setProviders).finally(() => setLoading(false));
  }, []);

  async function toggle(slug: string) {
    const updated = await api.toggleProvider(slug);
    setProviders((prev) => prev.map((p) => (p.slug === slug ? updated : p)));
  }

  const columns: Column<Provider>[] = [
    {
      key: "name",
      header: "Name",
      className: "text-white",
      render: (p) => p.name,
    },
    {
      key: "slug",
      header: "Slug",
      className: "text-muted",
      render: (p) => p.slug,
    },
    {
      key: "base_url",
      header: "Base URL",
      render: (p) => (
        <a
          href={p.base_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted hover:text-white underline underline-offset-2"
        >
          {p.base_url}
        </a>
      ),
    },
    {
      key: "active",
      header: "Active",
      render: (p) => (
        <button
          onClick={() => toggle(p.slug)}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            p.is_active ? "bg-brand" : "bg-surface-2"
          }`}
          aria-label="toggle active"
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              p.is_active ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Providers"
        subtitle="Bookmaker sources scraped into the platform"
      />
      <p className="text-sm text-muted mb-4">
        Only <span className="text-white">melbet</span> is active by default; the
        others (1xbet, betwinner, …) are wired and ship disabled.
      </p>
      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          rows={providers}
          rowKey={(p) => p.slug}
          loading={loading}
          empty={
            <EmptyState
              icon={<ServerOff size={20} />}
              title="No providers"
              message="No providers configured yet."
            />
          }
        />
      </div>
    </div>
  );
}

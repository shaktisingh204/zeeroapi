"use client";

import { useEffect, useState } from "react";
import { Dumbbell } from "lucide-react";
import { api } from "@/lib/api";
import type { Sport } from "@/lib/types";
import {
  PageHeader,
  EmptyState,
  DataTable,
  type Column,
} from "@/components/ui";

export default function SportsPage() {
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.sports().then(setSports).finally(() => setLoading(false));
  }, []);

  async function toggle(id: number) {
    const updated = await api.toggleSport(id);
    setSports((prev) => prev.map((s) => (s.id === id ? updated : s)));
  }

  const columns: Column<Sport>[] = [
    {
      key: "id",
      header: "ID",
      className: "text-muted tabular-nums",
      render: (s) => s.id,
    },
    {
      key: "name",
      header: "Name",
      className: "text-white",
      render: (s) => s.name,
    },
    {
      key: "match_count",
      header: "Matches",
      className: "tabular-nums",
      render: (s) => s.match_count,
    },
    {
      key: "active",
      header: "Active",
      render: (s) => (
        <button
          onClick={() => toggle(s.id)}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            s.is_active ? "bg-brand" : "bg-surface-2"
          }`}
          aria-label="toggle active"
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              s.is_active ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sports"
        subtitle="Catalog scraped from the provider. Toggle to include/exclude from feeds."
      />
      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          rows={sports}
          rowKey={(s) => s.id}
          loading={loading}
          empty={
            <EmptyState
              icon={<Dumbbell size={20} />}
              title="No sports yet"
              message="Run the 'sports' scrape job to populate the catalog."
            />
          }
        />
      </div>
    </div>
  );
}

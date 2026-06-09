"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { API_BASE as BASE } from "@/lib/config";

interface Entry {
  id: number;
  version: string | null;
  title: string;
  body: string;
  tag: string;
  published_at: string;
}

const TAG_COLOR: Record<string, string> = {
  feature: "bg-emerald-500/15 text-emerald-400",
  fix: "bg-blue-500/15 text-blue-400",
  improvement: "bg-purple-500/15 text-purple-400",
  breaking: "bg-red-500/15 text-red-400",
  deprecation: "bg-yellow-500/15 text-yellow-400",
};

// Tags that deserve a louder, ring-bordered treatment.
const PROMINENT: Record<string, string> = {
  breaking: "border border-red-500/40 ring-1 ring-red-500/20 uppercase tracking-wide font-semibold",
  deprecation: "border border-yellow-500/40 ring-1 ring-yellow-500/20 uppercase tracking-wide font-semibold",
};

const DOT_COLOR: Record<string, string> = {
  feature: "bg-emerald-400",
  fix: "bg-blue-400",
  improvement: "bg-purple-400",
  breaking: "bg-red-500",
  deprecation: "bg-yellow-400",
};

function monthKey(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function ChangelogPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(`${BASE}/changelog`)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            (e.body ?? "").toLowerCase().includes(q)
        )
      : entries;

    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      const key = monthKey(e.published_at);
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return Array.from(map.entries());
  }, [entries, query]);

  const hasResults = groups.length > 0;

  return (
    <div className="min-h-screen bg-[#0b0e14] text-white">
      <div className="max-w-[760px] mx-auto px-6 py-16">
        <div className="flex items-center justify-between mb-8">
          <Link href="/" className="font-semibold text-lg">
            ZeroApi <span className="text-muted font-normal">Changelog</span>
          </Link>
          <Link href="/status" className="text-sm text-muted hover:text-white transition-colors">
            Status →
          </Link>
        </div>

        <div className="mb-10">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search changelog…"
            className="input max-w-sm"
            aria-label="Search changelog"
          />
        </div>

        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-muted">No changelog entries yet.</p>
        ) : !hasResults ? (
          <p className="text-muted">
            No entries match “{query}”.
          </p>
        ) : (
          <div className="space-y-12">
            {groups.map(([month, monthEntries]) => (
              <section key={month}>
                <h2 className="text-xs uppercase tracking-[0.18em] text-muted mb-5">{month}</h2>
                <div className="relative border-l border-border pl-6 space-y-10">
                  {monthEntries.map((e) => (
                    <div key={e.id} className="relative">
                      <span
                        className={`absolute -left-[31px] top-1.5 h-3 w-3 rounded-full ring-4 ring-[#0b0e14] ${DOT_COLOR[e.tag] ?? "bg-brand"}`}
                      />
                      <div className="flex flex-wrap items-center gap-3 mb-1">
                        <span
                          className={`badge ${TAG_COLOR[e.tag] ?? "bg-surface-2 text-muted"} ${PROMINENT[e.tag] ?? ""}`}
                        >
                          {e.tag}
                        </span>
                        {e.version && (
                          <span className="text-sm font-mono text-muted">{e.version}</span>
                        )}
                        <span className="text-xs text-muted">
                          {new Date(e.published_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold">{e.title}</h3>
                      {e.body && (
                        <p className="text-sm text-muted mt-1 whitespace-pre-line">{e.body}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { api } from "@/lib/api";
import type { Image } from "@/lib/types";
import { PageHeader, EmptyState } from "@/components/ui";

type Kind = "all" | "sport" | "league" | "team";

const KINDS: Kind[] = ["all", "sport", "league", "team"];

const KIND_BADGE: Record<Image["kind"], string> = {
  sport: "bg-brand/15 text-brand",
  league: "bg-blue-500/15 text-blue-400",
  team: "bg-purple-500/15 text-purple-400",
};

export default function ImagesPage() {
  const [images, setImages] = useState<Image[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    api
      .images(kind === "all" ? undefined : kind)
      .then(setImages)
      .finally(() => setLoading(false));
  }, [kind]);

  const filtered = images.filter((img) =>
    search.trim()
      ? (img.name ?? "").toLowerCase().includes(search.trim().toLowerCase())
      : true
  );

  return (
    <div>
      <PageHeader
        title="Images"
        subtitle="Scraped team / league / sport logos"
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-1">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3 py-2 rounded-lg text-sm capitalize transition-colors ${
                kind === k ? "bg-brand/15 text-brand" : "btn-ghost"
              }`}
            >
              {k === "all" ? "All" : k}
            </button>
          ))}
        </div>
        <input
          className="input flex-1 min-w-[200px] max-w-xs"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-muted tabular-nums">
          {filtered.length} {filtered.length === 1 ? "image" : "images"}
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card p-3 flex flex-col gap-2">
              <div className="h-16 w-full rounded-md bg-surface-2 animate-pulse" />
              <div className="h-4 w-3/4 rounded bg-surface-2 animate-pulse" />
              <div className="flex items-center justify-between">
                <div className="h-5 w-14 rounded-full bg-surface-2 animate-pulse" />
                <div className="h-3 w-8 rounded bg-surface-2 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ImageOff size={20} />}
            title="No images yet"
            message="No scraped logos match your filters. Run the page scraper to collect team, league and sport logos."
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
          {filtered.map((img) => (
            <div key={img.url} className="card p-3 flex flex-col gap-2">
              <div className="h-16 flex items-center justify-center">
                {broken.has(img.url) ? (
                  <div className="h-16 w-full rounded-md bg-surface-2 flex items-center justify-center text-xs text-muted capitalize">
                    {img.kind}
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.url}
                    alt={img.name ?? img.kind}
                    className="h-16 w-full object-contain"
                    onError={() =>
                      setBroken((prev) => {
                        const next = new Set(prev);
                        next.add(img.url);
                        return next;
                      })
                    }
                  />
                )}
              </div>
              <p className="text-sm text-white truncate" title={img.name ?? ""}>
                {img.name ?? "—"}
              </p>
              <div className="flex items-center justify-between">
                <span className={`badge capitalize ${KIND_BADGE[img.kind]}`}>
                  {img.kind}
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {img.seen_count}×
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api } from "@/lib/api";
import type { Setting } from "@/lib/types";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";

const LABELS: Record<string, string> = {
  page_sync_enabled: "Background sync — auto-runs the page scraper (on/off)",
  page_sync_interval: "Page scraper refresh interval (seconds)",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        setDraft(Object.fromEntries(s.map((x) => [x.key, x.value])));
      })
      .finally(() => setLoading(false));
  }, []);

  async function save(key: string, value?: string) {
    const val = value ?? draft[key];
    setSaving(key);
    setToast(null);
    try {
      const updated = await api.updateSetting(key, val);
      setSettings((prev) => prev.map((s) => (s.key === key ? updated : s)));
      setDraft((d) => ({ ...d, [key]: val }));
      setToast(`Saved "${key}" = ${val}`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "failed");
    } finally {
      setSaving(null);
    }
  }

  const isBool = (v: string) => v === "true" || v === "false";

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Runtime configuration applied without restarting the backend"
      />
      {toast && <div className="card px-4 py-3 mb-4 text-sm text-white">{toast}</div>}

      <div className="card divide-y divide-border">
        {settings.length === 0 ? (
          <EmptyState message="No settings found." />
        ) : (
          settings.map((s) =>
            isBool(s.value) ? (
              // Boolean settings render as an on/off toggle that saves instantly.
              <div key={s.key} className="p-5 flex items-center justify-between gap-3">
                <div>
                  <label className="text-sm text-white font-medium">{s.key}</label>
                  <p className="text-xs text-muted mt-0.5">{LABELS[s.key] ?? "—"}</p>
                </div>
                <button
                  onClick={() => save(s.key, s.value === "true" ? "false" : "true")}
                  disabled={saving === s.key}
                  aria-label="toggle"
                  className={`relative h-7 w-12 rounded-full transition-colors shrink-0 ${
                    s.value === "true" ? "bg-brand" : "bg-surface-2"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${
                      s.value === "true" ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            ) : (
              <div key={s.key} className="p-5 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[260px]">
                  <label className="text-sm text-white font-medium">{s.key}</label>
                  <p className="text-xs text-muted mb-2">{LABELS[s.key] ?? "—"}</p>
                  <input
                    className="input"
                    value={draft[s.key] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [s.key]: e.target.value }))
                    }
                  />
                </div>
                <button
                  onClick={() => save(s.key)}
                  disabled={saving === s.key || draft[s.key] === s.value}
                  className="btn-primary"
                >
                  <Save size={15} /> {saving === s.key ? "Saving…" : "Save"}
                </button>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}

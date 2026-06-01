"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, CheckCircle2, FileText, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { ChangelogEntry, Incident } from "@/lib/types";
import { PageHeader, Spinner, EmptyState, Badge, type BadgeVariant } from "@/components/ui";

const TAGS = ["feature", "fix", "improvement", "breaking", "deprecation"];
const SEVERITIES = ["minor", "major", "critical"];

const SEVERITY_VARIANT: Record<string, BadgeVariant> = {
  minor: "info",
  major: "warning",
  critical: "danger",
};

export default function AdminChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // changelog form
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [body, setBody] = useState("");
  const [tag, setTag] = useState("improvement");

  // incident form
  const [incTitle, setIncTitle] = useState("");
  const [incBody, setIncBody] = useState("");
  const [severity, setSeverity] = useState("minor");

  function load() {
    setLoading(true);
    Promise.all([api.changelogList(), api.incidents()])
      .then(([c, i]) => {
        setEntries(c.entries);
        setIncidents(i.incidents);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "failed"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function addEntry() {
    if (!title.trim()) return;
    setError("");
    try {
      await api.createChangelog({ title, version: version || undefined, body, tag });
      setTitle(""); setVersion(""); setBody(""); setTag("improvement");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    }
  }

  async function addIncident() {
    if (!incTitle.trim()) return;
    setError("");
    try {
      await api.createIncident({ title: incTitle, body: incBody, severity });
      setIncTitle(""); setIncBody(""); setSeverity("minor");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    }
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Changelog & Status" subtitle="Publish release notes and manage status-page incidents" />
      {error && <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2 mb-4">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Changelog */}
        <div className="card p-5">
          <h2 className="font-semibold text-white mb-4">New changelog entry</h2>
          <div className="space-y-3">
            <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="flex gap-3">
              <input className="input flex-1" placeholder="Version (optional)" value={version} onChange={(e) => setVersion(e.target.value)} />
              <select className="input" value={tag} onChange={(e) => setTag(e.target.value)}>
                {TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <textarea className="input min-h-[80px]" placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} />
            <button className="btn-primary" onClick={addEntry}><Plus size={15} /> Publish</button>
          </div>

          <div className="mt-6 space-y-2 max-h-[360px] overflow-y-auto">
            {entries.length === 0 ? (
              <EmptyState icon={<FileText size={20} />} title="No entries" message="No changelog entries published yet." />
            ) : entries.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 border-b border-border pb-2">
                <div>
                  <p className="text-sm text-white">{e.title} {e.version && <span className="text-muted font-mono">{e.version}</span>}</p>
                  <Badge variant="neutral">{e.tag}</Badge>
                </div>
                <button onClick={() => api.deleteChangelog(e.id).then(load)} className="text-muted hover:text-live">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Incidents */}
        <div className="card p-5">
          <h2 className="font-semibold text-white mb-4">Report incident</h2>
          <div className="space-y-3">
            <input className="input" placeholder="Title" value={incTitle} onChange={(e) => setIncTitle(e.target.value)} />
            <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <textarea className="input min-h-[80px]" placeholder="Details" value={incBody} onChange={(e) => setIncBody(e.target.value)} />
            <button className="btn-primary" onClick={addIncident}><Plus size={15} /> Report</button>
          </div>

          <div className="mt-6 space-y-2 max-h-[360px] overflow-y-auto">
            {incidents.length === 0 ? (
              <EmptyState icon={<ShieldAlert size={20} />} title="No incidents" message="No incidents reported. All systems operational." />
            ) : incidents.map((i) => (
              <div key={i.id} className="flex items-start justify-between gap-3 border-b border-border pb-2">
                <div className="min-w-0">
                  <p className="text-sm text-white">{i.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant={SEVERITY_VARIANT[i.severity] ?? "neutral"}>{i.severity}</Badge>
                    <span className="text-xs text-muted">{i.status}</span>
                  </div>
                </div>
                {!i.resolved_at && (
                  <button onClick={() => api.resolveIncident(i.id).then(load)} className="text-muted hover:text-brand" title="Resolve">
                    <CheckCircle2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

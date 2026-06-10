"use client";

// Per-provider documentation page: unique copy, markets, endpoint set and
// sample payloads per provider, driven by lib/docsContent.ts.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Database,
  Layers,
  Lightbulb,
  Timer,
  Zap,
} from "lucide-react";
import { API_V1 } from "@/lib/config";
import { PROVIDER_DOCS, getProviderDoc } from "@/lib/docsContent";
import { CodeBlock, DocsHeader, MethodBadge, RequestTabs } from "../ui";

function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
        let best = "";
        let bestRatio = 0;
        seen.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = id;
          }
        });
        if (best) setActive(best);
      },
      { rootMargin: "-72px 0px -65% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return active;
}

export default function ProviderDocPage({ slug }: { slug: string }) {
  const doc = getProviderDoc(slug)!;
  const idx = PROVIDER_DOCS.findIndex((d) => d.slug === slug);
  const prev = PROVIDER_DOCS[(idx - 1 + PROVIDER_DOCS.length) % PROVIDER_DOCS.length];
  const next = PROVIDER_DOCS[(idx + 1) % PROVIDER_DOCS.length];

  const sectionIds = useMemo(
    () => ["overview", "quickstart", ...doc.endpoints.map((e) => `ep-${e.id}`), "odds-shape", "notes"],
    [doc]
  );
  const activeId = useScrollSpy(sectionIds);

  const exchange = doc.kind === "exchange";

  return (
    <div style={{ colorScheme: "light" }} className="min-h-screen bg-[#fbfcff] font-sans text-slate-700 antialiased">
      <DocsHeader crumb={doc.name} />

      <div className="mx-auto flex max-w-[1280px] gap-10 px-5">
        {/* ---------------- Sidebar ---------------- */}
        <aside className="hidden w-60 shrink-0 lg:block">
          <nav className="sticky top-16 max-h-[calc(100dvh-4rem)] space-y-6 overflow-y-auto py-10 pr-2">
            <Link
              href="/docs"
              className="flex items-center gap-1.5 px-3 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              <ArrowLeft size={14} /> All docs
            </Link>

            <div>
              <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                On this page
              </p>
              <div className="space-y-0.5">
                {[
                  { id: "overview", label: "Overview" },
                  { id: "quickstart", label: "Quickstart" },
                ].map((i) => (
                  <a
                    key={i.id}
                    href={`#${i.id}`}
                    className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      activeId === i.id
                        ? "bg-emerald-50 font-semibold text-emerald-700"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {i.label}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Endpoints
              </p>
              <div className="space-y-0.5">
                {doc.endpoints.map((e) => (
                  <a
                    key={e.id}
                    href={`#ep-${e.id}`}
                    className={`block rounded-lg px-3 py-1.5 font-mono text-[12.5px] transition-colors ${
                      activeId === `ep-${e.id}`
                        ? "bg-emerald-50 font-semibold text-emerald-700"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {e.path.replace(`/${doc.slug}`, "") || "/"}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Reference
              </p>
              <div className="space-y-0.5">
                {[
                  { id: "odds-shape", label: "Odds shape" },
                  { id: "notes", label: "Good to know" },
                ].map((i) => (
                  <a
                    key={i.id}
                    href={`#${i.id}`}
                    className={`block rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      activeId === i.id
                        ? "bg-emerald-50 font-semibold text-emerald-700"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {i.label}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Providers
              </p>
              <div className="space-y-0.5">
                {PROVIDER_DOCS.map((p) => (
                  <Link
                    key={p.slug}
                    href={`/docs/${p.slug}`}
                    className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      p.slug === slug
                        ? "bg-slate-100 font-semibold text-slate-900"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.accent }} />
                    {p.name}
                  </Link>
                ))}
              </div>
            </div>
          </nav>
        </aside>

        {/* ---------------- Content ---------------- */}
        <main className="min-w-0 flex-1 space-y-16 py-10">
          {/* Overview */}
          <section id="overview" className="scroll-mt-24">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-white"
                style={{ background: doc.accent }}
              >
                {doc.name}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  exchange ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-600"
                }`}
              >
                {doc.kind}
              </span>
              <code className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[12px] text-slate-600">
                /v1/{doc.slug}/…
              </code>
            </div>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
              {doc.name} API
            </h1>
            <p className="mt-3 max-w-[60ch] text-lg leading-relaxed text-slate-600">{doc.tagline}</p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <Database size={17} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Data source</p>
                  <p className="mt-0.5 text-sm text-slate-500">{doc.dataSource}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <Timer size={17} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Freshness</p>
                  <p className="mt-0.5 text-sm text-slate-500">{doc.cadence}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 max-w-[66ch] space-y-4">
              {doc.about.map((p, i) => (
                <p key={i} className="leading-relaxed text-slate-600">{p}</p>
              ))}
            </div>

            <div className="mt-6">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Native markets</p>
              <div className="flex flex-wrap gap-1.5">
                {doc.markets.map((m) => (
                  <span
                    key={m}
                    className="rounded-md px-2.5 py-1 font-mono text-[12px] font-medium"
                    style={{ background: doc.accent + "14", color: doc.accent }}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Quickstart */}
          <section id="quickstart" className="scroll-mt-24 border-t border-slate-200 pt-12">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Zap size={20} />
              </span>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Quickstart</h2>
            </div>
            <p className="mb-4 max-w-[62ch] text-slate-600">
              Authenticate with the{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-emerald-700">X-API-Key</code>{" "}
              header. {exchange
                ? "Start with the matches list, then pull a match's odds from /matchdetails — that is where the back/lay prices live."
                : "This call returns everything currently in play on " + doc.name + "."}
            </p>
            <RequestTabs path={exchange ? `/${doc.slug}/matches?status=live` : `/${doc.slug}/live`} />
            <p className="mt-3 text-sm text-slate-500">
              Base URL{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12.5px] text-slate-700">{API_V1}</code>
              {" "}· all endpoints are GET and return JSON.
            </p>
          </section>

          {/* Endpoints */}
          <section className="scroll-mt-24 border-t border-slate-200 pt-12">
            <div className="mb-2 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                <Layers size={20} />
              </span>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Endpoints</h2>
            </div>
            <p className="max-w-[62ch] text-slate-600">
              {exchange
                ? `${doc.name} exposes exactly ${doc.endpoints.length} endpoints. There is no separate odds endpoint — prices arrive inside /matchdetails together with the suspension state.`
                : `${doc.name} exposes ${doc.endpoints.length} endpoints. Sample responses below use real shapes from this provider's feed.`}
            </p>
          </section>

          <div className="space-y-12">
            {doc.endpoints.map((ep) => (
              <section key={ep.id} id={`ep-${ep.id}`} className="scroll-mt-32">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <MethodBadge />
                  <code className="font-mono text-[15px] font-semibold text-slate-900">{ep.display}</code>
                </div>
                <p className="mb-4 max-w-[64ch] text-slate-600">{ep.summary}</p>

                {ep.params.length > 0 && (
                  <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-left">
                          <th className="px-4 py-2.5 font-semibold text-slate-600">Parameter</th>
                          <th className="px-4 py-2.5 font-semibold text-slate-600">In</th>
                          <th className="px-4 py-2.5 font-semibold text-slate-600">Required</th>
                          <th className="px-4 py-2.5 font-semibold text-slate-600">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ep.params.map((p) => (
                          <tr key={p.name}>
                            <td className="px-4 py-2.5 font-mono text-[12.5px] font-semibold text-emerald-700">{p.name}</td>
                            <td className="px-4 py-2.5 text-slate-500">{p.loc}</td>
                            <td className="px-4 py-2.5 text-slate-500">{p.required ? "yes" : "no"}</td>
                            <td className="px-4 py-2.5 text-slate-600">{p.desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="min-w-0">
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Request</p>
                    <RequestTabs path={ep.example} />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Example response</p>
                    <CodeBlock code={ep.response} label="json" />
                  </div>
                </div>
              </section>
            ))}
          </div>

          {/* Odds shape */}
          <section id="odds-shape" className="scroll-mt-24 border-t border-slate-200 pt-12">
            <h2 className="mb-3 text-2xl font-bold tracking-tight text-slate-900">
              The {exchange ? "exchange" : doc.name} odds shape
            </h2>
            <p className="mb-5 max-w-[62ch] text-slate-600">
              {exchange
                ? "Every runner quotes a back price, a lay price and matched volume, plus a live suspension flag. This is the field set your renderer must handle:"
                : `${doc.name} quotes a single decimal price per outcome. Lines (totals, handicaps) repeat the market with a different param:`}
            </p>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {doc.oddFields.map((f) => (
                    <tr key={f.name}>
                      <td className="w-40 px-5 py-2.5 align-top font-mono text-[12.5px] font-semibold text-slate-900">{f.name}</td>
                      <td className="w-40 px-2 py-2.5 align-top font-mono text-[12px] text-slate-400">{f.type}</td>
                      <td className="px-5 py-2.5 text-slate-600">{f.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Good to know */}
          <section id="notes" className="scroll-mt-24 border-t border-slate-200 pt-12 pb-16">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                <Lightbulb size={20} />
              </span>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Good to know</h2>
            </div>
            <ul className="max-w-[70ch] space-y-3">
              {doc.quirks.map((q, i) => (
                <li key={i} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: doc.accent }}
                  />
                  <span className="text-sm leading-relaxed text-slate-600">{q}</span>
                </li>
              ))}
            </ul>

            {/* Prev / next pager */}
            <div className="mt-12 grid gap-3 sm:grid-cols-2">
              <Link
                href={`/docs/${prev.slug}`}
                className="group rounded-2xl border border-slate-200 bg-white p-4 transition-all duration-150 hover:border-slate-300 hover:shadow-sm"
              >
                <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <ArrowLeft size={13} /> Previous
                </p>
                <p className="mt-1 font-semibold text-slate-900 group-hover:text-emerald-700">{prev.name}</p>
              </Link>
              <Link
                href={`/docs/${next.slug}`}
                className="group rounded-2xl border border-slate-200 bg-white p-4 text-right transition-all duration-150 hover:border-slate-300 hover:shadow-sm"
              >
                <p className="flex items-center justify-end gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Next <ArrowRight size={13} />
                </p>
                <p className="mt-1 font-semibold text-slate-900 group-hover:text-emerald-700">{next.name}</p>
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-sky-50 p-6">
              <div>
                <p className="text-lg font-bold text-slate-900">Try {doc.name} now</p>
                <p className="text-sm text-slate-600">Create a free key and call it from the in-browser playground.</p>
              </div>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(16,185,129,0.7)] transition-all duration-150 hover:bg-emerald-600 active:scale-[0.97]"
              >
                Get API key <ChevronRight size={16} />
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

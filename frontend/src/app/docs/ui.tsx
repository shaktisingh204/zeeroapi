"use client";

// Shared building blocks for the /docs pages (overview + per-provider).
import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Check, Copy } from "lucide-react";
import { API_V1 } from "@/lib/config";

export function CopyButton({ text, light = false }: { text: string; light?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150 active:scale-[0.92] ${
        light
          ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          : "text-slate-400 hover:bg-white/10 hover:text-white"
      }`}
      aria-label="Copy to clipboard"
    >
      {done ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-500">{label ?? "shell"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 text-[13px] leading-relaxed">
        <code className="font-mono text-slate-200 whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

const LANGS = ["curl", "javascript", "python"] as const;
type Lang = (typeof LANGS)[number];
const LANG_LABEL: Record<Lang, string> = { curl: "cURL", javascript: "JavaScript", python: "Python" };

export function RequestTabs({ path }: { path: string }) {
  const [lang, setLang] = useState<Lang>("curl");
  const url = `${API_V1}${path}`;
  const snippets: Record<Lang, string> = {
    curl: `curl -H "X-API-Key: $ZEROAPI_KEY" \\\n  "${url}"`,
    javascript: `const res = await fetch("${url}", {\n  headers: { "X-API-Key": process.env.ZEROAPI_KEY },\n});\nconst data = await res.json();`,
    python: `import os, httpx\n\nr = httpx.get(\n    "${url}",\n    headers={"X-API-Key": os.environ["ZEROAPI_KEY"]},\n)\ndata = r.json()`,
  };
  return (
    <div>
      <div className="mb-2 flex gap-1.5">
        {LANGS.map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all duration-150 active:scale-[0.97] ${
              lang === l
                ? "bg-slate-900 text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {LANG_LABEL[l]}
          </button>
        ))}
      </div>
      <CodeBlock code={snippets[lang]} label={LANG_LABEL[lang]} />
    </div>
  );
}

export function MethodBadge() {
  return (
    <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold tracking-wide text-emerald-600">
      GET
    </span>
  );
}

export function DocsHeader({ crumb }: { crumb?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 shadow-[0_6px_16px_-6px_rgba(16,185,129,0.8)]">
              <Activity size={18} className="text-white" />
            </span>
            <span className="text-[17px] font-bold tracking-tight text-slate-900">ZeroApi</span>
          </Link>
          <Link href="/docs" className="hidden text-sm font-medium text-slate-400 transition-colors hover:text-slate-900 sm:inline">
            API Reference
          </Link>
          {crumb && (
            <>
              <span className="hidden text-slate-300 sm:inline">/</span>
              <span className="hidden text-sm font-semibold text-slate-700 sm:inline">{crumb}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-5 text-sm font-medium">
          <Link href="/status" className="hidden text-slate-500 transition-colors hover:text-slate-900 sm:inline">Status</Link>
          <Link href="/changelog" className="hidden text-slate-500 transition-colors hover:text-slate-900 sm:inline">Changelog</Link>
          <a
            href={`${API_V1}/docs`}
            target="_blank"
            rel="noreferrer"
            className="hidden text-slate-500 transition-colors hover:text-slate-900 md:inline"
          >
            OpenAPI
          </a>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(16,185,129,0.7)] transition-all duration-150 hover:bg-emerald-600 active:scale-[0.97]"
          >
            Get API key <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </header>
  );
}

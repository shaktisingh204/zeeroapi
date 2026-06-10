"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { API_BASE, DOCS_URL } from "@/lib/portal";
import { PageHeader } from "@/components/ui";

type Lang = "curl" | "javascript" | "python" | "go";
const LANGS: { id: Lang; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
];

const SNIPPETS: Record<Lang, string> = {
  curl: `# Live matches for a provider
curl "${API_BASE}/melbet/live" \\
  -H "X-API-Key: $ZEROAPI_KEY"`,
  javascript: `import { ZeroApi } from "@zeroapi/sdk";

const client = new ZeroApi({ apiKey: process.env.ZEROAPI_KEY });

const live = await client.live("melbet");
const matches = await client.matches("melbet", { status: "prematch", limit: 20 });
const odds = await client.odds("melbet", matches[0].id);
console.log(live, odds);`,
  python: `from zeroapi import ZeroApi

client = ZeroApi(api_key=os.environ["ZEROAPI_KEY"])

live = client.live("melbet")
matches = client.matches("melbet", status="prematch", limit=20)
odds = client.odds("melbet", matches[0]["id"])
print(live, odds)`,
  go: `package main

import (
    "fmt"
    "os"
    zeroapi "github.com/zeroapi/zeroapi-go"
)

func main() {
    c := zeroapi.New(os.Getenv("ZEROAPI_KEY"))
    live, _ := c.Live("melbet")
    fmt.Println(live)
}`,
};

const INSTALL: Record<Lang, string | null> = {
  curl: null,
  javascript: "npm install @zeroapi/sdk",
  python: "pip install zeroapi",
  go: "go get github.com/zeroapi/zeroapi-go",
};

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="relative">
      <button
        onClick={copy}
        className="absolute top-3 right-3 text-gray-400 hover:text-white transition-colors"
        aria-label="Copy"
      >
        {copied ? <Check size={15} className="text-brand" /> : <Copy size={15} />}
      </button>
      <pre className="bg-[#0d1117] border border-black/40 rounded-lg p-4 overflow-x-auto text-sm">
        <code className="text-gray-200 font-mono whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

export default function SdksPage() {
  const [lang, setLang] = useState<Lang>("javascript");

  return (
    <div>
      <PageHeader
        title="SDKs & code samples"
        subtitle="Typed clients with auth, retries and rate-limit-aware backoff built in"
        actions={
          <a className="btn-ghost" href={DOCS_URL} target="_blank" rel="noreferrer">
            API reference
          </a>
        }
      />

      <div className="flex gap-1 rounded-lg bg-surface-2 p-1 mb-4 w-fit">
        {LANGS.map((l) => (
          <button
            key={l.id}
            onClick={() => setLang(l.id)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              lang === l.id ? "bg-brand text-brand-contrast font-medium" : "text-muted hover:text-ink"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {INSTALL[lang] && (
        <div className="mb-4">
          <p className="text-sm text-muted mb-2">Install</p>
          <CodeBlock code={INSTALL[lang]!} />
        </div>
      )}

      <div>
        <p className="text-sm text-muted mb-2">Quick start</p>
        <CodeBlock code={SNIPPETS[lang]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-6">
        <div className="card p-5">
          <h2 className="font-semibold text-ink mb-2">Authentication</h2>
          <p className="text-sm text-muted">
            Every request authenticates with your API key via the{" "}
            <code className="text-brand">X-API-Key</code> header (or{" "}
            <code className="text-brand">?api_key=</code> query param). Set{" "}
            <code className="text-brand">ZEROAPI_KEY</code> in your environment and never commit it.
            Keys can be scoped to specific providers, source IPs and an expiry from the Overview tab.
          </p>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-ink mb-2">Base URL</h2>
          <CodeBlock code={API_BASE} />
        </div>
      </div>
    </div>
  );
}

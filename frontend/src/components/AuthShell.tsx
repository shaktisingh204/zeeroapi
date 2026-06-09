"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Check, Eye, EyeOff, Loader2, Radio } from "lucide-react";
import { getProviders } from "@/lib/landing";

const EASE = "cubic-bezier(0.23,1,0.32,1)";

const VALUE_PROPS = [
  "Live scores and odds, refreshed in under a second",
  "One JSON schema across every bookmaker",
  "Generous free tier, no card to start",
];

/* ------------------------------------------------------------------ */
/*  Page frame: form on the left, branded proof panel on the right.   */
/* ------------------------------------------------------------------ */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const [providers, setProviders] = useState<string[]>([
    "MelBet", "1xBet", "BetWinner", "1Win", "MegaPari", "D247",
  ]);

  useEffect(() => {
    let alive = true;
    getProviders().then((rows) => {
      if (alive && rows.length) setProviders(rows.map((r) => r.name));
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div
      style={{ colorScheme: "light" }}
      className="grid min-h-[100dvh] bg-[#fbfcff] font-sans text-slate-700 antialiased lg:grid-cols-[1fr_1.05fr]"
    >
      {/* ---------------- Left: form ---------------- */}
      <div className="relative flex flex-col px-6 py-8 sm:px-10 lg:px-16">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500 shadow-[0_6px_16px_-6px_rgba(16,185,129,0.8)]">
              <Activity size={18} className="text-white" />
            </span>
            <span className="text-[17px] font-bold tracking-tight text-slate-900">ZeroApi</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            <ArrowLeft size={15} /> Back
          </Link>
        </div>

        <div className="flex flex-1 items-center py-12">
          <div className="mx-auto w-full max-w-sm lg:mx-0">{children}</div>
        </div>

        <p className="text-xs text-slate-400">
          By continuing you agree to the{" "}
          <Link href="/docs" className="text-slate-500 underline-offset-2 hover:underline">terms</Link>{" "}
          and{" "}
          <Link href="/docs" className="text-slate-500 underline-offset-2 hover:underline">privacy policy</Link>.
        </p>
      </div>

      {/* ---------------- Right: branded proof panel ---------------- */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-500 lg:block">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="lp-blob absolute -left-16 -top-16 h-[420px] w-[420px] rounded-full bg-white/15 blur-3xl" />
          <div className="lp-blob absolute -right-10 bottom-0 h-[360px] w-[360px] rounded-full bg-sky-300/30 blur-3xl" style={{ animationDelay: "4s" }} />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_15%,rgba(255,255,255,0.22),transparent_45%)]" />
        </div>

        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
            <Radio size={13} /> Real-time sports data API
          </span>

          <div className="auth-in" style={{ animationDelay: "80ms" }}>
            <h2 className="max-w-[18ch] text-4xl font-bold leading-[1.08] tracking-tight text-white xl:text-5xl">
              Ship on live odds in minutes.
            </h2>
            <ul className="mt-8 space-y-3.5">
              {VALUE_PROPS.map((p, i) => (
                <li
                  key={p}
                  className="auth-in flex items-start gap-3 text-[15px] leading-relaxed text-emerald-50"
                  style={{ animationDelay: `${160 + i * 70}ms` }}
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20">
                    <Check size={13} className="text-white" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="auth-in" style={{ animationDelay: "420ms" }}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-50/80">
              Aggregating data from
            </p>
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <span
                  key={p}
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm font-medium text-white backdrop-blur"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Field: label above, error below, password reveal toggle.         */
/* ------------------------------------------------------------------ */
export function AuthField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  minLength,
  autoComplete,
  hint,
  trailing,
  delay = 0,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
  hint?: string;
  trailing?: React.ReactNode;
  delay?: number;
}) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && reveal ? "text" : type;

  return (
    <div className="auth-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
        {trailing}
      </div>
      <div className="relative">
        <input
          id={id}
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15"
          style={{ paddingRight: isPassword ? "2.75rem" : undefined }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 transition-colors hover:text-slate-600"
          >
            {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Primary submit button: scale-on-press feedback + loading state.   */
/* ------------------------------------------------------------------ */
export function AuthButton({
  loading,
  children,
  loadingLabel,
}: {
  loading: boolean;
  children: React.ReactNode;
  loadingLabel: string;
}) {
  return (
    <button
      disabled={loading}
      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(16,185,129,0.7)] transition-transform duration-150 ease-out hover:bg-emerald-600 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
      style={{ transitionTimingFunction: EASE }}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {loading ? loadingLabel : children}
    </button>
  );
}

export function AuthError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="auth-error-in rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-600"
    >
      {message}
    </div>
  );
}

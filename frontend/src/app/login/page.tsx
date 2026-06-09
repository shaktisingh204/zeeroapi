"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell, AuthField, AuthButton, AuthError } from "@/components/AuthShell";
import { portal, setCustomerToken } from "@/lib/portal";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // Smart login: try customer first, fall back to admin. One error if both fail.
    try {
      try {
        const res = await portal.login(email, password);
        setCustomerToken(res.token);
        router.push("/portal");
        return;
      } catch {
        const res = await api.login(email, password);
        setToken(res.token);
        router.push("/app");
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="auth-in mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h1>
        <p className="mt-1.5 text-sm text-slate-500">Sign in to your ZeroApi dashboard.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <AuthError message={error} />

        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@company.com"
          autoComplete="email"
          required
          delay={60}
        />

        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete="current-password"
          required
          delay={120}
          trailing={
            <Link href="/forgot" className="text-xs font-medium text-emerald-600 hover:text-emerald-700">
              Forgot password?
            </Link>
          }
        />

        <div className="auth-in pt-1" style={{ animationDelay: "180ms" }}>
          <AuthButton loading={loading} loadingLabel="Signing in…">
            Sign in
          </AuthButton>
        </div>
      </form>

      <p className="auth-in mt-6 text-sm text-slate-500" style={{ animationDelay: "240ms" }}>
        No account?{" "}
        <Link href="/signup" className="font-semibold text-emerald-600 hover:text-emerald-700">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}

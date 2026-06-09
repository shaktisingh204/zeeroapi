"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity } from "lucide-react";
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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="h-10 w-10 rounded-xl bg-brand flex items-center justify-center">
            <Activity size={22} className="text-black" />
          </div>
          <span className="text-xl font-semibold text-white">ZeroApi</span>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4">
          <h1 className="text-lg font-semibold text-white">Sign in to ZeroApi</h1>
          <p className="text-xs text-muted">Admin or customer — one sign-in.</p>
          {error && (
            <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="text-sm text-muted">Email</label>
            <input
              className="input mt-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-muted">Password</label>
              <Link href="/forgot" className="text-xs text-brand hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              className="input mt-1"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-xs text-muted text-center">
            No account?{" "}
            <Link href="/signup" className="text-brand">
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity } from "lucide-react";
import { portal } from "@/lib/portal";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Read ?token= on the client (avoids useSearchParams prerender constraints).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") || "";
    setToken(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await portal.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "reset failed");
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

        {done ? (
          <div className="card p-6 space-y-3">
            <h1 className="text-lg font-semibold text-white">Password updated</h1>
            <p className="text-sm text-muted">Redirecting you to sign in…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-6 space-y-4">
            <h1 className="text-lg font-semibold text-white">Choose a new password</h1>
            {!token && (
              <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2">
                Missing reset token. Use the link from your email.
              </div>
            )}
            {error && (
              <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2">{error}</div>
            )}
            <div>
              <label className="text-sm text-muted">New password</label>
              <input
                className="input mt-1"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                required
              />
              <p className="text-xs text-muted mt-1">min 8 characters</p>
            </div>
            <div>
              <label className="text-sm text-muted">Confirm password</label>
              <input
                className="input mt-1"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <button className="btn-primary w-full" disabled={loading || !token}>
              {loading ? "Updating…" : "Update password"}
            </button>
            <p className="text-sm text-muted text-center">
              <Link href="/login" className="text-brand hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

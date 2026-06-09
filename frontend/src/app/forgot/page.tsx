"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { portal } from "@/lib/portal";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await portal.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
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

        {sent ? (
          <div className="card p-6 space-y-3">
            <h1 className="text-lg font-semibold text-white">Check your email</h1>
            <p className="text-sm text-muted">
              If an account exists for <span className="text-white">{email}</span>, we&apos;ve sent a
              password-reset link. It expires in 1 hour.
            </p>
            <Link href="/login" className="text-sm text-brand hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-6 space-y-4">
            <h1 className="text-lg font-semibold text-white">Reset your password</h1>
            <p className="text-sm text-muted">
              Enter your account email and we&apos;ll send you a reset link.
            </p>
            {error && (
              <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2">{error}</div>
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
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
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

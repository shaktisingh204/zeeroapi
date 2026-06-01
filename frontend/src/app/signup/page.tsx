"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity } from "lucide-react";
import { portal, setCustomerToken } from "@/lib/portal";

export default function PortalSignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await portal.signup(email, name, password);
      setCustomerToken(res.token);
      router.push("/portal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "signup failed");
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
          <h1 className="text-lg font-semibold text-white">Create your ZeroApi account</h1>
          {error && (
            <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="text-sm text-muted">Name</label>
            <input
              className="input mt-1"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
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
            <label className="text-sm text-muted">Password</label>
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
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </button>
          <p className="text-xs text-muted text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-brand">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell, AuthField, AuthButton, AuthError } from "@/components/AuthShell";
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
    <AuthShell>
      <div className="auth-in mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
        <p className="mt-1.5 text-sm text-slate-500">Free to start. No card required.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <AuthError message={error} />

        <AuthField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="Ada Lovelace"
          autoComplete="name"
          required
          delay={60}
        />

        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@company.com"
          autoComplete="email"
          required
          delay={120}
        />

        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete="new-password"
          required
          minLength={8}
          hint="At least 8 characters."
          delay={180}
        />

        <div className="auth-in pt-1" style={{ animationDelay: "240ms" }}>
          <AuthButton loading={loading} loadingLabel="Creating account…">
            Create account
          </AuthButton>
        </div>
      </form>

      <p className="auth-in mt-6 text-sm text-slate-500" style={{ animationDelay: "300ms" }}>
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-emerald-600 hover:text-emerald-700">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

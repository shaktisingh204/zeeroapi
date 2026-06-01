"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, getAdminProvider, setAdminProvider } from "@/lib/api";
import type { User, Provider } from "@/lib/types";
import Shell from "@/components/Shell";
import { Spinner } from "@/components/ui";
import { AdminProviderContext, ProviderGate } from "@/lib/adminProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Active-provider state (scopes every data view).
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProviderState] = useState("");
  const [provReady, setProvReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    setProviderState(getAdminProvider());
    api
      .providers()
      .then((ps) => setProviders(ps.filter((p) => p.is_active)))
      .finally(() => setProvReady(true));
  }, [user]);

  function choose(slug: string) {
    if (slug === provider) return;
    setAdminProvider(slug);
    setProviderState(slug);
    // Hard reload so every view refetches scoped to the new provider — robust
    // against any cached bundle/response or stale component state.
    if (typeof window !== "undefined") window.location.reload();
  }

  if (loading || !user || !provReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Ask which provider to view before showing any data.
  if (!provider) {
    return <ProviderGate providers={providers} choose={choose} />;
  }

  return (
    <AdminProviderContext.Provider value={{ provider, providers, choose }}>
      <Shell user={user}>
        {/* Remount the page subtree when the provider changes so every view
            refetches its data scoped to the new provider. */}
        <div key={provider}>{children}</div>
      </Shell>
    </AdminProviderContext.Provider>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Activity } from "lucide-react";
import { portal, getCustomerToken, clearCustomerToken } from "@/lib/portal";
import type { Customer } from "@/lib/types";
import { Spinner } from "@/components/ui";

// Grouped logical order: Develop · Insights · Account. Usage was merged into
// Analytics ("Usage & Analytics"), so the old 8 tabs are now 7.
const TABS = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/playground", label: "Playground" },
  { href: "/portal/sdks", label: "SDKs" },
  { href: "/portal/analytics", label: "Usage & Analytics" },
  { href: "/portal/logs", label: "Logs" },
  { href: "/portal/billing", label: "Billing" },
  { href: "/portal/settings", label: "Settings" },
];

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getCustomerToken()) {
      router.replace("/login");
      return;
    }
    portal
      .me()
      .then((res) => setCustomer(res.customer))
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  function signOut() {
    clearCustomerToken();
    router.push("/login");
  }

  if (loading || !customer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center">
              <Activity size={18} className="text-black" />
            </div>
            <span className="font-semibold text-white">ZeroApi</span>
            <span className="text-sm text-muted">Developer Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-white truncate max-w-[200px]">{customer.email}</span>
            <button onClick={signOut} className="btn-ghost">
              Sign out
            </button>
          </div>
        </div>
        <div className="max-w-[1100px] mx-auto px-6">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map((t) => {
              const active = t.href === "/portal" ? pathname === "/portal" : pathname.startsWith(t.href);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`px-4 py-3 text-sm border-b-2 whitespace-nowrap transition-colors ${
                    active
                      ? "border-brand text-white"
                      : "border-transparent text-muted hover:text-white"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

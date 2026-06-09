"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  LayoutDashboard,
  KeyRound,
  Boxes,
  TerminalSquare,
  Code2,
  BarChart3,
  ScrollText,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
  ExternalLink,
} from "lucide-react";
import { portal, getCustomerToken, clearCustomerToken } from "@/lib/portal";
import type { Customer, Plan } from "@/lib/types";
import type { UsageResponse } from "@/lib/portal";
import { Spinner } from "@/components/ui";

const NAV = [
  {
    group: "Develop",
    items: [
      { href: "/portal", label: "Overview", icon: LayoutDashboard },
      { href: "/portal/keys", label: "API Keys", icon: KeyRound },
      { href: "/portal/providers", label: "Providers", icon: Boxes },
      { href: "/portal/playground", label: "Playground", icon: TerminalSquare },
      { href: "/portal/sdks", label: "SDKs", icon: Code2 },
    ],
  },
  {
    group: "Insights",
    items: [
      { href: "/portal/analytics", label: "Usage & Analytics", icon: BarChart3 },
      { href: "/portal/logs", label: "Logs", icon: ScrollText },
    ],
  },
  {
    group: "Account",
    items: [
      { href: "/portal/billing", label: "Billing", icon: CreditCard },
      { href: "/portal/settings", label: "Settings", icon: Settings },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

function isActive(href: string, pathname: string) {
  return href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false); // mobile drawer

  useEffect(() => {
    if (!getCustomerToken()) {
      router.replace("/login");
      return;
    }
    portal
      .me()
      .then((res) => {
        setCustomer(res.customer);
        setPlan(res.plan);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
    portal.usage().then(setUsage).catch(() => {});
  }, [router]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function signOut() {
    clearCustomerToken();
    router.push("/login");
  }

  if (loading || !customer) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const current = ALL_ITEMS.find((i) => isActive(i.href, pathname));
  const initials = customer.email.slice(0, 2).toUpperCase();
  const planName = plan?.name ?? customer.plan_slug;

  const quota = usage?.monthly_quota ?? 0;
  const used = usage?.used_this_month ?? 0;
  const unlimited = quota <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / quota) * 100));
  const meterColor = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#34d27b";

  return (
    <div className="min-h-[100dvh] lg:flex">
      {/* ---------- Sidebar ---------- */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface
          transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:static lg:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <Link href="/portal" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand shadow-[0_4px_14px_-4px_rgba(52,210,123,0.7)]">
              <Activity size={18} className="text-black" />
            </span>
            <span className="font-semibold text-white">ZeroApi</span>
          </Link>
          <span className="badge-muted ml-auto">Portal</span>
          <button
            className="ml-1 text-muted transition-colors hover:text-white lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-2">
                {g.group}
              </p>
              <div className="space-y-0.5">
                {g.items.map((it) => {
                  const active = isActive(it.href, pathname);
                  const Icon = it.icon;
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150 active:scale-[0.98] ${
                        active
                          ? "bg-brand-soft text-white"
                          : "text-muted hover:bg-surface-2 hover:text-white"
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-brand transition-opacity duration-150 ${
                          active ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <Icon
                        size={16}
                        className={active ? "text-brand" : "text-muted-2 group-hover:text-muted"}
                      />
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Usage meter */}
        <div className="border-t border-border px-4 py-4">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted">This month</span>
            <span className="font-medium tabular-nums text-white">
              {used.toLocaleString()}
              <span className="text-muted-2"> / {unlimited ? "∞" : quota.toLocaleString()}</span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{ width: `${unlimited ? 6 : Math.max(pct, 2)}%`, background: meterColor }}
            />
          </div>
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-white">{customer.email}</p>
              <span className="badge-brand mt-0.5">{planName}</span>
            </div>
          </div>
          <button onClick={signOut} className="btn-ghost mt-2 w-full justify-start">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      {/* mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/55 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* ---------- Content column ---------- */}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur lg:px-8">
          <button
            className="-ml-1 p-2 text-muted transition-colors hover:text-white lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <span className="text-sm font-medium text-white">{current?.label ?? "Developer Portal"}</span>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/docs" className="btn-quiet hidden text-sm sm:inline-flex">
              Docs <ExternalLink size={13} />
            </Link>
            <Link href="/portal/playground" className="btn-ghost text-sm">
              Open Playground
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-[1200px] px-4 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

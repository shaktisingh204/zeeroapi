"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  LayoutDashboard,
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
import { Spinner } from "@/components/ui";

const NAV = [
  {
    group: "Develop",
    items: [
      { href: "/portal", label: "Overview", icon: LayoutDashboard },
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
  }, [router]);

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

  return (
    <div className="min-h-[100dvh] lg:flex">
      {/* ---------- Sidebar ---------- */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-surface border-r border-border flex flex-col
          transition-transform duration-200 lg:static lg:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="h-16 flex items-center gap-2 px-5 border-b border-border">
          <Link href="/portal" className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center">
              <Activity size={18} className="text-black" />
            </span>
            <span className="font-semibold text-white">ZeroApi</span>
          </Link>
          <span className="badge-muted ml-auto">Portal</span>
          <button
            className="lg:hidden ml-1 text-muted hover:text-white"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="px-3 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-2">
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
                      onClick={() => setOpen(false)}
                      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-brand-soft text-white"
                          : "text-muted hover:text-white hover:bg-surface-2"
                      }`}
                    >
                      {active && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-brand" />
                      )}
                      <Icon size={16} className={active ? "text-brand" : ""} />
                      {it.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="h-8 w-8 shrink-0 rounded-full bg-surface-3 flex items-center justify-center text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{customer.email}</p>
              <span className="badge-brand mt-0.5">{planName}</span>
            </div>
          </div>
          <button onClick={signOut} className="btn-ghost w-full mt-2 justify-start">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      {/* mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/55 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* ---------- Content column ---------- */}
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-20 h-14 border-b border-border bg-bg/80 backdrop-blur flex items-center gap-3 px-4 lg:px-8">
          <button
            className="lg:hidden -ml-1 p-2 text-muted hover:text-white"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <span className="text-sm font-medium text-white">{current?.label ?? "Developer Portal"}</span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/docs"
              className="btn-quiet text-sm hidden sm:inline-flex"
            >
              Docs <ExternalLink size={13} />
            </Link>
            <Link href="/portal/playground" className="btn-ghost text-sm">
              Open Playground
            </Link>
          </div>
        </header>

        <main className="px-4 lg:px-8 py-8 max-w-[1200px]">{children}</main>
      </div>
    </div>
  );
}

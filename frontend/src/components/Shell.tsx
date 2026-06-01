"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Radio,
  Trophy,
  ListOrdered,
  TerminalSquare,
  Settings,
  Users,
  LogOut,
  Gauge,
  Medal,
  Image as ImageIcon,
  Database,
  KeyRound,
  CreditCard,
  Code2,
  Megaphone,
} from "lucide-react";
import { clearToken } from "@/lib/api";
import type { User } from "@/lib/types";
import { ProviderSwitcher } from "@/lib/adminProvider";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Gauge;
  adminOnly?: boolean;
}
interface NavGroup {
  group: string;
  items: NavItem[];
}

// Workflow-grouped navigation (replaces the old flat 17-item list).
const NAV_GROUPS: NavGroup[] = [
  {
    group: "Dashboard",
    items: [{ href: "/app", label: "Overview", icon: Gauge }],
  },
  {
    group: "Live & Matches",
    items: [
      { href: "/app/live", label: "Live Scores", icon: Radio },
      { href: "/app/matches", label: "Matches & Results", icon: ListOrdered },
    ],
  },
  {
    group: "Catalog",
    items: [
      { href: "/app/sports", label: "Sports", icon: Trophy },
      { href: "/app/leagues", label: "Leagues", icon: Medal },
      { href: "/app/images", label: "Images", icon: ImageIcon },
    ],
  },
  {
    group: "Sources",
    items: [
      { href: "/app/providers", label: "Providers", icon: Database },
      { href: "/app/jobs", label: "Scrape Activity", icon: TerminalSquare },
    ],
  },
  {
    group: "Manage",
    items: [
      { href: "/app/plans", label: "Plans", icon: CreditCard },
      { href: "/app/customers", label: "Customers & Keys", icon: KeyRound, adminOnly: true },
      { href: "/app/developers", label: "API Docs", icon: Code2 },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/app/users", label: "Users", icon: Users, adminOnly: true },
      { href: "/app/changelog", label: "Changelog", icon: Megaphone, adminOnly: true },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

export default function Shell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border bg-surface flex flex-col fixed h-screen">
        <div className="px-5 h-16 flex items-center gap-2 border-b border-border">
          <div className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center">
            <Activity size={18} className="text-black" />
          </div>
          <span className="font-semibold text-white">ZeroApi</span>
        </div>

        <ProviderSwitcher />

        <nav className="flex-1 p-3 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((n) => !n.adminOnly || user.role === "admin");
            if (items.length === 0) return null;
            return (
              <div key={group.group} className="mb-4">
                <p className="px-3 mb-1 text-[11px] font-medium uppercase tracking-wider text-muted/70">
                  {group.group}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active =
                      item.href === "/app"
                        ? pathname === "/app"
                        : pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                          active
                            ? "bg-brand/15 text-brand"
                            : "text-gray-300 hover:bg-surface-2"
                        }`}
                      >
                        <Icon size={18} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="px-3 py-2">
            <p className="text-sm text-white truncate">{user.email}</p>
            <p className="text-xs text-muted capitalize">{user.role}</p>
          </div>
          <button onClick={logout} className="btn-ghost w-full mt-1">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 ml-64 min-h-screen">
        <div className="max-w-[1400px] mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}

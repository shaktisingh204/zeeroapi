"use client";

import { ReactElement, ReactNode } from "react";

export function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="card p-5 flex items-center justify-between">
      <div>
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      </div>
      {icon && (
        <div
          className="h-11 w-11 rounded-lg flex items-center justify-center"
          style={{ background: (accent ?? "#22c55e") + "22", color: accent ?? "#22c55e" }}
        >
          {icon}
        </div>
      )}
    </div>
  );
}

// ---- Badge: one canonical pill, variant-driven ----
export type BadgeVariant =
  | "live" | "success" | "info" | "warning" | "danger" | "neutral" | "brand" | "purple";

const BADGE_CLASS: Record<BadgeVariant, string> = {
  live: "bg-live/15 text-live",
  success: "bg-brand/15 text-brand",
  brand: "bg-brand/15 text-brand",
  info: "bg-blue-500/15 text-blue-400",
  warning: "bg-yellow-500/15 text-yellow-400",
  danger: "bg-live/15 text-live",
  purple: "bg-purple-500/15 text-purple-400",
  neutral: "bg-surface-2 text-muted",
};

export function Badge({
  variant = "neutral",
  dot,
  children,
  className = "",
}: {
  variant?: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`badge ${BADGE_CLASS[variant]} ${className}`}>
      {dot && <span className="live-dot mr-1.5 inline-block" />}
      {children}
    </span>
  );
}

// Match/connection status → badge (now backed by Badge).
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  live: "live",
  prematch: "info",
  finished: "neutral",
  success: "success",
  error: "danger",
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "neutral"} dot={status === "live"}>
      {status}
    </Badge>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-brand" />
    </div>
  );
}

// ---- Card wrappers (one canonical card style) ----
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function SectionCard({
  title,
  actions,
  children,
  className = "",
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-white">{title}</h2>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ---- EmptyState: backward-compatible (message) + richer (icon/title/action) ----
export function EmptyState({
  message,
  title,
  icon,
  action,
}: {
  message?: string;
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  // Simple legacy form: just a message line.
  if (!title && !icon && !action) {
    return <div className="py-16 text-center text-muted text-sm">{message}</div>;
  }
  return (
    <div className="py-16 flex flex-col items-center text-center">
      {icon && <div className="h-12 w-12 rounded-xl bg-surface-2 flex items-center justify-center text-muted mb-3">{icon}</div>}
      {title && <p className="text-white font-medium">{title}</p>}
      {message && <p className="text-sm text-muted mt-1 max-w-[42ch]">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---- Skeletons ----
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <table className="w-full">
      <thead className="border-b border-border">
        <tr>
          {Array.from({ length: cols }).map((_, c) => (
            <th key={c} className="th">
              <div className="bg-surface-2 animate-pulse rounded h-4 w-20" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c} className="td">
                <div className="bg-surface-2 animate-pulse rounded h-4 w-full max-w-[8rem]" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="card p-5 flex items-center justify-between">
      <div className="flex-1">
        <div className="bg-surface-2 animate-pulse rounded h-4 w-24" />
        <div className="bg-surface-2 animate-pulse rounded h-7 w-16 mt-2" />
      </div>
      <div className="bg-surface-2 animate-pulse rounded-lg h-11 w-11" />
    </div>
  );
}

export function LoadingCard() {
  return (
    <div className="card p-5">
      <div className="bg-surface-2 animate-pulse rounded h-4 w-1/3" />
      <div className="bg-surface-2 animate-pulse rounded h-4 w-2/3 mt-3" />
      <div className="bg-surface-2 animate-pulse rounded h-4 w-1/2 mt-3" />
    </div>
  );
}

// ---- DataTable: shared generic table ----
export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode; // omit => String((row as any)[key])
  align?: "left" | "right" | "center";
  className?: string; // applied to the <td>
}

const ALIGN_CLASS: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  className = "",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
}): ReactElement {
  if (loading) {
    return <TableSkeleton rows={8} cols={columns.length} />;
  }

  if (rows.length === 0) {
    return <>{empty ?? <EmptyState message="No data to display." />}</>;
  }

  return (
    <table className={`w-full ${className}`}>
      <thead className="border-b border-border">
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={`th ${ALIGN_CLASS[col.align ?? "left"]}`}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`hover:bg-surface-2/50 ${onRowClick ? "cursor-pointer" : ""}`}
          >
            {columns.map((col) => (
              <td
                key={col.key}
                className={`td ${ALIGN_CLASS[col.align ?? "left"]} ${col.className ?? ""}`}
              >
                {col.render
                  ? col.render(row)
                  : String((row as Record<string, unknown>)[col.key] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

"use client";

import { useEffect, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { portal } from "@/lib/portal";
import type { BillingSummary, Invoice } from "@/lib/portal";
import type { Plan } from "@/lib/types";
import { PageHeader, StatCard, Spinner } from "@/components/ui";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function BillingPage() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([portal.billingSummary(), portal.plans()])
      .then(([s, p]) => {
        setSummary(s);
        setPlans(p);
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
    // Invoices are best-effort (empty until a Stripe customer exists).
    portal
      .invoices()
      .then((r) => setInvoices(r.invoices ?? []))
      .catch(() => setInvoices([]));
  }, []);

  async function upgrade(slug: string) {
    setError("");
    setBusy(true);
    try {
      const { url } = await portal.checkout(slug);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "checkout failed");
      setBusy(false);
    }
  }

  async function manage() {
    setError("");
    setBusy(true);
    try {
      const { url } = await portal.billingPortal();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not open billing portal");
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  if (unavailable || !summary) {
    return (
      <div>
        <PageHeader title="Billing" subtitle="Manage your subscription and payment method" />
        <div className="card p-8 text-center">
          <CreditCard size={28} className="mx-auto text-muted mb-3" />
          <p className="text-ink font-medium mb-1">Billing isn&apos;t configured yet</p>
          <p className="text-sm text-muted">
            Stripe keys haven&apos;t been set on this environment. Plans can still be changed from the
            Overview tab.
          </p>
        </div>
      </div>
    );
  }

  const plan = summary.plan;
  const unlimited = summary.monthly_quota < 0;

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Subscription, usage cost and payment method"
        actions={
          <button className="btn-ghost" onClick={manage} disabled={busy}>
            <ExternalLink size={15} /> Manage billing
          </button>
        }
      />

      {error && <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2 mb-4">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard label="Current plan" value={plan.name} accent="#059669" />
        <StatCard label="Status" value={summary.subscription_status ?? "-"} accent="#3b82f6" />
        <StatCard
          label="Usage this period"
          value={`${summary.used_this_month.toLocaleString()}${unlimited ? "" : ` / ${summary.monthly_quota.toLocaleString()}`}`}
          accent="#d97706"
        />
        <StatCard label="Est. cost" value={money(summary.estimated_cost_cents)} accent="#a855f7" />
      </div>

      {summary.overage > 0 && (
        <div className="rounded-lg bg-warn/10 border border-warn/30 text-warn text-sm px-4 py-3 mb-6">
          You&apos;re <strong>{summary.overage.toLocaleString()}</strong> requests over your included quota.
          Overage is metered and billed at the end of the period.
        </div>
      )}

      <h2 className="font-semibold text-ink mb-3">Plans</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p) => {
          const current = p.slug === plan.slug;
          return (
            <div
              key={p.slug}
              className={`card p-5 flex flex-col ${current ? "border-brand" : ""}`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold text-ink">{p.name}</h3>
                {current && <span className="badge bg-brand/15 text-brand">Current</span>}
              </div>
              <p className="text-2xl font-semibold text-ink mt-2">
                {money(p.price_cents)}
                <span className="text-sm text-muted font-normal">/mo</span>
              </p>
              <ul className="text-sm text-muted mt-3 space-y-1 flex-1">
                <li>{p.rate_limit_per_min}/min rate limit</li>
                <li>{p.monthly_quota < 0 ? "Unlimited" : p.monthly_quota.toLocaleString()} requests/mo</li>
                {p.features?.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {!current && (
                <button
                  className="btn-primary mt-4"
                  disabled={busy || (p.price_cents > 0 && !p.stripe_price_id)}
                  onClick={() => upgrade(p.slug)}
                >
                  {p.price_cents > plan.price_cents ? "Upgrade" : "Switch"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {invoices.length > 0 && (
        <>
          <h2 className="font-semibold text-ink mt-8 mb-3">Invoices</h2>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="th">Invoice</th>
                  <th className="th">Date</th>
                  <th className="th text-right">Amount</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border-soft last:border-0">
                    <td className="td font-mono text-xs">{inv.number ?? inv.id}</td>
                    <td className="td">{new Date(inv.created * 1000).toLocaleDateString()}</td>
                    <td className="td text-right tabular">
                      {(inv.amount_paid / 100).toLocaleString(undefined, {
                        style: "currency",
                        currency: (inv.currency || "usd").toUpperCase(),
                      })}
                    </td>
                    <td className="td">
                      <span className={inv.status === "paid" ? "badge-brand" : "badge-muted"}>
                        {inv.status ?? "-"}
                      </span>
                    </td>
                    <td className="td text-right">
                      {inv.hosted_invoice_url ? (
                        <a
                          href={inv.hosted_invoice_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand hover:underline inline-flex items-center gap-1"
                        >
                          View <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-muted-2">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

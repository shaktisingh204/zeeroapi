"use client";

import { useEffect, useState } from "react";
import { Trash2, UserPlus, KeyRound, Copy, Check, X, Users as UsersIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { ApiKey, Customer, CustomerUsage, Plan } from "@/lib/types";
import { PageHeader, Spinner, EmptyState, DataTable, type Column } from "@/components/ui";

interface IssuedKey {
  id: string;
  key: string;
  key_prefix: string;
  note: string;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [planSlug, setPlanSlug] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  function load() {
    api.customers().then(setCustomers).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api
      .plans()
      .then((p) => {
        setPlans(p);
        if (p.length > 0) setPlanSlug((cur) => cur || p[0].slug);
      })
      .catch(() => {});
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createCustomer(email, name, planSlug);
      setEmail("");
      setName("");
      if (plans.length > 0) setPlanSlug(plans[0].slug);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this customer?")) return;
    setError("");
    try {
      await api.deleteCustomer(id);
      if (expanded === id) setExpanded(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  const columns: Column<Customer>[] = [
    { key: "email", header: "Email", className: "text-white", render: (c) => c.email },
    { key: "name", header: "Name", render: (c) => c.name ?? "—" },
    {
      key: "plan",
      header: "Plan",
      render: (c) => <span className="badge bg-brand/15 text-brand">{c.plan_slug}</span>,
    },
    {
      key: "created_at",
      header: "Created",
      className: "text-muted",
      render: (c) => new Date(c.created_at).toLocaleDateString(),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (c) => (
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => setExpanded(expanded === c.id ? null : c.id)}
            className="btn-ghost"
          >
            {expanded === c.id ? "Close" : "Manage"}
          </button>
          <button
            onClick={() => remove(c.id)}
            className="text-muted hover:text-live"
            aria-label="delete customer"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const expandedCustomer = customers.find((c) => c.id === expanded) ?? null;

  return (
    <div>
      <PageHeader title="Customers" subtitle="API consumers, their plan, keys & usage" />

      <form onSubmit={create} className="card p-5 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-sm text-muted">Email</label>
          <input
            className="input mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="text-sm text-muted">Name</label>
          <input
            className="input mt-1"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-muted">Plan</label>
          <select
            className="input mt-1 w-40"
            value={planSlug}
            onChange={(e) => setPlanSlug(e.target.value)}
            required
          >
            {plans.length === 0 && <option value="">No plans</option>}
            {plans.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" disabled={plans.length === 0}>
          <UserPlus size={15} /> Add customer
        </button>
      </form>

      {error && (
        <div className="rounded-lg bg-live/15 text-live text-sm px-3 py-2 mb-4">{error}</div>
      )}

      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          rows={customers}
          rowKey={(c) => c.id}
          loading={loading}
          empty={
            <EmptyState
              icon={<UsersIcon size={20} />}
              title="No customers"
              message="No customers yet. Add one with the form above."
            />
          }
        />
      </div>

      {expandedCustomer && (
        <div className="card p-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-white">
              Manage <span className="text-muted">{expandedCustomer.email}</span>
            </h2>
            <button
              onClick={() => setExpanded(null)}
              className="text-muted hover:text-white"
              aria-label="close manage panel"
            >
              <X size={16} />
            </button>
          </div>
          <ManagePanel
            customerId={expandedCustomer.id}
            onError={(msg) => setError(msg)}
          />
        </div>
      )}
    </div>
  );
}

function ManagePanel({
  customerId,
  onError,
}: {
  customerId: string;
  onError: (msg: string) => void;
}) {
  const [usage, setUsage] = useState<CustomerUsage | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyName, setKeyName] = useState("");
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([api.customerUsage(customerId), api.customerKeys(customerId)])
      .then(([u, k]) => {
        setUsage(u);
        setKeys(k);
      })
      .catch((err) => onError(err instanceof Error ? err.message : "failed"))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [customerId]);

  async function issue() {
    onError("");
    try {
      const res = await api.issueKey(customerId, keyName);
      setIssued(res);
      setKeyName("");
      setCopied(false);
      const k = await api.customerKeys(customerId);
      setKeys(k);
    } catch (err) {
      onError(err instanceof Error ? err.message : "failed");
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key?")) return;
    onError("");
    try {
      await api.revokeKey(id);
      const k = await api.customerKeys(customerId);
      setKeys(k);
    } catch (err) {
      onError(err instanceof Error ? err.message : "failed");
    }
  }

  async function copyKey() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("copy failed");
    }
  }

  if (loading) return <Spinner />;

  const quotaLabel =
    usage && usage.monthly_quota > 0 ? usage.monthly_quota.toLocaleString() : "∞";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Usage:</span>
        <span className="text-sm text-white">
          {usage ? usage.used_this_month.toLocaleString() : 0} / {quotaLabel} this month
        </span>
        {usage && (
          <span className="badge bg-surface-2 text-muted">{usage.plan}</span>
        )}
      </div>

      {issued && (
        <div className="rounded-lg border border-brand/40 bg-brand/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-brand font-medium">New API key</p>
              <code className="mt-1 block break-all text-sm text-white">{issued.key}</code>
              <p className="mt-2 text-xs text-muted">{issued.note}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={copyKey} className="btn-ghost" aria-label="copy key">
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={() => setIssued(null)}
                className="text-muted hover:text-white"
                aria-label="dismiss"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[160px]">
          <label className="text-sm text-muted">Key name</label>
          <input
            className="input mt-1"
            type="text"
            value={keyName}
            placeholder="e.g. production"
            onChange={(e) => setKeyName(e.target.value)}
          />
        </div>
        <button onClick={issue} className="btn-primary">
          <KeyRound size={15} /> Issue new key
        </button>
      </div>

      {keys.length === 0 ? (
        <EmptyState message="No API keys." />
      ) : (
        <table className="w-full">
          <thead className="border-b border-border">
            <tr>
              <th className="th">Key</th>
              <th className="th">Name</th>
              <th className="th">Created</th>
              <th className="th">Last used</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {keys.map((k) => (
              <tr
                key={k.id}
                className={k.revoked ? "line-through text-muted opacity-60" : ""}
              >
                <td className="td">
                  <code className="text-white">{k.key_prefix}…</code>
                </td>
                <td className="td">{k.name ?? "—"}</td>
                <td className="td text-muted">
                  {new Date(k.created_at).toLocaleDateString()}
                </td>
                <td className="td text-muted">
                  {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                </td>
                <td className="td text-right">
                  {!k.revoked && (
                    <button onClick={() => revoke(k.id)} className="btn-ghost">
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

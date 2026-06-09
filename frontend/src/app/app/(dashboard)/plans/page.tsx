"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Trash2, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Plan } from "@/lib/types";
import { PageHeader, Spinner, Card, Badge, SectionCard } from "@/components/ui";

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toLocaleString()}/mo`;
}

function formatQuota(quota: number): string {
  return quota < 0 ? "Unlimited" : `${quota.toLocaleString()} req/mo`;
}

// Form state mirrors Plan, but numbers are kept as strings (so inputs can be
// empty mid-edit) and features as one-per-line text.
interface FormState {
  slug: string;
  name: string;
  priceDollars: string;
  rate_limit_per_min: string;
  monthly_quota: string;
  featuresText: string;
  sort_order: string;
  stripe_price_id: string;
  metered_price_id: string;
}

const EMPTY_FORM: FormState = {
  slug: "",
  name: "",
  priceDollars: "0",
  rate_limit_per_min: "60",
  monthly_quota: "10000",
  featuresText: "",
  sort_order: "0",
  stripe_price_id: "",
  metered_price_id: "",
};

function planToForm(p: Plan): FormState {
  return {
    slug: p.slug,
    name: p.name,
    priceDollars: (p.price_cents / 100).toString(),
    rate_limit_per_min: p.rate_limit_per_min.toString(),
    monthly_quota: p.monthly_quota.toString(),
    featuresText: (p.features ?? []).join("\n"),
    sort_order: p.sort_order.toString(),
    stripe_price_id: p.stripe_price_id ?? "",
    metered_price_id: p.metered_price_id ?? "",
  };
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(true);

  // editing: null = closed, "new" = creating, otherwise the slug being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api
      .plans()
      .then(setPlans)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setError("");
    setForm(EMPTY_FORM);
    setEditing("new");
  }

  function openEdit(p: Plan) {
    setError("");
    setForm(planToForm(p));
    setEditing(p.slug);
  }

  function close() {
    setEditing(null);
    setError("");
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setError("");
    const isNew = editing === "new";

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (isNew && !form.slug.trim()) {
      setError("Slug is required.");
      return;
    }

    const body = {
      name: form.name.trim(),
      price_cents: Math.max(0, Math.round((parseFloat(form.priceDollars) || 0) * 100)),
      rate_limit_per_min: parseInt(form.rate_limit_per_min, 10) || 0,
      monthly_quota: parseInt(form.monthly_quota, 10) || 0,
      features: form.featuresText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      sort_order: parseInt(form.sort_order, 10) || 0,
      stripe_price_id: form.stripe_price_id.trim() || null,
      metered_price_id: form.metered_price_id.trim() || null,
    };

    setSaving(true);
    try {
      if (isNew) {
        await api.createPlan({ slug: form.slug.trim().toLowerCase(), ...body });
      } else {
        await api.updatePlan(editing as string, body);
      }
      close();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save plan.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(slug: string) {
    if (!confirm(`Delete the "${slug}" plan? This cannot be undone.`)) return;
    setError("");
    try {
      await api.deletePlan(slug);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete plan.");
    }
  }

  if (loading && !plans) return <Spinner />;

  const sorted = [...(plans ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const popularIdx = Math.floor((sorted.length - 1) / 2);

  return (
    <div>
      <PageHeader
        title="Plans"
        subtitle="Subscription tiers for the public API"
        actions={
          editing === null ? (
            <button onClick={openNew} className="btn-primary inline-flex items-center gap-1.5">
              <Plus size={16} /> New plan
            </button>
          ) : undefined
        }
      />

      {error && editing === null && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {editing !== null && (
        <SectionCard
          title={editing === "new" ? "New plan" : `Edit plan — ${editing}`}
          className="mb-6"
          actions={
            <button onClick={close} className="btn-ghost" aria-label="close editor">
              <X size={16} />
            </button>
          }
        >
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Slug" hint={editing === "new" ? "lowercase id, e.g. pro" : "identity — not editable"}>
              <input
                className="input mt-1 w-full"
                value={form.slug}
                disabled={editing !== "new"}
                onChange={(e) => set("slug", e.target.value)}
                placeholder="pro"
              />
            </Field>

            <Field label="Name">
              <input
                className="input mt-1 w-full"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Pro"
              />
            </Field>

            <Field label="Monthly price ($)">
              <input
                type="number"
                min={0}
                step="0.01"
                className="input mt-1 w-full"
                value={form.priceDollars}
                onChange={(e) => set("priceDollars", e.target.value)}
              />
            </Field>

            <Field label="Sort order" hint="lower = shown first">
              <input
                type="number"
                className="input mt-1 w-full"
                value={form.sort_order}
                onChange={(e) => set("sort_order", e.target.value)}
              />
            </Field>

            <Field label="Rate limit (req/min)">
              <input
                type="number"
                min={0}
                className="input mt-1 w-full"
                value={form.rate_limit_per_min}
                onChange={(e) => set("rate_limit_per_min", e.target.value)}
              />
            </Field>

            <Field label="Monthly quota" hint="-1 = unlimited">
              <input
                type="number"
                className="input mt-1 w-full"
                value={form.monthly_quota}
                onChange={(e) => set("monthly_quota", e.target.value)}
              />
            </Field>

            <Field label="Stripe price ID" hint="optional — recurring base price">
              <input
                className="input mt-1 w-full"
                value={form.stripe_price_id}
                onChange={(e) => set("stripe_price_id", e.target.value)}
                placeholder="price_..."
              />
            </Field>

            <Field label="Metered price ID" hint="optional — usage/overage price">
              <input
                className="input mt-1 w-full"
                value={form.metered_price_id}
                onChange={(e) => set("metered_price_id", e.target.value)}
                placeholder="price_..."
              />
            </Field>

            <div className="md:col-span-2">
              <Field label="Features" hint="one bullet per line">
                <textarea
                  className="input mt-1 w-full font-mono text-xs"
                  rows={5}
                  value={form.featuresText}
                  onChange={(e) => set("featuresText", e.target.value)}
                  placeholder={"All providers\nOdds history\nEmail support"}
                />
              </Field>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving ? "Saving…" : editing === "new" ? "Create plan" : "Save changes"}
            </button>
            <button onClick={close} className="btn-ghost">
              Cancel
            </button>
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {sorted.map((plan, i) => {
          const popular = i === popularIdx;
          return (
            <Card key={plan.slug} className={popular ? "border-brand ring-1 ring-brand" : ""}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-white">{plan.name}</h2>
                  <span className="text-xs text-muted">{plan.slug}</span>
                </div>
                {popular && <Badge variant="brand">Popular</Badge>}
              </div>

              <p className="mt-4 text-3xl font-semibold text-white">
                {formatPrice(plan.price_cents)}
              </p>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Rate limit</dt>
                  <dd className="font-medium text-white">{plan.rate_limit_per_min}/min</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Monthly quota</dt>
                  <dd className="font-medium text-white">{formatQuota(plan.monthly_quota)}</dd>
                </div>
              </dl>

              {plan.features.length > 0 && (
                <ul className="mt-5 space-y-2 border-t border-border pt-5 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-white">
                      <Check size={16} className="mt-0.5 shrink-0 text-brand" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
                <button
                  onClick={() => openEdit(plan)}
                  className="btn-ghost inline-flex items-center gap-1.5 text-sm"
                >
                  <Pencil size={14} /> Edit
                </button>
                <button
                  onClick={() => remove(plan.slug)}
                  className="btn-ghost inline-flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-white">{label}</span>
      {hint && <span className="ml-2 text-xs text-muted">{hint}</span>}
      {children}
    </label>
  );
}

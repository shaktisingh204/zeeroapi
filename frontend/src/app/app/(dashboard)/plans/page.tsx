"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { api } from "@/lib/api";
import type { Plan } from "@/lib/types";
import { PageHeader, Spinner, Card, Badge } from "@/components/ui";

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${cents / 100}/mo`;
}

function formatQuota(quota: number): string {
  return quota < 0 ? "Unlimited" : `${quota.toLocaleString()} req/mo`;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.plans().then(setPlans).finally(() => setLoading(false));
  }, []);

  if (loading && !plans) return <Spinner />;

  const sorted = [...(plans ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const popularIdx = Math.floor((sorted.length - 1) / 2);

  return (
    <div>
      <PageHeader title="Plans" subtitle="Subscription tiers for the public API" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sorted.map((plan, i) => {
          const popular = i === popularIdx;
          return (
            <Card
              key={plan.slug}
              className={popular ? "border-brand ring-1 ring-brand" : ""}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-white">{plan.name}</h2>
                {popular && <Badge variant="brand">Popular</Badge>}
              </div>

              <p className="mt-4 text-3xl font-semibold text-white">
                {formatPrice(plan.price_cents)}
              </p>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Rate limit</dt>
                  <dd className="text-white font-medium">
                    {plan.rate_limit_per_min}/min
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Monthly quota</dt>
                  <dd className="text-white font-medium">
                    {formatQuota(plan.monthly_quota)}
                  </dd>
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
            </Card>
          );
        })}
      </div>
    </div>
  );
}

import type { DatabaseClient } from "@workspace/db";
import { publicProfile } from "./profile";

type SnapPlan = { id: string; name: string; currency: string; pricingConfigured: boolean; monthlyPrice: string | null; yearlyPrice: string | null; setupFee: string | null; discountPercent: string; billingPeriods?: string[]; entitlements: { key: string; value: boolean | string }[]; profile?: unknown };
export type ContractSnapshot = ReturnType<typeof contractSnapshot>;

/** Full commercial contract (profile included, internal fields excluded); deep-copied. */
export function contractSnapshot(plan: SnapPlan, source: string, publishedRevision: string | null = null) {
  return JSON.parse(JSON.stringify({
    planId: plan.id, planName: plan.name, currency: plan.currency, pricingConfigured: plan.pricingConfigured,
    monthlyPrice: plan.monthlyPrice, yearlyPrice: plan.yearlyPrice, setupFee: plan.setupFee, discountPercent: plan.discountPercent,
    billingPeriods: plan.billingPeriods ?? [], entitlements: plan.entitlements.map(e => ({ key: e.key, value: e.value })),
    profile: publicProfile(plan.profile), source, publishedRevision,
  })) as { planId: string; planName: string; currency: string; pricingConfigured: boolean; monthlyPrice: string | null; yearlyPrice: string | null; setupFee: string | null; discountPercent: string; billingPeriods: string[]; entitlements: { key: string; value: boolean | string }[]; profile: ReturnType<typeof publicProfile>; source: string; publishedRevision: string | null };
}
export async function freezeContract(c: DatabaseClient, tenantId: string, plan: SnapPlan, source: string, publishedRevision: string | null = null) {
  await c.query("UPDATE tenant_subscriptions SET contract_snapshot=$2::jsonb,contract_frozen_at=now() WHERE tenant_id=$1", [tenantId, JSON.stringify(contractSnapshot(plan, source, publishedRevision))]);
}
export function readSnapshot(row: Record<string, unknown> | undefined): ContractSnapshot | null {
  const s = row?.contract_snapshot as ContractSnapshot | null | undefined;
  return s && Array.isArray(s.entitlements) ? s : null;
}

import { withDatabase } from "@workspace/db";
import { publishedOffers } from "../commerce/pricing-publication";
import { catalogTable } from "../../lib/catalog-scope";

/** Explicitly noncommercial previews reference existing plans, never a parallel
 * pricing store. An approved snapshot always wins over these draft proposals. */
export function publicPlanProposals() {
  return withDatabase({ actorId: "public:plan-proposals" }, async c => {
    const published = await publishedOffers(c);
    if (published.plans.length) return { plans: [], purchaseAvailable: false, proposal: true };
    const product = (await c.query(`SELECT m.definition->'publicMarketing'->'pricingTiers' tiers
      FROM module_catalog m JOIN landing_products l ON l.key=m.key
      WHERE m.key='crypto_exchange' AND l.visible=true`)).rows[0];
    if (!product) return { plans: [], purchaseAvailable: false, proposal: true };
    const tiers: { label: string; planId: string | null }[] = Array.isArray(product.tiers) ? product.tiers : [];
    const plans = [];
    for (const tier of tiers) {
      // Only explicitly selected, disabled, unapproved EUR proposals are public.
      // Enabling or configuring a plan removes it until it is properly published.
      if (!tier.planId || !/^[0-9a-f-]{36}$/i.test(tier.planId)) continue;
      const p = (await c.query(`SELECT id,name,description,monthly_price,yearly_price,setup_fee,currency
        FROM ${catalogTable("plans")} WHERE id=$1 AND status='disabled' AND pricing_configured=false AND currency='EUR'`, [tier.planId])).rows[0];
      if (!p) continue;
      const entitlements = (await c.query(`SELECT key,value FROM ${catalogTable("plan_entitlements")} WHERE plan_id=$1 ORDER BY key`, [p.id])).rows;
      plans.push({ id: p.id, name: tier.label, planName: p.name, description: p.description,
        monthlyPrice: p.monthly_price, yearlyPrice: p.yearly_price, setupFee: p.setup_fee, currency: p.currency,
        entitlements, pricingConfigured: false, billingPeriods: ["monthly","yearly"] });
    }
    return { plans, purchaseAvailable: false, proposal: true };
  });
}

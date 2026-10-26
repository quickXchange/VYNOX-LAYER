import { createHash } from "node:crypto";
import { publicPreparation } from "../../../../../lib/production-access-gate/public-preparation.mjs";
import { withDatabase, type DatabaseClient } from "@workspace/db";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/catalog-audit";
import { acceptanceCatalog, catalogTable } from "../../lib/catalog-scope";
import { publicProfile } from "../plan-management/profile";

function stable(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export const pricingRevision = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
/** Read compatibility only: never rewrite immutable legacy publication payloads. */
export function withPlanFeatureRows<T extends { plans: { featureRows?: { label: string; value: string }[] }[] }>(payload: T) {
  return { ...payload, plans: payload.plans.map(plan => ({ ...plan, featureRows: plan.featureRows ?? [], profile: publicProfile((plan as { profile?: unknown }).profile) })) };
}
export function assertPublicationRevision(actual: string, expected: string, published: string | null, expectedPublished: string | null) {
  if (actual !== expected || published !== expectedPublished) throw new HttpError(409, "Pricing revision conflict. Refresh the preview and review the new draft before publishing.");
}
export async function draftOffers(c: DatabaseClient) {
  const { whiteLabelCatalogForClient } = await import("../customer/order-catalog");
  const catalog = await whiteLabelCatalogForClient(c);
  // Contact-sales plans publish without prices; internal notes never publish.
  const plans = catalog.plans
    .filter(p => (p.pricingConfigured ? p.profile?.pricingMode !== "custom" && p.profile?.pricingMode !== "contact_sales" : p.profile?.pricingMode === "contact_sales" || p.profile?.pricingMode === "custom") && p.billingPeriods.length && p.profile?.visibility !== "hidden")
    .map(({ revision: _r, ...p }) => ({ ...p, profile: publicProfile(p.profile) }));
  const addons = catalog.addons.filter(a => a.pricingConfigured);
  const methods = acceptanceCatalog() || publicPreparation() ? [] : (await c.query("SELECT id,name,kind,currency FROM qxlayer_commerce.methods WHERE enabled AND approved ORDER BY name,id")).rows;
  return { plans, addons, methods, purchaseAvailable: plans.some(p => methods.some(m => m.currency === p.currency)) };
}
export async function publishedOffers(c: DatabaseClient): Promise<Awaited<ReturnType<typeof draftOffers>>> {
  const row = (await c.query<{payload:Awaited<ReturnType<typeof draftOffers>>}>(`SELECT payload FROM ${catalogTable("pricing_publication")} WHERE singleton=true`)).rows[0];
  if (!row && acceptanceCatalog()) throw new HttpError(503, "Acceptance pricing has not been published.");
  const payload = withPlanFeatureRows(row?.payload ?? await draftOffers(c));
  return acceptanceCatalog() || publicPreparation() ? { ...payload, methods: [], purchaseAvailable: false } : payload;
}
export async function freezePricingBeforeEdit(c: DatabaseClient) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('pricing-publication',0))");
  if ((await c.query(`SELECT singleton FROM ${catalogTable("pricing_publication")} WHERE singleton=true`)).rowCount) return;
  const payload = await draftOffers(c);
  await c.query(`INSERT INTO ${catalogTable("pricing_publication")}(singleton,payload,revision) VALUES(true,$1,$2) ON CONFLICT DO NOTHING`, [JSON.stringify(payload), pricingRevision(payload)]);
}
export function pricingPublication(p: Principal, input?: {expectedRevision: string; expectedPublishedRevision: string | null; reason: string}) {
  requireSuperAdmin(p);
  return withDatabase(contextFor(p, undefined, !!input), async c => {
    if (input) await c.query("SELECT pg_advisory_xact_lock(hashtextextended('pricing-publication',0))");
    const draft = await draftOffers(c);
    const current = (await c.query(`SELECT revision,payload,published_at FROM ${catalogTable("pricing_publication")} WHERE singleton=true`)).rows[0];
    const draftRevision = pricingRevision(draft);
    if (input) {
      assertPublicationRevision(draftRevision, input.expectedRevision, current?.revision ?? null, input.expectedPublishedRevision);
      await c.query(`INSERT INTO ${catalogTable("pricing_publication")}(singleton,payload,revision) VALUES(true,$1,$2)
        ON CONFLICT(singleton) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,published_at=now()`, [JSON.stringify(draft), draftRevision]);
      const { recordVersion } = await import("../plan-management/service");
      await recordVersion(c, p, draft, draftRevision, input.reason);
      await audit(c, p, null, "pricing.published", input.reason, { beforeRevision: current?.revision ?? null, revision:draftRevision, paymentsActivated:false });
      return { draftRevision, publishedRevision:draftRevision, publishedAt:new Date().toISOString(), draft, published:draft };
    }
    return { draftRevision, publishedRevision:current?.revision ?? null, publishedAt:current?.published_at?.toISOString() ?? null, draft, published:withPlanFeatureRows(current?.payload ?? draft) };
  });
}

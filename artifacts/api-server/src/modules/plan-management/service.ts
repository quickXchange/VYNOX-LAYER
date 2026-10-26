import { withDatabase, type DatabaseClient } from "@workspace/db";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/catalog-audit";
import { assertCatalogOperationAllowed, catalogTable } from "../../lib/catalog-scope";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { draftOffers, freezePricingBeforeEdit, pricingRevision, publishedOffers } from "../commerce/pricing-publication";
import { freezeContract, readSnapshot } from "./contracts";
import { applyPlanPolicy } from "./effective-policy";

export function planHistory(p: Principal, planId: string) {
  requireSuperAdmin(p);
  return withDatabase(contextFor(p), async c => (await c.query(
    `SELECT id,actor_id AS "actorId",event_type AS "eventType",description,metadata,created_at AS "createdAt" FROM ${catalogTable("catalog_audit_events")}
     WHERE event_type LIKE 'plan.%' AND (metadata->>'planId'=$1 OR metadata->>'sourceId'=$1 OR metadata->'after'->>'id'=$1) ORDER BY created_at DESC LIMIT 200`, [planId])).rows);
}

export function reorderPlans(p: Principal, refs: { id: string; revision: number }[]) {
  requireSuperAdmin(p);
  return withDatabase(contextFor(p, undefined, true), async c => {
    await freezePricingBeforeEdit(c);
    const existing = (await c.query(`SELECT id,display_order,revision FROM ${catalogTable("plans")} ORDER BY display_order,name,id FOR UPDATE`)).rows as { id: string; display_order: number; revision: number }[];
    const cur = new Map(existing.map(e => [e.id, e]));
    if (refs.length !== existing.length || new Set(refs.map(r => r.id)).size !== refs.length || refs.some(r => cur.get(r.id)?.revision !== r.revision))
      throw new HttpError(409, "Plans changed since you loaded them. Refresh and reorder again.");
    for (const [i, r] of refs.entries()) await c.query(`UPDATE ${catalogTable("plans")} SET display_order=$2,revision=revision+1,updated_at=now(),updated_by=$3 WHERE id=$1 AND display_order<>$2`, [r.id, (i + 1) * 10, p.userId]);
    await audit(c, p, null, "plan.reordered", "Reordered plans (draft; publish to apply publicly)", { before: existing.map(e => e.id), after: refs.map(r => r.id) });
    return { ok: true };
  });
}

async function versions(c: DatabaseClient) {
  return (await c.query(`SELECT id,revision,reason,published_by AS "publishedBy",rollback_of AS "rollbackOf",published_at AS "publishedAt",
    jsonb_array_length(payload->'plans') AS "planCount" FROM ${catalogTable("pricing_publication_versions")} ORDER BY published_at DESC LIMIT 100`)).rows;
}
export function publicationVersions(p: Principal) {
  requireSuperAdmin(p);
  return withDatabase(contextFor(p), async c => {
    const current = (await c.query(`SELECT revision FROM ${catalogTable("pricing_publication")} WHERE singleton=true`)).rows[0];
    return { currentRevision: current?.revision ?? null, versions: await versions(c) };
  });
}
export function publicationVersion(p: Principal, id: string) {
  requireSuperAdmin(p);
  return withDatabase(contextFor(p), async c => {
    const r = (await c.query(`SELECT id,revision,payload,reason,published_at AS "publishedAt" FROM ${catalogTable("pricing_publication_versions")} WHERE id=$1`, [id])).rows[0];
    if (!r) throw new HttpError(404, "Publication version not found.");
    return r;
  });
}
/** Recorded on every publication by the pricing publication service. */
export async function recordVersion(c: DatabaseClient, p: Principal, payload: unknown, revision: string, reason: string, rollbackOf: string | null = null) {
  await c.query(`INSERT INTO ${catalogTable("pricing_publication_versions")}(revision,payload,reason,published_by,rollback_of) VALUES($1,$2::jsonb,$3,$4,$5)`, [revision, JSON.stringify(payload), reason, p.userId, rollbackOf]);
}
export function rollbackPublication(p: Principal, id: string, input: { expectedPublishedRevision: string | null; reason: string }) {
  requireSuperAdmin(p);
  return withDatabase(contextFor(p, undefined, true), async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('pricing-publication',0))");
    const current = (await c.query(`SELECT revision FROM ${catalogTable("pricing_publication")} WHERE singleton=true`)).rows[0];
    if ((current?.revision ?? null) !== input.expectedPublishedRevision) throw new HttpError(409, "Publication changed. Refresh before rolling back.");
    const v = (await c.query(`SELECT revision,payload FROM ${catalogTable("pricing_publication_versions")} WHERE id=$1`, [id])).rows[0];
    if (!v) throw new HttpError(404, "Publication version not found.");
    // Rolled-back plans must still exist; payload is a historical snapshot and never edits catalog rows.
    await c.query(`INSERT INTO ${catalogTable("pricing_publication")}(singleton,payload,revision) VALUES(true,$1,$2)
      ON CONFLICT(singleton) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,published_at=now()`, [JSON.stringify(v.payload), v.revision]);
    await recordVersion(c, p, v.payload, v.revision, input.reason, id);
    await audit(c, p, null, "pricing.rolled_back", input.reason, { versionId: id, beforeRevision: current?.revision ?? null, revision: v.revision, paymentsActivated: false });
    return { publishedRevision: v.revision };
  });
}
/** Live draft preview identical to what publication would store. */
export function draftPreview(p: Principal) {
  requireSuperAdmin(p);
  return withDatabase(contextFor(p), async c => { const d = await draftOffers(c); return { revision: pricingRevision(d), draft: d }; });
}

type Diff = { key: string; current: unknown; target: unknown };
type PubPlan = Awaited<ReturnType<typeof publishedOffers>>["plans"][number];
const pricesOf = (x: { monthlyPrice: string | null; yearlyPrice: string | null; setupFee: string | null; currency: string }) => ({ monthlyPrice: x.monthlyPrice, yearlyPrice: x.yearlyPrice, setupFee: x.setupFee, currency: x.currency });

function contractFields(x: { entitlements: { key: string; value: boolean | string }[]; profile?: any; discountPercent?: string; billingPeriods?: string[] }) {
  const features: Record<string, boolean> = {}, limits: Record<string, string> = {};
  for (const e of x.entitlements) {
    if (typeof e.value === "boolean") features[e.key] = e.value;
    else limits[e.key] = e.value;
  }
  applyPlanPolicy(x.profile, features, limits, {});
  return new Map<string, unknown>([
    ...Object.entries(features).map(([k,v]) => [`access.${k}`,v] as [string, unknown]),
    ...Object.entries(limits).map(([k,v]) => [`limit.${k}`,v] as [string, unknown]),
    ['billing.discountPercent', x.discountPercent ?? '0'],
    ['billing.periods', JSON.stringify(x.billingPeriods ?? [])],
    ...Object.entries(x.profile ?? {}).map(([k,v]) => [`contract.${k}`, typeof v === 'object' ? JSON.stringify(v) : v] as [string, unknown]),
  ]);
}

/** Preview against the PUBLISHED target only; the token binds confirm to this exact state. */
async function buildPreview(c: DatabaseClient, fromPlanId: string, toPlanId: string) {
  const pubRow = (await c.query(`SELECT revision FROM ${catalogTable("pricing_publication")} WHERE singleton=true`)).rows[0];
  if (!pubRow) throw new HttpError(409, "Nothing is published yet. Publish the target plan before moving customers.");
  const published = await publishedOffers(c);
  const target = published.plans.find(x => x.id === toPlanId) as PubPlan | undefined;
  if (!target) throw new HttpError(409, "The target plan is not in the current publication. Publish it first.");
  const subs = (await c.query(`SELECT s.*,t.name AS tenant_name FROM tenant_subscriptions s JOIN tenants t ON t.id=s.tenant_id WHERE s.plan_id=$1 ORDER BY t.name,t.id`, [fromPlanId])).rows;
  const tgt = contractFields(target);
  const subscribers = subs.map(s => {
    const snap = readSnapshot(s);
    const cur = contractFields(snap ?? { entitlements: [] });
    const keys = [...new Set([...cur.keys(), ...tgt.keys()])].sort();
    const entitlementChanges: Diff[] = keys.filter(k => JSON.stringify(cur.get(k) ?? null) !== JSON.stringify(tgt.get(k) ?? null)).map(k => ({ key: k, current: cur.get(k) ?? null, target: tgt.get(k) ?? null }));
    const priceChanged = !snap || snap.monthlyPrice !== target.monthlyPrice || snap.yearlyPrice !== target.yearlyPrice || snap.setupFee !== target.setupFee || snap.currency !== target.currency || entitlementChanges.some(d => d.key.startsWith('billing.') || /^contract.(fixedDiscountAmount|promoPrice|promoStartsAt|promoEndsAt|pricingMode|trialDays)$/.test(d.key));
    return { tenantId: s.tenant_id as string, tenantName: s.tenant_name as string, frozen: !!snap, frozenAt: s.contract_frozen_at ? new Date(s.contract_frozen_at).toISOString() : null,
      contractPlanName: snap?.planName ?? null, currentPrices: snap ? pricesOf(snap) : null, priceChanged, entitlementChanges, _snap: snap };
  });
  const previewToken = pricingRevision({ from: fromPlanId, publishedRevision: pubRow.revision, target, subs: subscribers.map(x => ({ id: x.tenantId, snap: x._snap })) });
  return { previewToken, publishedRevision: pubRow.revision as string, targetPlan: target,
    target: { id: target.id, name: target.name, prices: pricesOf(target) }, subscribers: subscribers.map(({ _snap, ...x }) => x) };
}
export function migrationPreview(p: Principal, fromPlanId: string, toPlanId: string) {
  // Operational subscription data never leaves through the Acceptance runtime.
  assertCatalogOperationAllowed("subscription migration preview");
  requireSuperAdmin(p);
  return withDatabase(contextFor(p), async c => { const { targetPlan: _t, ...out } = await buildPreview(c, fromPlanId, toPlanId); return out; });
}
export function migrateSubscriptions(p: Principal, fromPlanId: string, input: { toPlanId: string; tenantIds: string[]; reason: string; previewToken: string }) {
  assertCatalogOperationAllowed("subscription migration");
  requireSuperAdmin(p);
  return withDatabase(contextFor(p, undefined, true), async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('pricing-publication',0))");
    const ids = [...new Set(input.tenantIds)].sort();
    for (const id of ids) await c.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [id]);
    await c.query("SELECT tenant_id FROM tenant_subscriptions WHERE plan_id=$1 ORDER BY tenant_id FOR UPDATE", [fromPlanId]);
    const pv = await buildPreview(c, fromPlanId, input.toPlanId);
    if (pv.previewToken !== input.previewToken) throw new HttpError(409, "Prices, publication or customer contracts changed since the preview. Review the new preview before confirming.");
    const target = pv.targetPlan;
    if (ids.some(id => !pv.subscribers.some(s => s.tenantId === id))) throw new HttpError(409, "A selected subscription is no longer on this plan.");
    const moved: string[] = [];
    for (const tenantId of ids) {
      const s = (await c.query("SELECT * FROM tenant_subscriptions WHERE tenant_id=$1", [tenantId])).rows[0];
      if (s.trial) throw new HttpError(409, "Trial contracts cannot be changed by a bulk plan migration. Arrange a separate reviewed renewal agreement.");
      const addonCur = (await c.query("SELECT DISTINCT a.currency FROM tenant_addons t JOIN addons a ON a.id=t.addon_id WHERE t.tenant_id=$1", [tenantId])).rows;
      if (addonCur.some(r => r.currency !== target.currency)) throw new HttpError(409, "A selected customer has add-ons in another currency.");
      await c.query("UPDATE tenant_subscriptions SET plan_id=$2,updated_at=now() WHERE tenant_id=$1", [tenantId, target.id]);
      await freezeContract(c, tenantId, target, `migration:${fromPlanId}`, pv.publishedRevision);
      await audit(c, p, tenantId, "plan.subscription_migrated", input.reason, { planId: fromPlanId, targetPlanId: target.id, publishedRevision: pv.publishedRevision, previewToken: input.previewToken, beforeContract: readSnapshot(s), billingPerformed: false });
      moved.push(tenantId);
    }
    return { moved };
  });
}

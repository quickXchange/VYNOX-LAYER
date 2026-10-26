/**
 * Development-only, data-safe DB verification for plan management.
 * Everything runs inside ONE outer transaction that is always ROLLED BACK:
 * service transactions become savepoints. Nothing is committed or published.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type { Principal } from "../modules/authentication/service";
import { getPlan, listPlans, savePlan, changePlanStatus, deleteCatalogRecord, duplicatePlan } from "../modules/entitlements/catalog";
import { pricingPublication, publishedOffers } from "../modules/commerce/pricing-publication";
import { migrateSubscriptions, migrationPreview, publicationVersions, reorderPlans } from "../modules/plan-management/service";
import { resolveEntitlements } from "../modules/entitlements/resolver";
import { submitRequest } from "../modules/customer/service";
import { catalogSelection } from "../modules/customer/order-catalog";
import { invoicePricing } from "../modules/commerce/pricing";
import { publicOffers } from "../modules/commerce/service";
import { publicProductCatalog } from "../modules/landing-catalog/service";
import { draftOffers } from "../modules/commerce/pricing-publication";
import { randomUUID } from "node:crypto";

if (process.env.NODE_ENV === "production" || process.env.QXLAYER_EXTERNAL_ENVIRONMENT !== "development" || !process.env.REPLIT_DEV_DOMAIN) throw new Error("Development only.");
const admin: Principal = { userId: "verify:plan-management", role: "super_admin", memberships: [] };
const client = await pool.connect();
if ((await client.query("SELECT current_database() AS d")).rows[0].d !== "heliumdb") throw new Error("Unexpected database.");
let sp = 0;
const wrapped = new Proxy(client, { get(t, k) {
  if (k === "release") return () => {};
  if (k === "query") return (text: any, ...rest: any[]) => {
    if (typeof text === "string") {
      if (/^\s*BEGIN\b[^;]*/i.test(text)) text = text.replace(/^\s*BEGIN\b[^;]*/i, `SAVEPOINT s${++sp}`);
      else if (/^\s*COMMIT\s*;?\s*$/i.test(text)) text = `RELEASE SAVEPOINT s${sp--}`;
      else if (/^\s*ROLLBACK\s*;?\s*$/i.test(text)) text = `ROLLBACK TO SAVEPOINT s${sp}; RELEASE SAVEPOINT s${sp--}`;
    }
    return (t.query as any)(text, ...rest);
  };
  const v = (t as any)[k]; return typeof v === "function" ? v.bind(t) : v;
} });
(pool as any).connect = async () => wrapped;
const status = async (fn: () => Promise<unknown>, code: number, label: string) => {
  try { await fn(); } catch (e: any) { assert.equal(e?.status, code, `${label}: expected ${code}, got ${e?.status} ${e?.message}`); return void ok(label); }
  assert.fail(`${label}: expected ${code}, succeeded`);
};
const results: string[] = []; const ok = (s: string) => { results.push(s); console.log("PASS", s); };
const q = (s: string, a: unknown[] = []) => client.query(s, a);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const snapshots = async () => hash((await q("SELECT tenant_id,plan_id,contract_snapshot,contract_frozen_at FROM tenant_subscriptions ORDER BY tenant_id")).rows);
const sqlFile = (f: string) => readFileSync(new URL(`../../../../lib/db/migrations/${f}`, import.meta.url), "utf8").replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "");

await q("BEGIN");
try {
  // 1. Applied state.
  const plans = (await q("SELECT id,name,status,profile->>'slug' AS slug,revision FROM plans ORDER BY display_order")).rows;
  assert.deepEqual(plans.filter(p => p.status === "enabled").map(p => p.slug), ["starter", "standard", "premium"]); ok("exactly Starter/Standard/Premium enabled");
  const subs = (await q("SELECT count(*)::int AS n, count(*) FILTER (WHERE contract_snapshot IS NULL)::int AS open FROM tenant_subscriptions")).rows[0];
  assert.equal(subs.open, 0); ok(`all ${subs.n} subscriptions frozen`);
  const versionsAtStart = (await q("SELECT count(*)::int n FROM qxlayer_commerce.pricing_publication_versions")).rows[0].n;
  assert.ok(versionsAtStart >= 1); ok("baseline publication version recorded");

  // 2. Rerun stability (schema + seed).
  const before = { snaps: await snapshots(), plans: hash((await q("SELECT id,name,status,profile,revision,display_order FROM plans ORDER BY id")).rows), pub: (await q("SELECT revision FROM qxlayer_commerce.pricing_publication")).rows[0]?.revision };
  await q(sqlFile("plan-management-profiles.sql")); await q(sqlFile("plan-management-seed.sql"));
  assert.equal(await snapshots(), before.snaps); assert.equal(hash((await q("SELECT id,name,status,profile,revision,display_order FROM plans ORDER BY id")).rows), before.plans);
  assert.equal((await q("SELECT count(*)::int n FROM qxlayer_commerce.pricing_publication_versions")).rows[0].n, versionsAtStart);
  ok("schema + seed rerun is a no-op (plans, contracts, versions, publication)");

  // 3. Legacy contracts keep legacy rules (no profile policy applied).
  for (const t of (await q("SELECT tenant_id FROM tenant_subscriptions WHERE COALESCE(contract_snapshot->'profile'->>'slug','')='' LIMIT 3")).rows) {
    const e = await resolveEntitlements(client as any, t.tenant_id);
    assert.ok(!("powered_by_footer" in e.features) && !("max_languages" in e.limits));
  }
  ok("empty-profile contracts resolve without plan-profile policy");

  // 4. Revision safety and billing coherence.
  const std = plans.find(p => p.slug === "standard")!;
  const cur = await getPlan(admin, std.id);
  const { revision: _r, id: _i, ...input } = cur as any;
  await status(() => savePlan(admin, { ...input, tagline: "x" }, std.id), 428, "update without revision rejected");
  await status(() => savePlan(admin, { ...input, expectedRevision: cur.revision - 1 }, std.id), 409, "stale update rejected");
  await status(() => changePlanStatus(admin, std.id, "disabled", undefined), 428, "status without revision rejected");
  await status(() => deleteCatalogRecord(admin, std.id, "plan", cur.revision + 5), 409, "stale delete rejected");
  const all = await listPlans(admin);
  await status(() => reorderPlans(admin, all.map(p => ({ id: p.id, revision: p.revision + 1 }))), 409, "stale reorder rejected");
  await status(() => savePlan(admin, { ...input, expectedRevision: cur.revision, monthlyPrice: "10.00", yearlyPrice: "100.00", setupFee: "0.00" }, std.id), 400, "contact-sales plan with prices rejected");
  await status(() => savePlan(admin, { ...input, expectedRevision: cur.revision, profile: { ...cur.profile, pricingMode: "paid", fixedDiscountAmount: "60.00" }, monthlyPrice: "50.00", yearlyPrice: "500.00", setupFee: "0.00" }, std.id), 400, "fixed discount not lower than price rejected");
  await status(() => savePlan(admin, { ...input, expectedRevision: cur.revision, profile: { ...cur.profile, trialDays: 14 } }, std.id), 400, "trial rejected");

  // 5. Drafts never change the public snapshot or existing contracts; internal fields never public.
  await q("SAVEPOINT edit5");
  const pubBefore = hash(await publishedOffers(client as any)); const snapsBefore = await snapshots();
  const edited = await savePlan(admin, { ...input, expectedRevision: cur.revision, profile: { ...cur.profile, tagline: "Draft-only tagline", internalNotes: "SECRET-NOTE", internalName: "SECRET-NAME", pricingMode: "paid" }, monthlyPrice: "99.00", yearlyPrice: "990.00", setupFee: "0.00" }, std.id);
  assert.equal(edited.revision, cur.revision + 1);
  assert.equal(hash(await publishedOffers(client as any)), pubBefore); assert.equal(await snapshots(), snapsBefore);
  ok("draft edit (incl. price change) leaves publication and all contracts unchanged");
  const preview = await pricingPublication(admin);
  assert.ok(!JSON.stringify(preview.draft).includes("SECRET-") && !JSON.stringify(preview.published).includes("SECRET-")); ok("internal name/notes absent from draft preview and publication");
  const dup = await duplicatePlan(admin, std.id);
  assert.equal(dup.status, "disabled"); assert.ok(!dup.profile?.slug); ok("duplicate is disabled and slug-free");
  await q("ROLLBACK TO SAVEPOINT edit5");

  // 6. Migration: published-only target, token-bound, price protection.
  const pubPlans = (await publishedOffers(client as any)).plans.map(p => p.id);
  const premium = plans.find(p => p.slug === "premium")!;
  const fromRow = (await q("SELECT s.plan_id, s.tenant_id FROM tenant_subscriptions s WHERE NOT EXISTS (SELECT 1 FROM tenant_addons t JOIN addons a ON a.id=t.addon_id WHERE t.tenant_id=s.tenant_id AND a.currency<>'EUR') LIMIT 1")).rows[0];
  const from = fromRow.plan_id;
  if (!pubPlans.includes(premium.id)) await status(() => migrationPreview(admin, from, premium.id), 409, "unpublished target refused");
  // Publication inside the outer transaction is never committed (rolled back below).
  const draftNow = await pricingPublication(admin);
  await pricingPublication(admin, { expectedRevision: draftNow.draftRevision, expectedPublishedRevision: draftNow.publishedRevision, reason: "verification (rolled back)" });
  const pubTarget = (await publishedOffers(client as any)).plans.some(p => p.id === premium.id) ? premium.id : undefined;
  assert.ok(pubTarget, "premium published in-transaction"); assert.ok(!JSON.stringify(await publishedOffers(client as any)).includes("SECRET-")); ok("in-transaction publication excludes internal fields");
  if (pubTarget) {
    const pv = await migrationPreview(admin, from, pubTarget);
    const tenant = fromRow.tenant_id as string;
    await status(() => migrateSubscriptions(admin, from, { toPlanId: pubTarget, tenantIds: [tenant], reason: "verify", previewToken: pv.previewToken.replace(/./, c => c === 'a' ? 'b' : 'a') }), 409, "tampered token refused");
    assert.ok(tenant, "a subscriber exists to migrate");
    {
      await status(() => migrateSubscriptions(admin, from, { toPlanId: pubTarget, tenantIds: [tenant], reason: "verify", previewToken: "0".repeat(64) }), 409, "migration with wrong token refused");
      const others = hash((await q("SELECT tenant_id,contract_snapshot FROM tenant_subscriptions WHERE tenant_id<>$1 ORDER BY tenant_id", [tenant])).rows);
      await migrateSubscriptions(admin, from, { toPlanId: pubTarget, tenantIds: [tenant], reason: "verify (rolled back)", previewToken: pv.previewToken });
      const snap = (await q("SELECT contract_snapshot s FROM tenant_subscriptions WHERE tenant_id=$1", [tenant])).rows[0].s;
      assert.equal(snap.planId, pubTarget); assert.equal(snap.monthlyPrice, pv.target.prices.monthlyPrice); assert.ok(!JSON.stringify(snap).includes("SECRET-"));
      assert.equal(hash((await q("SELECT tenant_id,contract_snapshot FROM tenant_subscriptions WHERE tenant_id<>$1 ORDER BY tenant_id", [tenant])).rows), others);
      assert.equal(snap.profile?.slug, "premium"); assert.equal(snap.publishedRevision?.length, 64);
      ok("migration freezes PUBLISHED target (prices, profile, revision); other contracts untouched");
      const e = await resolveEntitlements(client as any, tenant);
      assert.equal(e.features.powered_by_footer, false); assert.equal(e.features.fiat_ramps, false); assert.equal(e.limits.max_languages, "1");
      ok("migrated profile contract resolves through effective policy");
      await status(() => migrateSubscriptions(admin, from, { toPlanId: pubTarget, tenantIds: [tenant], reason: "verify", previewToken: pv.previewToken }), 409, "replayed token refused after state change");
    }
  }

  // 8. Public offering, contact-sales request path, exclusions, billing availability, promo/fixed pricing.
  const offers = await publicOffers();
  assert.deepEqual(offers.plans.map((p: any) => p.profile?.slug).sort(), ["premium", "standard", "starter"]);
  assert.ok(offers.plans.every((p: any) => p.monthlyPrice === null && p.profile.pricingMode === "contact_sales"));
  assert.ok(offers.plans.flatMap((p: any) => p.profile.capabilities).filter((c: any) => ["pair_markup", "fiat_ramps", "best_rate_routing", "multi_admin_roles"].includes(c.key)).every((c: any) => c.availability === "unavailable"));
  ok("public offers: exactly the 3 tiers, contact sales, unsupported services shown unavailable");
  const landing = await publicProductCatalog();
  assert.equal(landing.products.find((p: any) => p.key === "crypto_exchange")?.startingPrice ?? null, null); ok("landing catalog has no fabricated starting price for contact-sales tiers");
  const customer: Principal = { userId: `verify:customer-${randomUUID()}`, role: "unassigned", memberships: [] };
  const req = (planId: string, billingPeriod: "monthly" | "yearly" = "monthly") => submitRequest(customer, { projectName: "Verify Contact", brandName: "Verify Contact", preferredDomain: "verify-contact.example.test", actions: ["convert"], details: "verification (rolled back)", requestedPlanId: planId, billingPeriod, idempotencyKey: randomUUID() });
  const order: any = await req(std.id);
  const stored = (await q("SELECT configuration FROM white_label_requests WHERE id=$1", [order.id])).rows[0].configuration;
  assert.equal(stored.catalogSnapshot.plan.id, std.id); assert.ok(stored.pricedAt); assert.ok(!JSON.stringify(stored).includes("SECRET-"));
  assert.throws(() => invoicePricing(stored), /provisional/);
  ok("contact-sales request is accepted and snapshotted, but never priced for payment");
  const starterId = plans.find(p => p.slug === "starter")!.id;
  await q("SELECT set_config('app.is_super_admin','true',true), set_config('app.can_write','true',true)");
  await q("INSERT INTO qxlayer_commerce.offer_settings(plan_id,monthly,yearly) VALUES($1,false,true) ON CONFLICT(plan_id) DO UPDATE SET monthly=false,yearly=true", [starterId]);
  assert.deepEqual((await draftOffers(client as any)).plans.find(p => p.id === starterId)?.billingPeriods, ["yearly"]);
  const pub = async () => { const d = await pricingPublication(admin); await pricingPublication(admin, { expectedRevision: d.draftRevision, expectedPublishedRevision: d.publishedRevision, reason: "verification (rolled back)" }); };
  await req(starterId, "monthly"); ok("unpublished period change does not affect the live offer");
  await pub();
  await status(() => req(starterId, "monthly"), 409, "published disabled billing period refused on request");
  await q("UPDATE qxlayer_commerce.offer_settings SET yearly=false WHERE plan_id=$1", [starterId]);
  assert.ok(!(await draftOffers(client as any)).plans.some(p => p.id === starterId));
  await pub(); await status(() => req(starterId, "yearly"), 409, "plan with no billing period excluded from offers and requests");
  const prem = await getPlan(admin, premium.id); const { revision: _pr, id: _pi, ...pin } = prem as any;
  await savePlan(admin, { ...pin, expectedRevision: prem.revision, profile: { ...prem.profile, visibility: "hidden" } }, premium.id);
  assert.ok(!(await draftOffers(client as any)).plans.some(p => p.id === premium.id));
  await pub(); assert.ok(!(await publicOffers()).plans.some((p: any) => p.id === premium.id));
  await status(() => req(premium.id), 409, "hidden plan excluded from public offers and requests");
  await q("SELECT set_config('app.is_super_admin','true',true),set_config('app.can_write','true',true)");
  const sampleAddon = (await q("INSERT INTO public.addons(name,monthly_price,yearly_price,pricing_configured,pricing_confirmed) VALUES('Disposable preservation check',25,250,true,true) RETURNING id")).rows[0];
  const sampleTenant = (await q("SELECT tenant_id FROM public.tenant_subscriptions ORDER BY tenant_id LIMIT 1")).rows[0];
  assert.ok(sampleAddon && sampleTenant, "add-on preservation requires fixtures");
  await q("INSERT INTO public.tenant_addons(tenant_id,addon_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [sampleTenant.tenant_id, sampleAddon.id]);
  const readAgreement = async () => (await q("SELECT contract_snapshot FROM public.tenant_addons WHERE tenant_id=$1 AND addon_id=$2", [sampleTenant.tenant_id, sampleAddon.id])).rows[0].contract_snapshot;
  const originalAddon = await readAgreement();
  assert.ok(originalAddon);
  await q("UPDATE public.addons SET monthly_price=99999 WHERE id=$1", [sampleAddon.id]);
  assert.deepEqual(await readAgreement(), originalAddon);
  const effectiveAddon = (await resolveEntitlements(client as any, sampleTenant.tenant_id)).addons.find(a => a.id === sampleAddon.id);
  assert.equal(effectiveAddon?.monthlyPrice, originalAddon.monthlyPrice);
  ok("catalog add-on edits leave assignment agreement and effective recurring price unchanged");
  const stdNow = await getPlan(admin, std.id);
  await changePlanStatus(admin, std.id, "disabled", stdNow.revision);
  await req(std.id);
  ok("unpublished disable does not interrupt the published offer");
  await pub();
  await status(() => req(std.id), 409, "published disable removes plan from requests");
  const archived = plans.find(p => p.status === "archived")!;
  await status(() => req(archived.id), 409, "unpublished archived plan cannot be requested");
  // Fixed discount + promotion through the real save -> publish -> order -> invoice path.
  const ents = (await getPlan(admin, starterId)).entitlements;
  const now = Date.now();
  const mk = (name: string, profile: Record<string, unknown>) => savePlan(admin, { name, description: "verification (rolled back)", currency: "EUR", billingLabel: "", displayOrder: 99, status: "enabled", monthlyPrice: "50.00", yearlyPrice: "500.00", setupFee: "10.00", discountPercent: "0", entitlements: ents, profile: { pricingMode: "paid", billingInterval: "monthly_and_yearly", ...profile } } as any);
  const fixedPlan = await mk("Verify Fixed", { fixedDiscountAmount: "7.50" });
  const promoPlan = await mk("Verify Promo", { promoPrice: "19.99", promoStartsAt: new Date(now - 3600e3).toISOString(), promoEndsAt: new Date(now + 3600e3).toISOString() });
  const d2 = await pricingPublication(admin);
  await pricingPublication(admin, { expectedRevision: d2.draftRevision, expectedPublishedRevision: d2.publishedRevision, reason: "verification (rolled back)" });
  for (const [pl, period, want] of [[fixedPlan, "monthly", "42.50"], [fixedPlan, "yearly", "492.50"], [promoPlan, "monthly", "19.99"], [promoPlan, "yearly", "500.00"]] as const) {
    const o: any = await req(pl.id, period);
    const cfg = (await q("SELECT configuration FROM white_label_requests WHERE id=$1", [o.id])).rows[0].configuration;
    const live = await catalogSelection(client as any, pl.id, []);
    assert.equal(invoicePricing({ ...cfg, catalogSnapshot: live }).recurring, want, `${pl.name} ${period}`);
    assert.equal(invoicePricing(cfg).recurring, want);
  }
  const late = { ...(await q("SELECT configuration FROM white_label_requests WHERE configuration->'catalogSnapshot'->'plan'->>'id'=$1 AND configuration->>'billingPeriod'='monthly' LIMIT 1", [promoPlan.id])).rows[0].configuration, pricedAt: new Date(now + 7200e3).toISOString() };
  assert.equal(invoicePricing(late).recurring, "50.00");
  ok("fixed discount and promotion window priced identically by order snapshot and live invoice path; expired window reverts");

  // 7. Role denial.
  const clientAdmin: Principal = { userId: "verify:client", role: "client_admin", memberships: [] };
  await status(() => savePlan(clientAdmin, input, std.id), 403, "client admin cannot edit plans");
  await status(() => publicationVersions(clientAdmin), 403, "client admin cannot read versions");
  await status(() => migrationPreview(clientAdmin, from, premium.id), 403, "client admin cannot preview migrations");
  for (const role of ["qxlayer_public_app", "anon", "authenticated"]) {
    if (!(await q("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) continue;
    await q("SAVEPOINT r");
    const priv = (await q("SELECT has_table_privilege($1,'qxlayer_commerce.pricing_publication_versions','SELECT') s", [role])).rows[0].s;
    await q("ROLLBACK TO SAVEPOINT r");
    assert.equal(priv, false); ok(`${role} has no access to publication versions`);
  }
  for (const t of ["qxlayer_commerce.pricing_publication_versions", "qxlayer_acceptance_catalog.pricing_publication_versions"]) {
    if (!(await q("SELECT to_regclass($1) r", [t])).rows[0].r) { console.log("SKIP", t, "absent"); continue; }
    const r = (await q("SELECT relrowsecurity a, relforcerowsecurity f FROM pg_class WHERE oid=$1::regclass", [t])).rows[0];
    assert.ok(r.a && r.f); ok(`${t} RLS enabled+forced`);
  }
  await q("SAVEPOINT r"); await q("SET LOCAL ROLE pg_database_owner; SET LOCAL row_security=on"); await q("SELECT set_config('app.is_super_admin','false',true)");
  const visible = (await q("SELECT count(*)::int n FROM qxlayer_commerce.pricing_publication_versions")).rows[0].n;
  await q("ROLLBACK TO SAVEPOINT r");
  assert.equal(visible, 0); ok("development runtime role (pg_database_owner) without super-admin context sees no versions");
} finally {
  await q("ROLLBACK"); client.release(); await pool.end();
}
console.log(`\n${results.length} checks passed; outer transaction rolled back (no data changed).`);

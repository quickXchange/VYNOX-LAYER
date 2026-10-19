import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acceptanceCatalog, catalogTable, historicalCatalogTable, privateCatalogWriteRoute, assertCatalogOperationAllowed } from "./catalog-scope";
import { audit } from "./catalog-audit";
import { readPlan, readAddon } from "../modules/entitlements/catalog";
import { publishedOffers } from "../modules/commerce/pricing-publication";
import { changeTenantPlan, setTenantAddons, setTenantOverrides, setTenantSuspension, updateSubscriptionCommercial } from "../modules/entitlements/subscriptions";
import { checkout, saveMethod, deleteMethod, reportPayment, settle } from "../modules/commerce/service";
import { prepareReviewedWebsite } from "../modules/customer/preparation";
import { retryProvisioning, recordProvisioningFailure } from "../modules/customer/provisioning";
import { reviewRequest, deliverRequest, deliverLinkedRequest, submitRequest } from "../modules/customer/service";
import { prepareTenant, createTenant } from "../modules/tenants/service";
import { saveProduct } from "../modules/landing-catalog/service";
import { createPreparationIsolation } from "../middlewares/preparation-isolation";

const origin = "https://qxlayer-acceptance-vynox3.vercel.app";
const acceptance = {
  NODE_ENV: "production", QXLAYER_EXTERNAL_ENVIRONMENT: "production",
  QXLAYER_EXTERNAL_CANDIDATE: "true", QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED: "true",
  QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED: "false",
  QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION: "true", PRODUCTION_ACCESS_GATE_ENABLED: "true",
  QXLAYER_DATABASE_PROVIDER: "supabase", QXLAYER_AUTH_PROVIDER: "supabase",
  QXLAYER_PLATFORM_URL: origin, QXLAYER_PRODUCTION_SUPABASE_AUTH_URL: origin,
  QXLAYER_PUBLIC_PREPARATION_APPROVED: "false",
};
async function inAcceptance(work: () => unknown) {
  const before = { ...process.env };
  Object.assign(process.env, acceptance);
  try { await work(); }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}

test("only exact protected server configuration selects private catalog; partial markers fail closed", () => {
  assert.equal(acceptanceCatalog({}), false);
  assert.equal(acceptanceCatalog({ QXLAYER_EXTERNAL_ENVIRONMENT: "staging" }), false);
  assert.equal(acceptanceCatalog(acceptance), true);
  for (const key of Object.keys(acceptance).filter(key => key !== "QXLAYER_PUBLIC_PREPARATION_APPROVED")) {
    assert.throws(() => acceptanceCatalog({ ...acceptance, [key]: undefined }), /configuration is incomplete/);
  }
  for (const badOrigin of [origin + "/", origin + ".evil.test", "https://www.quicklychan.xyz"])
    assert.throws(() => acceptanceCatalog({ ...acceptance, QXLAYER_PLATFORM_URL: badOrigin }), /configuration is incomplete/);
  assert.throws(() => acceptanceCatalog({ ...acceptance, QXLAYER_PUBLIC_PREPARATION_APPROVED: "true" }), /configuration is incomplete/);
  assert.throws(() => acceptanceCatalog({ QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION: "true" }), /configuration is incomplete/);
});

test("identifiers are explicit, private and cannot be selected from user input; historical resolver remains public", async () => {
  await inAcceptance(() => {
    for (const table of ["plans", "addons", "plan_entitlements", "addon_entitlements", "offer_settings", "pricing_publication", "catalog_audit_events"] as const)
      assert.equal(catalogTable(table), `qxlayer_acceptance_catalog.${table}`);
    assert.equal(historicalCatalogTable("plans"), "public.plans");
    assert.equal(historicalCatalogTable("offer_settings"), "qxlayer_commerce.offer_settings");
    assert.throws(() => catalogTable("public.plans" as any), /Unknown catalog identifier/);
    assert.throws(() => catalogTable("__proto__" as any), /Unknown catalog identifier/);
    assert.throws(() => assertCatalogOperationAllowed("checkout"), /no operational changes/);
  });
});

test("missing private tables and rows never retry shared tables", async () => {
  await inAcceptance(async () => {
    for (const read of [
      (c: any) => readPlan(c, "plan-id"), (c: any) => readAddon(c, "addon-id"),
      (c: any) => publishedOffers(c),
    ]) {
      const seen: string[] = [];
      const missing = Object.assign(new Error("relation does not exist"), { code: "42P01" });
      const c = { query: async (sql: string) => {
        seen.push(sql);
        if (sql.includes("pg_advisory")) return { rows: [] };
        throw missing;
      } };
      await assert.rejects(() => read(c), error => error === missing);
      assert.ok(seen.some(sql => sql.includes("qxlayer_acceptance_catalog.")));
      assert.ok(seen.every(sql => !/\b(public|qxlayer_commerce)\./.test(sql)));
    }
    const seen: string[] = [];
    await assert.rejects(() => readPlan({ query: async (sql: string) => {
      seen.push(sql); return { rows: [], rowCount: 0 };
    } } as any, "missing"), /Plan not found/);
    assert.ok(seen.every(sql => !sql.includes("public.plans")));
  });
});

test("historical reads use public catalog even in Acceptance; private audit and publication cannot leak into shared tables", async () => {
  await inAcceptance(async () => {
    const seen: string[] = [];
    const c = { query: async (sql: string) => {
      seen.push(sql);
      if (sql.includes("SELECT * FROM public.plans")) return { rows: [{ id: "historical", pricing_configured: false }] };
      if (sql.includes("pricing_publication")) return { rows: [{ payload: { plans: [], addons: [], methods: [{ id: "live" }], purchaseAvailable: true } }] };
      return { rows: [] };
    } } as any;
    await readPlan(c, "historical", true);
    assert.ok(seen.some(sql => sql.includes("public.plan_entitlements")));
    assert.ok(seen.some(sql => sql.includes("qxlayer_commerce.offer_settings")));
    seen.length = 0;
    await audit(c, { userId: "operator" } as any, null, "plan.updated", "private");
    assert.match(seen[0], /INSERT INTO qxlayer_acceptance_catalog.catalog_audit_events/);
    assert.doesNotMatch(seen[0], /public.audit_events/);
    assert.deepEqual(await publishedOffers(c), { plans: [], addons: [], methods: [], purchaseAvailable: false });
  });
});

test("operational entrypoints reject before accessing principal, input, database, storage or provisioning services", async () => {
  await inAcceptance(async () => {
    const functions = [changeTenantPlan, setTenantAddons, setTenantOverrides, setTenantSuspension,
      updateSubscriptionCommercial, checkout, saveMethod, deleteMethod, reportPayment, settle,
      prepareReviewedWebsite, retryProvisioning, recordProvisioningFailure, reviewRequest,
      deliverRequest, deliverLinkedRequest, submitRequest, prepareTenant, createTenant, saveProduct];
    for (const fn of functions)
      await assert.rejects(async () => (fn as Function)(), /Acceptance catalog isolation/, fn.name);
    await assert.rejects(async () => submitRequest({} as any, {} as any, true), /not authorized/);
  });
});

test("middleware only admits private catalog writes and retains native route authorization", async () => {
  await inAcceptance(async () => {
    const id = "a4000000-0000-4000-8000-000000000001";
    for (const [method, path] of [
      ["POST", "/api/plans"], ["PUT", `/api/plans/${id}`], ["DELETE", `/api/add-ons/${id}`],
      ["POST", `/api/plans/${id}/duplicate`], ["PUT", `/api/plans/${id}/status`],
      ["POST", "/api/commerce/pricing-publication"], ["PUT", `/api/operator/phase1/plans/${id}/periods`],
      ["POST", `/api/operator/phase1/proposals/plan/${id}/approve`],
    ]) {
      assert.equal(privateCatalogWriteRoute(method, path), true);
      let continued = false;
      const middleware = createPreparationIsolation(() => { throw new Error("Native route authenticates catalog requests"); });
      await middleware({ method, path } as any, {} as any, error => { assert.equal(error, undefined); continued = true; });
      assert.equal(continued, true);
    }
    for (const path of ["/api/operator/phase1/methods", "/api/customer/phase1/checkout",
      `/api/tenants/${id}/subscription`, `/api/plans/${id}/unknown`, "/api/plans/../tenants",
      "/api/customer/white-label-requests", "/api/platform/settings"])
      assert.equal(privateCatalogWriteRoute("POST", path), false);
  });
});

test("standalone migration preserves shared objects, clones once, uses private FKs and session-user-pinned FORCE RLS", () => {
  const sql = readFileSync(new URL("../../../../deploy/migrations/0010_acceptance_catalog.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT)\s*;/m);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE FROM|ALTER TABLE|DROP TABLE|TRUNCATE)\s+(?:public|qxlayer_commerce)\./i);
  assert.doesNotMatch(sql, /(?:GRANT|REVOKE).*ON (?:SCHEMA )?(?:public|qxlayer_commerce)(?:\.|\s)/i);
  assert.doesNotMatch(sql, /CREATE SCHEMA IF NOT EXISTS/);
  for (const table of ["plans", "addons", "plan_entitlements", "addon_entitlements", "offer_settings", "pricing_publication"])
    assert.match(sql, new RegExp(`CREATE TABLE qxlayer_acceptance_catalog\\.${table} \\(LIKE `));
  assert.match(sql, /REFERENCES qxlayer_acceptance_catalog.plans\(id\)/);
  assert.match(sql, /REFERENCES qxlayer_acceptance_catalog.addons\(id\)/);
  assert.doesNotMatch(sql, /REFERENCES public\.(?:plans|addons)/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /session_user = ''qxlayer_app''/);
  assert.match(sql, /app.is_super_admin/);
  assert.match(sql, /app.can_write/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role, qxlayer_public_app/);
  assert.match(sql, /FOR INSERT TO qxlayer_runtime[\s\S]*session_user = 'qxlayer_app'/);
  assert.doesNotMatch(sql, /INSERT INTO qxlayer_acceptance_catalog.catalog_audit_events SELECT/);
});

test("catalog query inventory is scope-resolved, audits are private, historical entitlement callers are pinned", () => {
  const offers = readFileSync(new URL("../modules/commerce/service.ts", import.meta.url), "utf8");
  assert.match(offers, /if \(acceptanceCatalog\(\)\) return \{ \.\.\.offer, methods: \[\], purchaseAvailable: false \}/);
  for (const path of ["entitlements/catalog", "commerce/offers", "commerce/pricing-publication",
    "customer/order-catalog", "landing-catalog/plan-proposals", "landing-catalog/service", "commerce/service"]) {
    const source = readFileSync(new URL(`../modules/${path}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:plans|addons|plan_entitlements|addon_entitlements)\b/, path);
    assert.doesNotMatch(source, /qxlayer_commerce\.(?:offer_settings|pricing_publication)/, path);
    if (["entitlements/catalog", "commerce/offers", "commerce/pricing-publication"].includes(path)) {
      assert.match(source, /from "\.\.\/\.\.\/lib\/catalog-audit"/);
      assert.doesNotMatch(source, /from "\.\.\/\.\.\/lib\/audit"/);
    }
  }
  const history = readFileSync(new URL("../modules/entitlements/resolver.ts", import.meta.url), "utf8");
  assert.match(history, /readPlan\(client, sub.rows\[0\].plan_id, true\)/);
  assert.match(history, /readAddon\(client, row.addon_id, true\)/);
});

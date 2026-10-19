import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { CreatePlanBody, UpdatePlanBody } from "@workspace/api-zod";
import { savePlan, duplicatePlan, readPlan, type PlanInput } from "./catalog";
import { resolveEntitlements } from "./resolver";
import { publishedOffers, pricingPublication, pricingRevision } from "../commerce/pricing-publication";
import { whiteLabelCatalog } from "../customer/order-catalog";
import type { Principal } from "../authentication/service";

const operator: Principal = { userId: "synthetic-operator", role: "super_admin", memberships: [] };
const input: PlanInput = {
  name: "Feature rows regression", description: "", monthlyPrice: "10", yearlyPrice: "100", setupFee: "0",
  currency: "EUR", billingLabel: "", displayOrder: 0, status: "enabled",
  entitlements: [{ key: "website", value: true }, { key: "crypto_exchange", value: true }],
};
const rows = [{ label: "Support", value: "Email" }, { label: "api_access", value: "true" }];

test("catalog and publication services still deny non-admin and demo callers before database access", async () => {
  for (const p of [{ ...operator, role: "client_admin" as const }, { ...operator, role: "unassigned" as const }, { ...operator, demo: true }]) {
    assert.throws(() => savePlan(p, input), /Super administrator access required/);
    assert.throws(() => duplicatePlan(p, "synthetic-plan"), /Super administrator access required/);
    assert.throws(() => pricingPublication(p), /Super administrator access required/);
  }
});

test("contract validates bounded plain strings, has no small row cap and preserves omission", () => {
  assert.equal(CreatePlanBody.parse(input).featureRows, undefined);
  assert.equal(UpdatePlanBody.parse(input).featureRows, undefined);
  assert.deepEqual(CreatePlanBody.parse({ ...input, featureRows: [] }).featureRows, []);
  const text = [{ label: "<b>Text</b>", value: "<script>not executable markup</script>" }];
  assert.deepEqual(CreatePlanBody.parse({ ...input, featureRows: text }).featureRows, text);
  assert.equal(CreatePlanBody.parse({ ...input, featureRows: Array.from({ length: 1000 }, () => ({ label: "x".repeat(120), value: "y".repeat(500) })) }).featureRows?.length, 1000);
  for (const featureRows of [null, {}, ["string"], [{ label: "missing value" }],
    [{ label: "", value: "text" }], [{ label: "text", value: "" }],
    [{ label: 1, value: "text" }], [{ label: "text", value: false }],
    [{ label: "x".repeat(121), value: "" }], [{ label: "", value: "x".repeat(501) }]]) {
    assert.equal(CreatePlanBody.safeParse({ ...input, featureRows }).success, false);
    assert.equal(UpdatePlanBody.safeParse({ ...input, featureRows }).success, false);
  }
  const app = readFileSync(new URL("../../app.ts", import.meta.url), "utf8");
  assert.match(app, /express\.json\(\{ limit: "128kb" \}\)/);
});

/** In-memory query adapter only: tests never open a database or execute DDL. */
function fixture() {
  const plans = new Map<string, any>(), entries = new Map<string, any[]>();
  const publications = new Map<string, any>();
  const queries: string[] = [];
  let sequence = 0;
  const c = {
    release() {},
    async query(sql: string, args: any[] = []) {
      queries.push(sql);
      const result = (data: any[]) => ({ rows: data, rowCount: data.length });
      if (sql.includes(" AS safe")) return result([{ safe: true }]);
      if (sql.includes("FROM entitlement_definitions")) return result(["website", "crypto_exchange", "api_access"].map(key => ({ key, label: key, kind: "feature", valueType: "boolean" })));
      const table = sql.match(/(?:FROM|INTO|UPDATE) ((?:public|qxlayer_acceptance_catalog)\.plans)/)?.[1];
      if (table) {
        if (sql.startsWith("INSERT INTO")) {
          const id = `a4000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
          plans.set(`${table}:${id}`, { id, feature_rows: [], pricing_configured: false,
            discount_percent: "0", created_at: new Date(), updated_at: new Date(),
            ...Object.fromEntries(["name", "description", "monthly_price", "yearly_price", "setup_fee", "currency", "billing_label", "display_order", "status"].map((k, i) => [k, args[i]])) });
          return result([{ id }]);
        }
        const id = sql.includes("name=$1") ? args[9] : args[0];
        const p = plans.get(`${table}:${id}`);
        if (sql.includes("WHERE status='enabled'") || sql.includes("ORDER BY display_order"))
          return result([...plans.entries()].filter(([k, p]) => k.startsWith(table + ":") && p.status === "enabled").map(([, p]) => ({ id: p.id })));
        if (sql.startsWith("SELECT")) return result(p ? [{ ...p }] : []);
        if (!p) throw new Error("Missing fixture plan");
        if (sql.includes("feature_rows=$2")) p.feature_rows = JSON.parse(args[1]);
        if (sql.includes("pricing_configured=$2")) p.pricing_configured = args[1];
        if (sql.includes("name=$1")) p.name = args[0];
        return result([{ id }]);
      }
      const ent = sql.match(/(?:FROM|INTO) ((?:public|qxlayer_acceptance_catalog)\.plan_entitlements)/)?.[1];
      if (ent) {
        const key = `${ent}:${args[0]}`;
        if (sql.startsWith("DELETE")) entries.set(key, []);
        if (sql.startsWith("INSERT")) entries.set(key, [...entries.get(key) ?? [], { key: args[1], value: JSON.parse(args[2]) }]);
        return result(entries.get(key) ?? []);
      }
      const pub = sql.match(/(?:FROM|INTO) ((?:qxlayer_commerce|qxlayer_acceptance_catalog)\.pricing_publication)/)?.[1];
      if (pub) {
        if (sql.startsWith("INSERT")) publications.set(pub, { payload: JSON.parse(args[0]), revision: args[1], published_at: new Date() });
        return result(publications.has(pub) ? [publications.get(pub)] : []);
      }
      if (sql.includes("SELECT status FROM tenants")) return result([{ status: "active" }]);
      if (sql.includes("FROM tenant_subscriptions")) return result([{ plan_id: [...plans.values()][0]?.id, status: "active", billing_period: "monthly", discount_percent: "0" }]);
      return result([]);
    },
  };
  return { c, plans, publications, queries };
}

test("create, omitted update, reorder, duplicate and clear roundtrip in each server-selected scope; display rows never grant features", async () => {
  const before = { ...process.env };
  const f = fixture();
  const connection = mock.method(pool, "connect", async () => f.c as any);
  try {
    Object.assign(process.env, { QXLAYER_DATABASE_PROVIDER: "replit", QXLAYER_EXTERNAL_CANDIDATE: "false",
      QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED: "false", QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION: "false",
      QXLAYER_PLATFORM_URL: "http://localhost", QXLAYER_PRODUCTION_SUPABASE_AUTH_URL: "",
      QXLAYER_PUBLIC_PREPARATION_APPROVED: "false" });
    for (const privateScope of [false, true]) {
      if (privateScope) Object.assign(process.env, {
        NODE_ENV: "production", QXLAYER_EXTERNAL_ENVIRONMENT: "production",
        QXLAYER_EXTERNAL_CANDIDATE: "true", QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED: "true",
        QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED: "false",
        QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION: "true", PRODUCTION_ACCESS_GATE_ENABLED: "true",
        QXLAYER_DATABASE_PROVIDER: "supabase", QXLAYER_AUTH_PROVIDER: "supabase",
        QXLAYER_PLATFORM_URL: "https://qxlayer-acceptance-vynox3.vercel.app",
        QXLAYER_PRODUCTION_SUPABASE_AUTH_URL: "https://qxlayer-acceptance-vynox3.vercel.app",
      });
      f.queries.length = 0;
      for (const featureRows of [
        [{ label: " \t\n", value: "text" }], [{ label: "text", value: " \t\n" }],
        [{ label: "", value: "text" }], [{ label: "text", value: "" }],
        [{ label: "x".repeat(121), value: "text" }], [{ label: "text", value: "x".repeat(501) }],
      ]) await assert.rejects(() => savePlan(operator, { ...input, featureRows }));
      const created = await savePlan(operator, {
        ...input, featureRows: rows.map(row => ({ label: ` \t${row.label}\n`, value: ` \n${row.value}\t ` })),
      });
      assert.deepEqual(created.featureRows, rows);
      assert.deepEqual((await savePlan(operator, input, created.id)).featureRows, rows);
      const reordered = [...rows].reverse();
      assert.deepEqual((await savePlan(operator, {
        ...input, featureRows: reordered.map(row => ({ label: ` ${row.label} `, value: ` ${row.value} ` })),
      }, created.id)).featureRows, reordered);
      const duplicate = await duplicatePlan(operator, created.id);
      assert.deepEqual(duplicate.featureRows, reordered);
      assert.equal(duplicate.status, "disabled");
      const preview = await pricingPublication(operator);
      const published = await pricingPublication(operator, {
        expectedRevision: preview.draftRevision, expectedPublishedRevision: preview.publishedRevision,
        reason: "Synthetic feature-row publication regression",
      });
      assert.deepEqual(published.published.plans.find((p: { id: string }) => p.id === created.id)?.featureRows, reordered);
      assert.deepEqual((await whiteLabelCatalog(operator)).plans.find(p => p.id === created.id)?.featureRows, reordered);
      assert.deepEqual((await savePlan(operator, { ...input, featureRows: [] }, created.id)).featureRows, []);
      assert.deepEqual((await publishedOffers(f.c as any)).plans.find(p => p.id === created.id)?.featureRows, reordered,
        "unpublished edits must not change customer-visible snapshots");
      assert.deepEqual((await readPlan(f.c as any, duplicate.id)).featureRows, reordered);
      const table = privateScope ? "qxlayer_acceptance_catalog.plans" : "public.plans";
      assert.ok(f.queries.some(q => q.includes(`UPDATE ${table} SET feature_rows=$2::jsonb`)));
      const other = privateScope ? "public.plans" : "qxlayer_acceptance_catalog.plans";
      assert.ok(f.queries.every(q => !q.includes(other)), "scope must never fall back to the other plans table");
    }
    // The entitlement resolver is deliberately pinned to historical public
    // assignments even while the operator is using the private Acceptance scope.
    const first = [...f.plans.values()][0];
    first.feature_rows = rows;
    const effective = await resolveEntitlements(f.c as any, "synthetic-tenant");
    assert.equal(effective.features.api_access, false);
    assert.equal(effective.features.website, true);
    assert.equal(effective.features.crypto_exchange, true);
  } finally {
    connection.mock.restore();
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
});

test("customer/publication readback defaults legacy snapshots without modifying their immutable payload or revision", async () => {
  const legacy: any = { plans: [{ id: "legacy" }], addons: [], methods: [], purchaseAvailable: false };
  const revision = pricingRevision(legacy);
  const c = { query: async () => ({ rows: [{ payload: legacy, revision }], rowCount: 1 }) } as any;
  assert.deepEqual((await publishedOffers(c)).plans[0].featureRows, []);
  assert.equal(legacy.plans[0].featureRows, undefined);
  assert.equal(pricingRevision(legacy), revision);
});

test("0011 is additive, operator-manifested, security-preserving and compatible with a later immutable LIKE clone", () => {
  const migration = readFileSync(new URL("../../../../../deploy/migrations/0011_plan_feature_rows.sql", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../../../../../deploy/migrations/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.find((m: any) => m.file === "0011_plan_feature_rows.sql").sha256, createHash("sha256").update(migration).digest("hex"));
  assert.ok(!manifest.some((m: any) => m.file === "0010_acceptance_catalog.sql"));
  assert.match(migration, /ALTER TABLE public\.plans/);
  assert.match(migration, /to_regclass\('qxlayer_acceptance_catalog\.plans'\)/);
  assert.match(migration, /ALTER TABLE qxlayer_acceptance_catalog\.plans/);
  assert.match(migration, /jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|GRANT|REVOKE|CREATE POLICY|DISABLE ROW LEVEL SECURITY)\b/);
  assert.doesNotMatch(migration, /^\s*(?:UPDATE|DELETE|INSERT|BEGIN;|COMMIT;)/m);
});

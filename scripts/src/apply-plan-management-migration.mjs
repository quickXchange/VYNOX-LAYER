// Development-only runner. Run with tsx (imports API TypeScript), e.g.
//   CONFIRM_PLAN_MANAGEMENT_MIGRATION=yes pnpm --filter @workspace/scripts exec tsx src/apply-plan-management-migration.mjs
// Order: (1) schema + freeze all subscription contracts, (2) freeze the public
// pricing baseline if none exists, (3) seed/archive (captures the baseline as a
// rollback-able version before archiving). Does NOT publish the new plans.
import { readFile } from "node:fs/promises";
import { pool, withDatabase } from "@workspace/db";
import { freezePricingBeforeEdit } from "../../artifacts/api-server/src/modules/commerce/pricing-publication.ts";
if (process.env.NODE_ENV === "production" || process.env.QXLAYER_EXTERNAL_ENVIRONMENT !== "development" || !process.env.REPLIT_DEV_DOMAIN)
  throw new Error("Development-only migration; other targets require separate scoped approval.");
if (process.env.CONFIRM_PLAN_MANAGEMENT_MIGRATION !== "yes") throw new Error("Set CONFIRM_PLAN_MANAGEMENT_MIGRATION=yes after verifying the target.");
const sql = (f) => readFile(new URL(`../../lib/db/migrations/${f}`, import.meta.url), "utf8");
const c = await pool.connect();
try {
  if ((await c.query("SELECT current_database() AS name")).rows[0]?.name !== "heliumdb") throw new Error("Unexpected database target.");
  await c.query(await sql("plan-management-profiles.sql"));
} finally { c.release(); }
await withDatabase({ actorId: "development:plan-management-migration", isSuperAdmin: true, canWrite: true }, freezePricingBeforeEdit);
const c2 = await pool.connect();
try {
  await c2.query(await sql("plan-management-seed.sql"));
  console.log(JSON.stringify((await c2.query("SELECT name,status,profile->>'slug' AS slug FROM public.plans ORDER BY status,display_order")).rows));
  console.log(JSON.stringify((await c2.query("SELECT count(*) FILTER (WHERE contract_snapshot IS NULL) AS unfrozen, count(*) AS total FROM public.tenant_subscriptions")).rows[0]));
} finally { c2.release(); await pool.end(); }

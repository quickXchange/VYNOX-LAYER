/**
 * Development-only: replace the active public offering with the Starter/Standard/Premium
 * tiers through the real publication service. Production and Acceptance are refused.
 * Rollback: Plans -> Publication versions -> roll back to the baseline version.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pool } from "@workspace/db";
import type { Principal } from "../modules/authentication/service";
import { pricingPublication } from "../modules/commerce/pricing-publication";
import { publicOffers } from "../modules/commerce/service";
import { acceptanceCatalog } from "../lib/catalog-scope";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT || process.env.QXLAYER_EXTERNAL_ENVIRONMENT !== "development" || !process.env.REPLIT_DEV_DOMAIN || acceptanceCatalog())
  throw new Error("Development heliumdb only.");
if (process.env.CONFIRM_PUBLISH_DEFAULT_TIERS !== "yes") throw new Error("Set CONFIRM_PUBLISH_DEFAULT_TIERS=yes.");
assert.equal((await pool.query("SELECT current_database() d")).rows[0].d, "heliumdb");
const admin: Principal = { userId: "development:publish-default-tiers", role: "super_admin", memberships: [] };

// 1. Seed-source correction (only unedited seed rows).
const fixed = await pool.query(readFileSync(new URL("../../../../lib/db/migrations/plan-management-capability-fix.sql", import.meta.url), "utf8"));
console.log("capability fix rows:", fixed.rowCount);
// 2. Preview and assert the draft is exactly the three tiers.
const preview = await pricingPublication(admin);
const slugs = preview.draft.plans.map((p: any) => p.profile?.slug).sort();
assert.deepEqual(slugs, ["premium", "standard", "starter"], `draft must be exactly the 3 tiers, got ${slugs}`);
assert.ok(!JSON.stringify(preview.draft).match(/internalNotes|internalName/));
if (preview.publishedRevision === preview.draftRevision) { console.log("Already published:", preview.publishedRevision); await pool.end(); process.exit(0); }
const before = preview.publishedRevision;
// 3. Publish via the real service (records an immutable version).
const r = await pricingPublication(admin, { expectedRevision: preview.draftRevision, expectedPublishedRevision: before, reason: "Replace public offering with Starter/Standard/Premium (contact sales) - Development" });
const live = await publicOffers();
assert.deepEqual(live.plans.map((p: any) => p.profile?.slug).sort(), ["premium", "standard", "starter"]);
const versions = (await pool.query("SELECT revision,reason,published_at FROM qxlayer_commerce.pricing_publication_versions ORDER BY published_at")).rows;
console.log(JSON.stringify({ before, published: r.publishedRevision, versions: versions.map(v => ({ r: v.revision.slice(0, 12), reason: v.reason })) }, null, 1));
await pool.end();

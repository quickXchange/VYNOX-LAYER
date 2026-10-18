import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { createTenant, getTenant, saveBrand } from "../modules/tenants/service";
import { getPublicSite } from "../modules/website/service";
import type { Principal } from "../modules/authentication/service";

assert.equal(process.env.NODE_ENV, "development", "Disposable Development tenants only");
const p = { userId: "release-sync-service-fixture", role: "super_admin", memberships: [] } as Principal;
try {
  const plan = await pool.query("SELECT id FROM plans WHERE status='enabled' ORDER BY created_at LIMIT 1");
  assert(plan.rowCount);
  const tenant = await createTenant(p, { name: "Release Sync Probe", slug: `release-sync-${randomUUID().slice(0, 8)}`, planId: plan.rows[0].id });
  await mkdir(".local/qa", { recursive: true });
  await writeFile(".local/qa/release-sync-before.json", JSON.stringify({ tenantId: tenant.id, slug: tenant.slug }));
  await pool.query("UPDATE tenants SET status='active' WHERE id=$1", [tenant.id]);
  const before = await getPublicSite(tenant.slug);
  const t = await getTenant(p, tenant.id);
  await saveBrand(p, tenant.id, { brandName: "Unreleased Draft Brand", logoUrl: "https://placehold.co/160x64/png?text=Draft",
    primaryColor: "#153F6B", accentColor: "#146747", themeMode: t.themeMode as "light" | "dark" | "system",
    defaultLanguage: t.defaultLanguage, supportedLanguages: t.supportedLanguages });
  const after = await getPublicSite(tenant.slug);
  assert.equal(after.brandName, "Unreleased Draft Brand");
  const releaseTable = await pool.query("SELECT to_regclass('public.tenant_releases') IS NOT NULL AS exists");
  process.stdout.write(JSON.stringify({ tenantSlug: tenant.slug, brandBefore: before.brandName, brandAfterSaveWithoutRelease: after.brandName,
    colorAfterSaveWithoutRelease: after.primaryColor, releaseTableExists: releaseTable.rows[0].exists,
    reproduction: "Draft save leaks immediately into public configuration; no tenant Release handler/button exists to press.",
    noIdentityCreated: true, sandboxOnly: true }) + "\n");
} finally { await pool.end(); }

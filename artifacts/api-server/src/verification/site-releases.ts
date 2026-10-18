import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool, withDatabase } from "@workspace/db";
import { SiteSnapshot } from "@workspace/api-zod";
import { admin, savedScope, setupFixtures, changeDraft, cleanupFixtures, developmentOnly, type Scope } from "./site-release-fixtures";
import { configChecksum, draftConfig } from "../modules/website/release-config";
import { releasedConfig } from "../modules/website/release-config";
import { releaseInTransaction, releaseTenant, rollbackTenant, tenantReleaseState } from "../modules/website/releases";
import { tenantDraftPreview, verifyDraftPreview } from "../modules/website/release-preview";
import { draftAsset, safeImage } from "../modules/website/release-assets";
import { contextFor, type Principal } from "../modules/authentication/service";

const SENTINEL = "qa-release-key-never-in-public-output-9b8a3";
let mode = process.argv[2] ?? "--test";
let ciScope: Scope | undefined;
developmentOnly();
try {
  if (mode === "--ci") {
    if (process.env.NODE_ENV !== "test" || process.env.QXLAYER_MIGRATION_TEST !== "true") throw new Error("CI only.");
    (await import("./site-release-ci-storage")).installCIStorage();
    await pool.query(await readFile("../../deploy/migrations/0004_phase1_commerce.sql","utf8"));
    await pool.query("GRANT USAGE ON SCHEMA public TO pg_database_owner; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO pg_database_owner; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO pg_database_owner");
    await (await import("./site-release-ci-catalog")).seedCICatalog();
    ciScope = await setupFixtures(); mode = "--test";
  }
  if (mode === "--prepare") console.log(JSON.stringify(await setupFixtures()));
  else {
    const scope = await savedScope(), [a, b] = scope.tenants;
    if (mode === "--cleanup") { await cleanupFixtures(scope); console.log("PASS: exact release fixtures and their assets removed."); }
    else if (mode === "--draft") { await changeDraft(scope); console.log("PASS: four draft changes saved, not released."); }
    else if (mode === "--release") console.log(JSON.stringify(await releaseTenant(admin, a.id)));
    else if (mode === "--rollback") console.log(JSON.stringify(await rollbackTenant(admin, a.id, scope.initialReleases[0])));
    else if (mode === "--test") {
      await rollbackTenant(admin, a.id, scope.initialReleases[0]);
      const first = await releasedConfig(a.slug), other = await releasedConfig(b.slug);
      await changeDraft(scope);
      assert.deepEqual((await releasedConfig(a.slug)).config, first.config);
      const draft = await withDatabase({ actorId: admin.userId, isSuperAdmin: true, tenantId: a.id }, c => draftConfig(c, a.id));
      assert.equal(draft.site.primaryColor, "#663399");
      assert.equal(draft.addons[0].name, "Release Sync Add-on");
      const adminA: Principal = { userId: "qa-release-admin-a", role: "client_admin", memberships: [{ tenantId: a.id, role: "client_admin" }] };
      const preview = await tenantDraftPreview(adminA, a.id);
      const token = new URL(preview.url, "https://example.invalid").searchParams.get("release_preview")!;
      assert.equal(verifyDraftPreview(token, a.slug, adminA.userId)?.tenantId, a.id);
      assert.equal(verifyDraftPreview(token, b.slug, adminA.userId), null);
      assert.equal(verifyDraftPreview(token, a.slug, "different-actor"), null);
      assert.equal(verifyDraftPreview(token + "x", a.slug, adminA.userId), null);
      await assert.rejects(() => releaseTenant(adminA, b.id), { status: 403 });
      await assert.rejects(() => draftAsset(adminA, b.id, randomUUID()), { status: 403 });
      const staff: Principal = { userId: "qa-release-staff", role: "staff", memberships: [{ tenantId: a.id, role: "staff" }] };
      await assert.rejects(() => releaseTenant(staff, a.id), { status: 403 });
      console.log("PASS 2/4: draft isolation, scoped signed preview, staff/cross-tenant denial.");

      const second = await releaseTenant(admin, a.id), live = await releasedConfig(a.slug);
      assert.equal(live.config.site.primaryColor, "#663399");
      assert.notEqual(live.config.site.logoUrl, first.config.site.logoUrl);
      assert.notEqual(live.config.exchange?.routes[0]?.rate, first.config.exchange?.routes[0]?.rate);
      assert.equal(live.config.addons[0].key, scope.addonId);
      assert.deepEqual((await releasedConfig(b.slug)).config, other.config);
      assert.ok(live.config.site.logoUrl?.includes(a.id));
      assert.ok(other.config.site.logoUrl?.includes(b.id));
      assert.ok(!JSON.stringify(live.config).includes(SENTINEL));
      console.log("PASS 1/4: complete four-field sync and two-tenant isolation.");
      await rollbackTenant(admin, a.id, scope.initialReleases[0]);
      assert.deepEqual((await releasedConfig(a.slug)).config, first.config);
      await rollbackTenant(admin, a.id, second.id);
      console.log("PASS 3: pointer-only rollback restores complete snapshot and old logo URL.");

      await assert.rejects(() => withDatabase({ ...contextFor(admin, a.id, true), repeatableRead: true }, async c => {
        await releaseInTransaction(c, admin, a.id); throw new Error("qa-atomic-abort");
      }), /qa-atomic-abort/);
      assert.equal((await releasedConfig(a.slug)).id, second.id);
      await assert.rejects(() => pool.query("UPDATE tenant_releases SET version=version+10 WHERE id=$1", [second.id]), { code: "23514" });
      await assert.rejects(() => pool.query("UPDATE tenants SET live_release_id=$2 WHERE id=$1", [b.id, second.id]), { code: "23503" });
      await assert.rejects(() => rollbackTenant(admin, b.id, second.id), { status: 404 });
      const noRead = await withDatabase({ actorId: "anonymous" }, c => c.query("SELECT id FROM tenant_releases"));
      assert.equal(noRead.rowCount, 0);
      const readOnly = await withDatabase({ actorId: "anonymous", repeatableRead: true }, c => c.query("SHOW transaction_read_only"));
      assert.equal(readOnly.rows[0].transaction_read_only, "on");
      console.log("PASS: transaction abort, immutable DB snapshots, tenant-owned FK, RLS.");

      await pool.query("UPDATE tenant_branding SET logo_url=NULL WHERE tenant_id=$1", [a.id]);
      assert.equal((await tenantReleaseState(admin, a.id)).checklist.find(x => x.key === "brand.logo")?.ready, false);
      await assert.rejects(() => releaseTenant(admin, a.id), { status: 409 });
      await pool.query("UPDATE tenant_branding SET logo_url=$2 WHERE tenant_id=$1", [a.id, draft.site.logoUrl]);
      await pool.query(`INSERT INTO tenant_integrations(tenant_id,provider_key,enabled,encrypted_credentials,health)
        VALUES($1,'whitebit',true,$2,'{"state":"untested"}')`, [a.id, { ciphertext: SENTINEL }]);
      assert.equal((await tenantReleaseState(admin, a.id)).checklist.find(x => x.key === "provider.whitebit")?.ready, false);
      await assert.rejects(() => releaseTenant(admin, a.id), { status: 409 });
      assert.ok(!JSON.stringify((await releasedConfig(a.slug)).config).includes(SENTINEL));
      await pool.query("DELETE FROM tenant_integrations WHERE tenant_id=$1", [a.id]);
      console.log("PASS 6/7: synthetic key excluded; missing logo/untested credentials refuse atomically.");

      const insert = async (config: unknown, checksum = configChecksum(config)) => (await pool.query(`INSERT INTO tenant_releases(tenant_id,version,config,checksum,created_by)
        SELECT $1,coalesce(max(version),0)+1,$2,$3,$4 FROM tenant_releases WHERE tenant_id=$1 RETURNING id`,
        [a.id, JSON.stringify(config), checksum, admin.userId])).rows[0].id as string;
      const legacy = await insert({ ...live.config, schema_version: 0 });
      await pool.query("UPDATE tenants SET live_release_id=$2 WHERE id=$1", [a.id, legacy]);
      assert.equal((await releasedConfig(a.slug)).config.schema_version, 1);
      assert.equal((await releasedConfig(a.slug)).config.site.brandName, live.config.site.brandName);
      const broken = await insert({ schema_version: 99 });
      await pool.query("UPDATE tenants SET live_release_id=$2 WHERE id=$1", [a.id, broken]);
      await assert.rejects(() => releasedConfig(a.slug), { status: 503 });
      await pool.query("UPDATE tenants SET live_release_id=$2 WHERE id=$1", [a.id, second.id]);
      await assert.rejects(() => releasedConfig(`unknown-${randomUUID().slice(0, 8)}`), { status: 404 });
      assert.equal(configChecksum({ a: 1, b: undefined }), configChecksum({ a: 1 }));
      assert.equal(configChecksum({ b: 2, a: 1 }), configChecksum({ a: 1, b: 2 }));
      assert.equal(SiteSnapshot.parse(live.config).schema_version, 1);
      const sanitized = safeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><path fill="url(https://evil.invalid/a)" d="M0 0"/></svg>'), "image/svg+xml").bytes.toString();
      assert.ok(!/script|onload|https:\/\/evil/.test(sanitized));
      assert.throws(() => safeImage(Buffer.from("not-png"), "image/png"));
      await rollbackTenant(admin, a.id, scope.initialReleases[0]); // Browser baseline; draft remains edited.
      console.log("PASS 5/8: unknown site, logged invalid config, old-version mapper, canonical checksums, safe SVG.");
      console.log("PASS: all eight backend acceptance categories. Browser evidence is separate; no Auth identity created.");
      if (ciScope) await (await import("./site-release-browser")).browserProof(scope);
    } else throw new Error("Unknown QA operation.");
  }
} finally { if (ciScope) await cleanupFixtures(ciScope); await pool.end(); }

import { Router, raw } from "express";
import { z } from "zod";
import { withDatabase } from "@workspace/db";
import { GetTenantReleasesResponse, ReleaseTenantSiteResponse, RollbackTenantSiteResponse, GetReleasedSiteConfigResponse } from "@workspace/api-zod";
import { requireAuthentication, principalFrom, sameOriginMutation } from "../middlewares/authentication";
import { tenantReleaseState, releaseTenant, rollbackTenant } from "../modules/website/releases";
import { tenantDraftPreview } from "../modules/website/release-preview";
import { draftAsset, releasedAsset, uploadDraftAsset } from "../modules/website/release-assets";
import { draftConfig, configChecksum, releasedConfig } from "../modules/website/release-config";
import { authorizedWebsitePreview } from "../modules/website/operator-preview";
import { resolvePublicDomain } from "../modules/domains/service";
import { HttpError } from "../lib/errors";
import { DEMO_SLUG } from "../modules/demo/identity";
import { demoSite, demoPublicExchange } from "../modules/demo/fixture";
import { assertDeliveredExchangeAccess } from "../modules/customer/service";

const router = Router(), uuid = z.string().uuid();
router.get("/public/site-config", async (req, res) => {
  const input = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(48).optional(), host: z.string().max(253).optional() }).strict().parse(req.query);
  if (!!input.slug === !!input.host) throw new HttpError(400, "Provide exactly one slug or host.");
  const slug = input.slug ?? (await resolvePublicDomain(input.host!)).tenantSlug;
  // Explicit existing fictional demo, never an unknown-tenant fallback and never
  // a customer's data. Keep the approved shared master demonstration intact.
  if (slug === DEMO_SLUG && !req.get("X-QX-Release-Preview")) {
    const config = GetReleasedSiteConfigResponse.parse({ schema_version: 1, site: demoSite, exchange: demoPublicExchange, addons: [], displayLimits: {}, providers: [] });
    res.set({ "Cache-Control": "no-cache", ETag: `"${configChecksum(config)}"` }).json(config); return;
  }
  const preview = await authorizedWebsitePreview(req, slug);
  const live = preview ? await withDatabase({ actorId: preview.actorId, tenantId: preview.tenantId, isSuperAdmin: true }, async c => {
    const config = await draftConfig(c, preview.tenantId);
    config.site.preview = true;
    if (config.site.logoUrl?.startsWith(`/api/public/sites/${slug}/branding/`))
      config.site.logoUrl = `/api/tenants/${preview.tenantId}/release-branding/logo`;
    if (config.site.websiteSettings.faviconUrl?.startsWith(`/api/public/sites/${slug}/branding/`))
      config.site.websiteSettings.faviconUrl = `/api/tenants/${preview.tenantId}/release-branding/favicon`;
    return { config, checksum: configChecksum(config) };
  }) : await releasedConfig(slug);
  res.set({ "Cache-Control": preview ? "private, no-store" : "no-cache", ETag: `"${live.checksum}"`, "Vary": "X-QX-Release-Preview, Cookie", "Referrer-Policy": "no-referrer" });
  if (!preview && req.get("If-None-Match") === `"${live.checksum}"`) { res.status(304).end(); return; }
  res.json(GetReleasedSiteConfigResponse.parse(live.config));
});
router.get("/public/release-assets/:tenantId/:name", async (req, res) => {
  const { file, contentType } = await releasedAsset(req.params.tenantId, req.params.name);
  res.set({ "Content-Type": contentType, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'none'; sandbox", "Cache-Control": "public,max-age=31536000,immutable" });
  file.createReadStream().on("error", () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
});
router.use(["/tenants/:tenantId/releases", "/tenants/:tenantId/release-preview",
  "/tenants/:tenantId/release-assets", "/tenants/:tenantId/release-branding"], requireAuthentication, sameOriginMutation, async (req, res, next) => {
  await assertDeliveredExchangeAccess(principalFrom(res), uuid.parse(req.params.tenantId)); next();
});
router.get("/tenants/:tenantId/releases", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(GetTenantReleasesResponse.parse(await tenantReleaseState(principalFrom(res), uuid.parse(req.params.tenantId))));
});
router.post("/tenants/:tenantId/releases", async (req, res) => {
  res.status(201).json(ReleaseTenantSiteResponse.parse(await releaseTenant(principalFrom(res), uuid.parse(req.params.tenantId))));
});
router.post("/tenants/:tenantId/releases/:releaseId/rollback", async (req, res) => {
  res.json(RollbackTenantSiteResponse.parse(await rollbackTenant(principalFrom(res), uuid.parse(req.params.tenantId), uuid.parse(req.params.releaseId))));
});
router.post("/tenants/:tenantId/release-preview", async (req, res) => {
  res.set("Cache-Control", "private, no-store").json(await tenantDraftPreview(principalFrom(res), uuid.parse(req.params.tenantId)));
});
router.post("/tenants/:tenantId/release-assets", raw({ type: ["image/*", "application/octet-stream"], limit: "2mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "Upload raw image bytes.");
  res.status(201).json(await uploadDraftAsset(principalFrom(res), uuid.parse(req.params.tenantId), req.body, req.get("Content-Type")?.split(";")[0] ?? ""));
});
router.get("/tenants/:tenantId/release-assets/:assetId", async (req, res) => {
  const { file, contentType } = await draftAsset(principalFrom(res), uuid.parse(req.params.tenantId), uuid.parse(req.params.assetId));
  res.set({ "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
  file.createReadStream().on("error", () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
});
router.get("/tenants/:tenantId/release-branding/:kind", async (req, res) => {
  const { getTenant } = await import("../modules/tenants/service");
  const { publicBrandingFile } = await import("../modules/website/branding-files");
  const p = principalFrom(res), t = await getTenant(p, uuid.parse(req.params.tenantId));
  const { file, contentType } = await publicBrandingFile(t.slug, req.params.kind, { tenantId: t.id, slug: t.slug, actorId: p.userId, expiresAt: Date.now() + 1000 });
  res.set({ "Content-Type": contentType, "Cache-Control": "private,no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
  file.createReadStream().on("error", () => res.destroy()).pipe(res);
});
export default router;

import { Router } from "express";
import { GetPublicSiteParams, GetPublicSiteResponse, GetPublicCapabilityParams, GetPublicCapabilityResponse } from "@workspace/api-zod";
import { getPublicSite } from "../modules/website/service";
import { ResolvePublicDomainParams, ResolvePublicDomainResponse } from "@workspace/api-zod";
import { resolvePublicDomain } from "../modules/domains/service";
import { publicHostingProof } from "../modules/domains/hosting";
import { GetDomainHostingProofResponse } from "@workspace/api-zod";
import { publicBrandingFile } from "../modules/website/branding-files";
import { authorizedWebsitePreview } from "../modules/website/operator-preview";

const router = Router();
router.get("/public/site-delivery/:slug", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { deliveredPublicSite } = await import("../modules/website/service");
  if (!await deliveredPublicSite(req.params.slug)) { res.status(404).json({ error: "Website not available." }); return; }
  res.json({ tenantSlug: req.params.slug, delivered: true });
});
router.get("/public/domains/:hostname/hosting-proof/:nonce", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(GetDomainHostingProofResponse.parse(await publicHostingProof(req.params.hostname, req.params.nonce)));
});
router.get("/public/domains/:hostname", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(ResolvePublicDomainResponse.parse(await resolvePublicDomain(ResolvePublicDomainParams.parse(req.params).hostname)));
});
router.use("/public/sites", (_req, res, next) => {
  res.set("Cache-Control", "no-store"); // Suspension/entitlement changes must not serve stale access.
  next();
});
router.get("/public/sites/:slug", async (req, res) => {
  const { slug } = GetPublicSiteParams.parse(req.params);
  const site = await getPublicSite(slug, undefined, await authorizedWebsitePreview(req, slug));
  if ("releaseChecksum" in site) res.set({ "Cache-Control": "no-cache", ETag: `"${site.releaseChecksum}"` });
  res.json(GetPublicSiteResponse.parse(site));
});
router.get("/public/sites/:slug/branding/:kind", async (req, res) => {
  const preview = await authorizedWebsitePreview(req, req.params.slug);
  if (!preview) {
    const { releasedConfig } = await import("../modules/website/release-config");
    const live = await releasedConfig(req.params.slug);
    const url = req.params.kind === "logo" ? live.config.site.logoUrl : req.params.kind === "favicon" ? live.config.site.websiteSettings.faviconUrl : null;
    if (!url) { res.status(404).end(); return; }
    res.set("Cache-Control", "no-store").redirect(302, url); return;
  }
  const { file, contentType } = await publicBrandingFile(req.params.slug, req.params.kind, preview);
  res.set({ "Content-Type": contentType, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", "Cache-Control": "no-store" });
  file.createReadStream().on("error", () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
});
router.get("/public/sites/:slug/capabilities/:feature", async (req, res) => {
  const { slug, feature } = GetPublicCapabilityParams.parse(req.params);
  res.json(GetPublicCapabilityResponse.parse(await getPublicSite(slug, feature, await authorizedWebsitePreview(req, slug))));
});
export default router;
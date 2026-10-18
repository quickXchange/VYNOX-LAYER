import type {RequestHandler} from "express";
import {publicPreparation} from "../../../../lib/production-access-gate/public-preparation.mjs";

const values = (name: string) => (process.env[name] ?? "").split(",").filter(Boolean);
/** Host/role authentication is still required by the ordinary application routes.
 * This additional pre-DNS barrier cannot authorize anything by itself. */
export const preparationIsolation: RequestHandler = (req,res,next) => {
  const publicMode = publicPreparation();
  const acceptanceRestricted = process.env.QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION === "true";
  if (!publicMode && !acceptanceRestricted) { next(); return; }
  let path: string;
  try { path = decodeURIComponent(req.path).toLowerCase(); }
  catch { res.status(400).json({error:"Invalid request path."}); return; }
  if (publicMode && /\/(?:execute|broadcast|payouts?|withdrawals?|deposits?)(?:\/|$)/.test(path) &&
      !["GET","HEAD","OPTIONS"].includes(req.method)) {
    res.status(403).json({error:"Financial execution is not authorized."}); return;
  }
  const tenants = values("QXLAYER_PREPARATION_WRITE_TENANTS");
  const slugs = values("QXLAYER_PREPARATION_WRITE_SLUGS");
  if (publicMode && (
      /^\/api\/(?:public\/)?(?:demo(?:-isolation)?|internal|testing)(?:\/|$|-)/.test(path) ||
      [...values("QXLAYER_PUBLIC_EXCLUDED_TENANTS"),...values("QXLAYER_PUBLIC_EXCLUDED_SLUGS")]
        .some(id => path.toLowerCase().split("/").includes(id.toLowerCase())))) {
    res.status(404).json({error:"Not available."}); return;
  }
  if (["GET","HEAD","OPTIONS"].includes(req.method) || path.startsWith("/api/supabase-auth/") ||
      path === "/api/diagnostics/website-errors") { next(); return; }
  // Only exact sandbox/QA tenant routes may write while the public-domain hold
  // remains in force. Global operations, real-customer changes and provisioning
  // are deliberately unavailable, including to an acceptance Super Admin.
  const tenant = path.match(/^\/api\/tenants\/([^/]+)\//)?.[1];
  const slug = path.match(/^\/api\/public\/sites\/([^/]+)\//)?.[1];
  if ((tenant && tenants.includes(tenant)) || (slug && slugs.includes(slug))) {
    next(); return;
  }
  res.status(403).json({error:"Preparation mode: business writes are restricted to authorized isolated test tenants."});
};

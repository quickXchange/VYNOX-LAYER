import type {RequestHandler} from "express";
import {createHash} from "node:crypto";
import {publicPreparation} from "../../../../lib/production-access-gate/public-preparation.mjs";

const values = (name: string) => (process.env[name] ?? "").split(",").filter(Boolean);
interface OwnerAdminPolicy { tenantId: string; ownerBusinessIdSha256: string }
// Explicitly approved original Owner and retained demo only. This is not an
// authorization credential: the ordinary session, MFA and active-role checks
// must succeed first. No customer identity or authentication secret is stored.
const approvedOwnerAdmin: OwnerAdminPolicy = {
  tenantId: "a7447a46-76e0-45b4-a09e-0f475f2d06cf",
  ownerBusinessIdSha256: "9811009f62804325a7a84491db5e03c5e01f4267320f42e3a0d80a928dbfe600",
};
/** Host/role authentication is still required by the ordinary application routes.
 * This additional pre-DNS barrier cannot authorize anything by itself. */
export function createPreparationIsolation(
  authenticate: RequestHandler,
  ownerPolicy: OwnerAdminPolicy = approvedOwnerAdmin,
): RequestHandler {
 return async (req,res,next) => {
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
  const excluded = [...values("QXLAYER_PUBLIC_EXCLUDED_TENANTS"),...values("QXLAYER_PUBLIC_EXCLUDED_SLUGS")]
    .some(id => path.split("/").includes(id.toLowerCase()));
  const privateTenant = path.match(/^\/api\/tenants\/([^/]+)(?:\/|$)/)?.[1];
  if (publicMode && excluded && privateTenant === ownerPolicy.tenantId &&
      ["GET","HEAD"].includes(req.method)) {
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");
    // Authenticate through the native session/MFA path, never a header, query
    // parameter, demo cookie or a generic Super Admin role alone.
    try {
      let authenticated = false;
      await authenticate(req, res, error => {
        if (error) throw error;
        authenticated = true;
      });
      const p = res.locals.principal;
      if (authenticated && p?.authenticationProvider === "supabase" &&
          p.role === "super_admin" && !p.demo && typeof p.userId === "string" &&
          createHash("sha256").update(p.userId).digest("hex") === ownerPolicy.ownerBusinessIdSha256) {
        next(); return;
      }
    } catch (error) {
      // Keep hidden fixtures hidden for anonymous, unauthorized and incomplete
      // MFA sessions. Operational authentication failures still reach logging.
      if (![401,403,428].includes((error as {status?: number})?.status ?? 0)) {
        next(error); return;
      }
    }
    res.status(404).json({error:"Not available."}); return;
  }
  if (publicMode && (
      /^\/api\/(?:public\/)?(?:demo(?:-isolation)?|internal|testing)(?:\/|$|-)/.test(path) ||
      excluded)) {
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
}

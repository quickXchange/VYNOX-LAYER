import type { RequestHandler, Response } from "express";
import { createHash } from "node:crypto";
import { resolvePrincipal, type Principal } from "../modules/authentication/service";
import { demoPrincipal, assertDemoRequest } from "../modules/demo/session";
import { HttpError } from "../lib/errors";
import { supabaseAuthEnabled, supabaseDefaultProvider, supabaseAuthConfiguration } from "../modules/supabase-auth/config";
import { sessionCookie, readSession, businessId, hasVerifiedFactor, assertAuthOrigin } from "../modules/supabase-auth/session";
import { applicationMfaSatisfied } from "../modules/supabase-auth/development-email-mfa";

export const requireAuthentication: RequestHandler = async (req, res, next): Promise<void> => {
  const demo = await demoPrincipal(req);
  if (demo) {
    assertDemoRequest(demo, req);
    res.locals.principal = demo;
    next();
    return;
  }
  if (supabaseAuthEnabled() && (supabaseDefaultProvider() || sessionCookie(req))) {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertAuthOrigin(req);
    const s = await readSession(req);
    if (!s || s.payload.recovery) throw new HttpError(401, "Sign-in required.");
    const mfaSatisfied = await applicationMfaSatisfied(s);
    if ((hasVerifiedFactor(s.user) || (s.payload.emailPrimary && s.payload.emailPrimaryMfaRequired !== false)) && !mfaSatisfied)
      throw new HttpError(428, "MFA_REQUIRED: Complete two-factor verification.");
    const principal = await resolvePrincipal(await businessId(s.user.id));
    principal.authenticationProvider = "supabase";
    // Internal authorization fingerprint only; never return the email itself.
    if (s.user.email && s.user.email_confirmed_at) {
      principal.verifiedEmailSha256 = createHash("sha256")
        .update(s.user.email.trim().toLowerCase())
        .digest("hex");
    }
    if (principal.role === "super_admin" && (!hasVerifiedFactor(s.user) || !mfaSatisfied))
      throw new HttpError(428, "MFA_REQUIRED: Enable and verify two-factor authentication in Account Security.");
    res.locals.principal = principal;
    next();
    return;
  }
  throw new HttpError(401, "Sign-in required. Legacy authentication is retired.");
};

export function principalFrom(res: Response): Principal {
  return res.locals.principal as Principal;
}

// Cookie-authenticated mutations must originate from this app. No wildcard credentialed CORS.
export const sameOriginMutation: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const origin = req.get("origin");
  if (supabaseAuthEnabled() && (supabaseDefaultProvider() || sessionCookie(req))) {
    if (origin !== supabaseAuthConfiguration().origin || req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Same-origin request required." }); return;
    }
    next(); return;
  }
  const canonicalHost = process.env.QXLAYER_DATABASE_PROVIDER === "supabase"
    ? new URL(process.env.QXLAYER_PLATFORM_URL!).host
    : req.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.get("host");
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite === "cross-site") { res.status(403).json({ error: "Cross-site mutation denied." }); return; }
  try {
    if (!origin || new URL(origin).host !== canonicalHost) {
      res.status(403).json({ error: "Same-origin request required." });
      return;
    }
  } catch {
    res.status(403).json({ error: "Invalid request origin." });
    return;
  }
  next();
};
import type { Request } from "express";
import { resolvePrincipal, requireSuperAdmin } from "../authentication/service";
import { signProof, readProof } from "../../lib/scoped-proof";
import { HttpError } from "../../lib/errors";
import { supabaseAuthEnabled } from "../supabase-auth/config";
import { sessionCookie, readSession, businessId, hasVerifiedFactor } from "../supabase-auth/session";

export const PREVIEW_TTL = 15 * 60 * 1000;
export const PREVIEW_COOKIE = "qx_operator_preview";
export interface WebsitePreview { tenantId: string; slug: string; actorId: string; expiresAt: number }
export function issuePreview(tenantId: string, slug: string, actorId: string) {
  const grant: WebsitePreview = { tenantId, slug, actorId, expiresAt: Date.now() + PREVIEW_TTL };
  return { grant, token: signProof("authenticated-operator-preview", grant) };
}
export function verifyPreview(token: string | undefined, slug: string, actorId: string | null | undefined): WebsitePreview | null {
  const v = readProof("authenticated-operator-preview", token);
  return v && typeof actorId === "string" && v.actorId === actorId && v.slug === slug &&
    typeof v.tenantId === "string" && /^[0-9a-f-]{36}$/.test(v.tenantId) &&
    typeof v.expiresAt === "number" && v.expiresAt > Date.now() && v.expiresAt <= Date.now() + PREVIEW_TTL
    ? v as unknown as WebsitePreview : null;
}
export async function authorizedWebsitePreview(req: Request, slug: string): Promise<WebsitePreview | undefined> {
  if (req.get("X-QX-Release-Preview")) {
    const { releasePreviewFor } = await import("./release-preview");
    return releasePreviewFor(req, slug);
  }
  const marker = req.get("x-qx-website-preview") ?? req.query.preview;
  if (marker === undefined) return undefined;
  if (marker !== "session" && marker !== "1") throw new HttpError(403, "Invalid private preview.");
  const cookie = req.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${PREVIEW_COOKIE}=`))?.slice(PREVIEW_COOKIE.length + 1);
  if (supabaseAuthEnabled() && sessionCookie(req)) {
    const s = await readSession(req);
    const actorId = s && !s.payload.recovery && s.aal2 && hasVerifiedFactor(s.user) ? await businessId(s.user.id) : null;
    const grant = verifyPreview(cookie, slug, actorId);
    if (!grant || !actorId) throw new HttpError(401, "Sign in with operator MFA and reopen this private preview.");
    requireSuperAdmin(await resolvePrincipal(actorId));
    return grant;
  }
  throw new HttpError(401, "Sign in with operator MFA and reopen this private preview.");
}
export function previewBrandingUrl(url: string | null | undefined, slug: string, preview?: WebsitePreview) {
  return preview && url?.startsWith(`/api/public/sites/${slug}/branding/`) ? `${url}?preview=1` : url;
}

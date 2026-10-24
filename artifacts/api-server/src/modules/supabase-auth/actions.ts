import { createHmac } from "node:crypto";
import { authSupportPool as pool } from "@workspace/db";
import { z } from "zod";
import type { Request, Response } from "express";
import { HttpError } from "../../lib/errors";
import { authRequest, type SupabaseTokens } from "./provider";
import { developmentSupabaseAuth, productionSupabaseAuth, supabaseEmailLoginEnabled, supabaseAuthConfiguration, supabaseSessionSecret } from "./config";
import { establishSession, needSession, publicUser, hasVerifiedFactor, reauthenticate, readSession,
  revokeLocalSession, updateSession, sessionCookie, type AuthSession } from "./session";
import { generateRecoveryCodes, recoverAuthenticator, requireDevelopmentRecovery } from "./development-recovery";
import { sendEmailChallenge, verifyEmailChallenge } from "./development-email-mfa";
import { sendEmailLogin, verifyEmailLogin } from "./development-email-login";
import { developmentLimit, developmentMailCooldown } from "./development-auth-limits";

const password = z.string().max(128).superRefine((value, ctx) => {
  const dev = developmentSupabaseAuth();
  if (value.length < (dev ? 10 : 12) || (dev && !/[A-Z]/.test(value)))
    ctx.addIssue({ code: "custom", message: dev ? "Use at least 10 characters, including uppercase, lowercase and numbers." : "Use at least 12 characters." });
  else if (dev && (!/[a-z]/.test(value) || !/[0-9]/.test(value)))
    ctx.addIssue({ code: "custom", message: "Include uppercase letters, lowercase letters and numbers." });
});
const email = z.string().email().max(254).transform(v => v.trim().toLowerCase());
const factorId = z.string().uuid();
export const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("signup"), name: z.string().trim().min(1).max(120), email, password }).strict(),
  z.object({ action: z.literal("login"), email, password: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("login-email-send"), email }).strict(),
  z.object({ action: z.literal("login-email-verify"), email, code: z.string().regex(/^[0-9]{6}$/) }).strict(),
  z.object({ action: z.literal("logout") }).strict(),
  z.object({ action: z.literal("recover"), email }).strict(),
  z.object({ action: z.literal("resend"), email }).strict(),
  z.object({ action: z.literal("verify"), token: z.string().min(1).max(2048), tokenType: z.enum(["signup", "recovery"]) }).strict(),
  z.object({ action: z.literal("reset-password"), password }).strict(),
  z.object({ action: z.literal("change-password"), currentPassword: z.string().min(1).max(128), password }).strict(),
  z.object({ action: z.literal("mfa-enroll"), currentPassword: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("mfa-verify"), code: z.string().regex(/^[0-9]{6}$/), factorId: factorId.optional() }).strict(),
  z.object({ action: z.literal("mfa-email-send") }).strict(),
  z.object({ action: z.literal("mfa-email-verify"), code: z.string().regex(/^[0-9]{6}$/) }).strict(),
  z.object({ action: z.literal("mfa-remove"), currentPassword: z.string().min(1).max(128), factorId,
    code: z.string().regex(/^[0-9]{6}$/) }).strict(),
   z.object({ action: z.literal("link-existing") }).strict(),
  z.object({ action: z.literal("mfa-recovery-generate"), currentPassword: z.string().min(1).max(128),
    code: z.string().regex(/^[0-9]{6}$/), confirmReplace: z.literal(true) }).strict(),
  z.object({ action: z.literal("mfa-recover"), currentPassword: z.string().min(1).max(128),
    recoveryCode: z.string().min(32).max(64), confirmReset: z.literal(true) }).strict(),
]);
export async function limitAction(req: Request, action: string, account = "") {
  const secret = supabaseSessionSecret();
  if (developmentSupabaseAuth()) {
    await developmentLimit(`ingress/${action}`, req.socket.remoteAddress ?? "unknown", 60, 60);
    if (account) await developmentLimit(`account/${action}`, account, 60, 5);
    else account = sessionCookie(req) ?? "anonymous";
    if (action === "recover") {
      await developmentMailCooldown(account);
      await developmentLimit("recovery-send-hour", account, 3600, 3);
    }
  }
  const key = createHmac("sha256", secret).update(`${req.socket.remoteAddress}\0${action}\0${account}`).digest("hex");
  const maximum = ["login", "signup", "recover", "resend", "mfa-recover", "mfa-recovery-generate"].includes(action) ? 5 : 15;
  const result = await pool.query(`INSERT INTO vynox_supabase_auth.rate_limits(key,hits,reset_at)
    VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET
    hits=CASE WHEN vynox_supabase_auth.rate_limits.reset_at<now() THEN 1 ELSE vynox_supabase_auth.rate_limits.hits+1 END,
    reset_at=CASE WHEN vynox_supabase_auth.rate_limits.reset_at<now() THEN now()+interval '1 minute'
      ELSE vynox_supabase_auth.rate_limits.reset_at END
      RETURNING hits,GREATEST(1,ceil(extract(epoch FROM(reset_at-now()))))::int AS retry_after`, [key]);
  if (result.rows[0].hits > maximum) {
    const wait = Number(result.rows[0].retry_after) || 60;
    throw new HttpError(429, `Please wait ${wait} seconds before trying again.`, wait);
  }
}
async function totp(s: AuthSession, code: string, requested?: string) {
  const owned = s.user.factors?.find(f => f.factor_type === "totp" &&
    (requested ? f.id === requested : f.status === "verified"));
  if (!owned) throw new HttpError(400, "No matching authenticator is enrolled on this account.");
  const challenge = await authRequest<{ id: string }>(`/factors/${owned.id}/challenge`,
    { method: "POST", accessToken: s.payload.accessToken });
  const tokens = await authRequest<SupabaseTokens>(`/factors/${owned.id}/verify`,
    { method: "POST", accessToken: s.payload.accessToken, body: { challenge_id: challenge.id, code } });
  if (s.payload.emailPrimary) s.payload.emailPrimaryTotpVerified = true;
  await updateSession(s, tokens);
  return tokens;
}
async function logoutAll(s: AuthSession, req: Request, res: Response) {
  // Delete app sessions first: provider outages cannot leave an app session usable.
  await pool.query("DELETE FROM vynox_supabase_auth.sessions WHERE subject=$1", [s.user.id]);
  await revokeLocalSession(req, res);
  await authRequest("/logout?scope=global", { method: "POST", accessToken: s.payload.accessToken });
}
export async function performAction(raw: unknown, req: Request, res: Response) {
  const a = input.parse(raw);
  if (["login-email-send", "login-email-verify"].includes(a.action) && !supabaseEmailLoginEnabled())
    throw new HttpError(404, "Email authentication method unavailable.");
  if (a.action === "mfa-recover" || a.action === "mfa-recovery-generate") requireDevelopmentRecovery();
  await limitAction(req, a.action, "email" in a ? a.email : "");
  const cfg = supabaseAuthConfiguration();
  if (["signup", "recover", "resend"].includes(a.action) && !cfg.mailReady)
    throw new HttpError(503, "Verification and recovery email delivery is not configured.");
  switch (a.action) {
    case "login-email-send":
      return { ok: true, emailLoginChallengeExpiresAt: await sendEmailLogin(a.email, req, res) };
    case "login-email-verify":
      return { ok: true, ...await verifyEmailLogin(a.email, a.code, req, res) };
    case "mfa-email-send":
      await sendEmailChallenge(await needSession(req));
      return { ok: true };
    case "mfa-email-verify":
      await verifyEmailChallenge(await needSession(req), a.code);
      return { ok: true };
    case "mfa-recovery-generate": {
      const s = await needSession(req);
      if (!s.aal2 || s.payload.recovery) throw new HttpError(403, "Complete MFA before generating recovery codes.");
      await reauthenticate(s, a.currentPassword);
      await totp(s, a.code);
      return { ok: true, recoveryCodes: await generateRecoveryCodes(s) };
    }
    case "mfa-recover": {
      const s = await needSession(req);
      await recoverAuthenticator(s, a.currentPassword, a.recoveryCode, req, res);
      return { ok: true };
    }
    case "signup":
      await authRequest("/signup", { method: "POST", body: { email: a.email, password: a.password, data: { name: a.name } } });
      return { ok: true };
    case "login": {
      const tokens = await authRequest<SupabaseTokens>("/token?grant_type=password",
        { method: "POST", body: { email: a.email, password: a.password } });
      if (!tokens.user.email_confirmed_at) throw new HttpError(403, "Verify your email before signing in.");
      await establishSession(req, res, tokens);
      return { ok: true, user: publicUser(tokens.user), mfaRequired: hasVerifiedFactor(tokens.user) };
    }
    case "logout": {
      const s = await readSession(req);
      await revokeLocalSession(req, res);
      if (s) await authRequest("/logout?scope=local", { method: "POST", accessToken: s.payload.accessToken });
      return { ok: true };
    }
    case "recover":
      await authRequest("/recover", { method: "POST", body: { email: a.email } });
      return { ok: true };
    case "resend":
      await authRequest("/resend", { method: "POST", body: { email: a.email, type: "signup" } });
      return { ok: true };
    case "verify": {
      const tokens = await authRequest<SupabaseTokens>("/verify",
        { method: "POST", body: { token_hash: a.token, type: a.tokenType } });
      if (a.tokenType === "recovery") await establishSession(req, res, tokens, true);
      else await authRequest("/logout?scope=local", { method: "POST", accessToken: tokens.access_token });
      return { ok: true };
    }
    case "reset-password": {
      const s = await needSession(req, true);
      if (!s.payload.recovery || Date.now() - s.payload.created > 15 * 60000)
        throw new HttpError(401, "Open a fresh password recovery link.");
      if (hasVerifiedFactor(s.user) && !s.aal2)
        throw new HttpError(428, "MFA_REQUIRED: Verify your existing authenticator before resetting your password.");
      await authRequest("/user", { method: "PUT", accessToken: s.payload.accessToken, body: { password: a.password } });
      await logoutAll(s, req, res);
      return { ok: true };
    }
    case "change-password": {
      const s = await needSession(req);
      if (hasVerifiedFactor(s.user) && !s.aal2) throw new HttpError(403, "Complete MFA before changing your password.");
      await reauthenticate(s, a.currentPassword);
      await authRequest("/user", { method: "PUT", accessToken: s.payload.accessToken, body: { password: a.password } });
      await logoutAll(s, req, res);
      return { ok: true };
    }
    case "mfa-enroll": {
      const s = await needSession(req);
      await reauthenticate(s, a.currentPassword);
      if (hasVerifiedFactor(s.user) && !s.aal2) throw new HttpError(403, "Verify the existing authenticator first.");
      const issuer = productionSupabaseAuth() ? "VYNOX LAYER Production" : "VYNOX LAYER";
      // A cancelled Development setup may leave a provider draft with the same unique name.
      // Remove only this validated account's unverified app drafts; never a verified factor.
      if (developmentSupabaseAuth() || productionSupabaseAuth()) for (const draft of s.user.factors ?? []) {
        if (draft.factor_type === "totp" && draft.status === "unverified" && draft.friendly_name === issuer)
          await authRequest(`/factors/${draft.id}`, { method: "DELETE", accessToken: s.payload.accessToken });
      }
      const factor = await authRequest<{ id: string; totp: { qr_code: string; secret: string; uri: string } }>("/factors",
        { method: "POST", accessToken: s.payload.accessToken, body: { factor_type: "totp", friendly_name: issuer, issuer } });
      return { ok: true, factorId: factor.id, qrCode: factor.totp.qr_code, secret: factor.totp.secret, totpUri: factor.totp.uri };
    }
    case "mfa-verify": {
      // A recovered account may elevate assurance only within its recovery-only
      // session. updateSession preserves recovery=true; business access stays denied.
      const s = await needSession(req, true);
      if (s.payload.recovery && Date.now() - s.payload.created > 15 * 60000)
        throw new HttpError(401, "Open a fresh password recovery link.");
      await totp(s, a.code, a.factorId);
      return { ok: true };
    }
    case "mfa-remove": {
      const s = await needSession(req);
      if (!s.aal2) throw new HttpError(403, "Complete MFA before removing the authenticator.");
      await reauthenticate(s, a.currentPassword);
      await totp(s, a.code, a.factorId);
      await authRequest(`/factors/${a.factorId}`, { method: "DELETE", accessToken: s.payload.accessToken });
      await logoutAll(s, req, res);
      return { ok: true };
    }
    case "link-existing": {
      // Existing proof-based links are retained. Never replace legacy proof with email matching.
      throw new HttpError(410, "Legacy account migration is retired. Existing links remain valid; unmigrated accounts require a separately approved ownership review.");
    }
  }
}

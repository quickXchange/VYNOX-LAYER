import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { authSupportPool as pool } from "@workspace/db";
import { HttpError } from "../../lib/errors";
import { developmentSupabaseAuth, supabaseEmailLoginEnabled, productionSupabaseAuth, supabaseAuthConfiguration, supabaseSessionSecret } from "./config";
import { sessionCodec } from "./crypto";
import { authRequest, type SupabaseUser, type SupabaseTokens } from "./provider";
import { verifiedGmailSuperAdmin } from "./development-email-mfa";
import { establishSession } from "./session";
import { developmentLimit, developmentMailCooldown, privateAuthKey } from "./development-auth-limits";

export const EMAIL_LOGIN_COOKIE = developmentSupabaseAuth() ? "__Host-vynox_dev_email_login" :
  productionSupabaseAuth() ? "__Host-vynox_prod_email_login" : "__Host-vynox_staging_email_login";
const lifetime = 5 * 60000;
interface Challenge { purpose: "email-login"; subject: string; emailHash: string; nonce: string; expires: number }
const invalid = () => new HttpError(400, "The code is invalid, expired or already used. Request a new code in this browser.");
const restart = (reason: string) => new HttpError(400, `EMAIL_LOGIN_RESTART: ${reason} Request a new sign-in code in this browser tab.`);
function requireDevelopment() {
  if (!supabaseEmailLoginEnabled()) throw new HttpError(404, "Email authentication method unavailable.");
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    throw new HttpError(503, "Secure email verification transport is required.");
  return supabaseAuthConfiguration();
}
function challengeKey(p: Challenge) { return privateAuthKey("email-login-challenge", `${p.subject}\0${p.emailHash}\0${p.nonce}`); }
function browserChallenge(req: Request): Challenge | null {
  const value = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith(`${EMAIL_LOGIN_COOKIE}=`))
    ?.slice(EMAIL_LOGIN_COOKIE.length + 1);
  if (!value || value.length > 1024) return null;
  try {
    const p = sessionCodec(supabaseSessionSecret()).open<Challenge>(value);
    if (p.purpose !== "email-login" || !/^[A-Za-z0-9_-]{32}$/.test(p.nonce) ||
        !/^[a-f0-9]{64}$/.test(p.emailHash) || !/^[a-f0-9-]{36}$/i.test(p.subject) ||
        !Number.isSafeInteger(p.expires)) return null;
    return p;
  } catch { return null; }
}

/** Public cookie readback, not a credential: identical for eligible/unknown accounts. */
export async function emailLoginChallengeExpiresAt(req: Request): Promise<number | undefined> {
  if (!supabaseEmailLoginEnabled()) return undefined;
  requireDevelopment();
  const p = browserChallenge(req);
  if (!p || p.expires <= Date.now()) return undefined;
  const r = await pool.query(`SELECT 1 FROM vynox_supabase_auth.rate_limits
    WHERE key=$1 AND reset_at>now() AND hits<5`, [challengeKey(p)]);
  return r.rowCount ? p.expires : undefined;
}

/** Locate an EXISTING authorized subject for delivery, not email-based role assignment. */
export async function eligibleEmailLoginUser(email: string): Promise<SupabaseUser | null> {
  const cfg = requireDevelopment();
  const admins = await pool.query(productionSupabaseAuth() ?
    "SELECT subject::text FROM vynox_supabase_auth.active_admin_subjects()" : `SELECT DISTINCT COALESCE(l.subject::text,
    CASE WHEN a.clerk_user_id LIKE 'supabase:%' THEN substring(a.clerk_user_id from 10) END) AS subject
    FROM public.platform_admins a LEFT JOIN vynox_supabase_auth.identity_links l ON l.business_id=a.clerk_user_id
    WHERE a.active=true LIMIT 51`);
  if (admins.rows.length > 50) throw new HttpError(503, "Email sign-in is temporarily unavailable.");
  for (const row of admins.rows) {
    if (!/^[a-f0-9-]{36}$/i.test(row.subject ?? "")) continue;
    let response: globalThis.Response;
    try {
      response = await fetch(`${cfg.providerOrigin}/auth/v1/admin/users/${row.subject}`, {
        headers: { apikey: cfg.apiKey }, redirect: "error", signal: AbortSignal.timeout(10000),
      });
    } catch { throw new HttpError(503, "Email sign-in is temporarily unavailable."); }
    if (response.status === 404) continue;
    if (!response.ok) throw new HttpError(503, "Email sign-in is temporarily unavailable.");
    const user = await response.json() as SupabaseUser;
    if (user.id === row.subject && user.email?.toLowerCase() === email && await verifiedGmailSuperAdmin(user))
      return user;
  }
  return null;
}

export async function sendEmailLogin(email: string, _req: Request, res: Response) {
  const cfg = requireDevelopment();
  if (!cfg.mailReady) throw new HttpError(503, "Email delivery is unavailable.");
  await developmentMailCooldown(email);
  await developmentLimit("email-login-send-hour", email, 3600, 5);
  const user = await eligibleEmailLoginUser(email);
  const p: Challenge = { purpose: "email-login", subject: user?.id ?? randomUUID(),
    emailHash: privateAuthKey("email-login-address", email),
    nonce: randomBytes(24).toString("base64url"), expires: Date.now() + lifetime };
  // No signup, admin-generated links, password reset or credential replacement.
  if (user) await authRequest("/otp", { method: "POST", body: { email, create_user: false } });
  await pool.query(`INSERT INTO vynox_supabase_auth.rate_limits(key,hits,reset_at) VALUES($1,0,to_timestamp($2))
    ON CONFLICT(key) DO NOTHING`, [challengeKey(p), p.expires / 1000]);
  res.cookie(EMAIL_LOGIN_COOKIE, sessionCodec(supabaseSessionSecret()).seal(p),
    { secure: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: Math.max(0, p.expires - Date.now()) });
  // Same response/cookie shape for unknown, customer, unverified and non-Gmail accounts.
  return p.expires;
}

export async function verifyEmailLogin(email: string, code: string, req: Request, res: Response) {
  requireDevelopment();
  const p = browserChallenge(req);
  if (!p) throw restart("The code request is not available in this browser. Secure cookies may be blocked in the embedded preview.");
  if (p.emailHash !== privateAuthKey("email-login-address", email))
    throw restart("The email address does not match the code request in this browser.");
  if (!/^[0-9]{6}$/.test(code)) throw invalid();
  if (p.expires <= Date.now()) throw restart("The five-minute sign-in code request has expired.");
  await developmentLimit("email-login-verify", email, 900, 20);
  // Resolve authority before holding the challenge lock; do not exhaust the pool
  // with nested authority queries while parallel verifiers wait for this row.
  const user = await eligibleEmailLoginUser(email);
  const c = await pool.connect();
  let tokens: SupabaseTokens | undefined;
  let failure: unknown;
  try {
    await c.query("BEGIN");
    const state = await c.query(`UPDATE vynox_supabase_auth.rate_limits SET hits=hits+1
      WHERE key=$1 AND reset_at>now() AND hits<5 RETURNING hits`, [challengeKey(p)]);
    if (!state.rowCount) throw restart("The code request is expired, already used or has reached its attempt limit.");
    try {
      if (!user || user.id !== p.subject) throw invalid();
      tokens = await authRequest<SupabaseTokens>("/verify", { method: "POST", body: { email, token: code, type: "email" } });
      if (Date.now() >= p.expires || tokens.user.id !== p.subject || tokens.user.email?.toLowerCase() !== email)
        throw invalid();
      // Serialize successful consumption even if the provider were to accept a
      // duplicated concurrent verification. Failed attempts also commit.
      await c.query("UPDATE vynox_supabase_auth.rate_limits SET hits=5 WHERE key=$1", [challengeKey(p)]);
    } catch (e) {
      failure = e instanceof HttpError && [429, 503].includes(e.status) ? e : invalid();
      tokens = undefined;
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  if (failure) throw failure;
  if (!tokens) throw invalid();
  tokens.user = await authRequest<SupabaseUser>("/user", { accessToken: tokens.access_token });
  if (Date.now() >= p.expires || tokens.user.id !== p.subject || tokens.user.email?.toLowerCase() !== email ||
      !await verifiedGmailSuperAdmin(tokens.user)) throw invalid();
  await establishSession(req, res, tokens, false, true);
  res.clearCookie(EMAIL_LOGIN_COOKIE, { secure: true, httpOnly: true, sameSite: "lax", path: "/" });
}

import { randomBytes } from "node:crypto";
import { publicAuthOriginAllowed } from "../../../../../lib/production-access-gate/public-preparation.mjs";
import type { Request, Response } from "express";
import { authSupportPool as pool } from "@workspace/db";
import { HttpError } from "../../lib/errors";
import { cookieDigest, sessionCodec } from "./crypto";
import { authRequest, type SupabaseTokens, type SupabaseUser } from "./provider";
import { supabaseAuthConfiguration, supabaseBusinessId, supabaseSessionSecret, developmentSupabaseAuth, productionSupabaseAuth } from "./config";

export const SESSION_COOKIE = developmentSupabaseAuth() ? "__Host-vynox_dev_sb" :
  productionSupabaseAuth() ? "__Host-vynox_prod_sb" : "__Host-vynox_sb";
export interface Payload {
  accessToken: string;
  refreshToken: string;
  subject: string;
  tokenExpires: number;
  recovery: boolean;
  created: number;
  emailPrimary?: boolean;
  emailPrimaryTotpVerified?: boolean;
  emailChallenge?: { hash: string; nonce: string; recipient: string; expires: number; attempts: number };
  emailMfa?: { recipient: string; factorId: string; expires: number };
}
export interface AuthSession {
  digest: string;
  payload: Payload;
  user: SupabaseUser;
  aal2: boolean;
}
function codec() {
  return sessionCodec(supabaseSessionSecret());
}
export function sessionCookie(req: Request) {
  const raw = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${SESSION_COOKIE}=`));
  const cookie = raw?.slice(SESSION_COOKIE.length + 1);
  return cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie) ? cookie : null;
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { secure: true, httpOnly: true, sameSite: "lax", path: "/" });
}
function cookie(res: Response, value: string) {
  res.cookie(SESSION_COOKIE, value, { secure: true, httpOnly: true, sameSite: "lax", path: "/",
    maxAge: 7 * 24 * 3600 * 1000 });
}
function payload(tokens: SupabaseTokens, recovery: boolean): Payload {
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, subject: tokens.user.id,
    tokenExpires: Date.now() + tokens.expires_in * 1000, recovery, created: Date.now() };
}
export async function revokeLocalSession(req: Request, res: Response) {
  const value = sessionCookie(req);
  clearSessionCookie(res);
  if (value) await pool.query("DELETE FROM vynox_supabase_auth.sessions WHERE digest=$1", [cookieDigest(value)]);
}
export async function establishSession(req: Request, res: Response, tokens: SupabaseTokens, recovery = false, emailPrimary = false) {
  if (!tokens.access_token || !tokens.refresh_token || !tokens.user?.id)
    throw new HttpError(503, "Authentication provider returned an incomplete session.");
  const value = randomBytes(32).toString("base64url");
  const p = payload(tokens, recovery);
  if (emailPrimary) p.emailPrimary = true;
  await revokeLocalSession(req, res);
  await pool.query(`INSERT INTO vynox_supabase_auth.sessions(digest,subject,envelope,expires_at)
    VALUES($1,$2,$3,now()+interval '7 days')`, [cookieDigest(value), p.subject, codec().seal(p)]);
  cookie(res, value);
}
export async function updateSession(s: AuthSession, tokens: SupabaseTokens) {
  if (tokens.user.id !== s.payload.subject) throw new HttpError(401, "Session identity changed.");
  s.payload = { ...payload(tokens, s.payload.recovery), created: s.payload.created,
    ...(s.payload.emailPrimary ? { emailPrimary: true, emailPrimaryTotpVerified: s.payload.emailPrimaryTotpVerified === true } : {}) };
  s.user = tokens.user;
  const updated = await pool.query("UPDATE vynox_supabase_auth.sessions SET envelope=$2 WHERE digest=$1",
    [s.digest, codec().seal(s.payload)]);
  if (developmentSupabaseAuth() && updated.rowCount === 0)
    throw new HttpError(401, "Your pending sign-in session is no longer available. Sign in again before entering a new code.");
}
export async function readSession(req: Request): Promise<AuthSession | null> {
  const value = sessionCookie(req);
  if (!value) return null;
  const digest = cookieDigest(value);
  // Serialize refresh-token rotation across requests and server instances.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT envelope FROM vynox_supabase_auth.sessions
      WHERE digest=$1 AND expires_at>now() FOR UPDATE`, [digest]);
    if (!result.rowCount) { await client.query("COMMIT"); return null; }
    let p: Payload;
    try { p = codec().open<Payload>(result.rows[0].envelope); }
    catch { await client.query("DELETE FROM vynox_supabase_auth.sessions WHERE digest=$1", [digest]); await client.query("COMMIT"); return null; }
    if (!p.subject || !p.accessToken || !p.refreshToken) throw new HttpError(401, "Invalid session.");
    if (p.tokenExpires < Date.now() + 60000) {
      const tokens = await authRequest<SupabaseTokens>("/token?grant_type=refresh_token",
        { method: "POST", body: { refresh_token: p.refreshToken } });
      if (tokens.user.id !== p.subject) throw new HttpError(401, "Session identity changed.");
      p = { ...p, ...payload(tokens, p.recovery), created: p.created };
      await client.query("UPDATE vynox_supabase_auth.sessions SET envelope=$2 WHERE digest=$1", [digest, codec().seal(p)]);
    }
    const user = await authRequest<SupabaseUser>("/user", { accessToken: p.accessToken });
    if (user.id !== p.subject || !user.email_confirmed_at) throw new HttpError(401, "Verify your email before signing in.");
    // The JWT is examined only AFTER /user validates it with the pinned provider.
    const claims = JSON.parse(Buffer.from(p.accessToken.split(".")[1], "base64url").toString()) as { aal?: string };
    await client.query("COMMIT");
    return { digest, payload: p, user,
      aal2: claims.aal === "aal2" && (!p.emailPrimary || p.emailPrimaryTotpVerified === true) };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof HttpError && [400, 401, 403].includes(error.status)) {
      await pool.query("DELETE FROM vynox_supabase_auth.sessions WHERE digest=$1", [digest]);
      return null;
    }
    throw error;
  } finally { client.release(); }
}
export function hasVerifiedFactor(user: SupabaseUser) {
  return !!user.factors?.some(f => f.factor_type === "totp" && f.status === "verified");
}
export function publicUser(user: SupabaseUser) {
  return { id: user.id, email: user.email ?? "", name: user.user_metadata?.name ?? "",
    emailVerified: !!user.email_confirmed_at, twoFactorEnabled: hasVerifiedFactor(user),
    totpFactorId: user.factors?.find(f => f.factor_type === "totp" && f.status === "verified")?.id ?? null };
}
export async function businessId(subject: string) {
  const id = supabaseBusinessId(subject);
  const link = await pool.query("SELECT business_id FROM vynox_supabase_auth.identity_links WHERE subject=$1", [subject]);
  return link.rows[0]?.business_id ?? id;
}
export async function hasExistingAccountLink(subject: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM vynox_supabase_auth.identity_links WHERE subject=$1) AS linked", [subject]);
  return result.rows[0]?.linked === true;
}
export async function needSession(req: Request, allowRecovery = false) {
  const s = await readSession(req);
  if (!s || (!allowRecovery && s.payload.recovery)) throw new HttpError(401, "Sign in to your verified account.");
  return s;
}
export async function reauthenticate(s: AuthSession, password: string) {
  if (!password || password.length > 128) throw new HttpError(400, "Your current password is required.");
  const tokens = await authRequest<SupabaseTokens>("/token?grant_type=password",
    { method: "POST", body: { email: s.user.email, password } });
  if (tokens.user.id !== s.user.id) throw new HttpError(401, "Password verification failed.");
  // Retain the existing AAL2 session; do not replace it with fresh AAL1 tokens.
  await authRequest("/logout?scope=local", { method: "POST", accessToken: tokens.access_token });
}
export function assertAuthOrigin(req: Request) {
  const configured = supabaseAuthConfiguration().origin;
  // Preserve exact legacy public origins, never wildcard CORS or acceptance.
  if (!publicAuthOriginAllowed(req.get("origin"), configured) || req.get("sec-fetch-site") === "cross-site")
    throw new HttpError(403, "Same-origin authentication request required.");
}

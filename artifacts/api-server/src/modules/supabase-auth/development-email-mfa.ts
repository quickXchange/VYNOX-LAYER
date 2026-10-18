import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { authSupportPool as pool } from "@workspace/db";
import { HttpError } from "../../lib/errors";
import { developmentSupabaseAuth, productionSupabaseAuth, supabaseEmailLoginEnabled, supabaseAuthConfiguration, supabaseSessionSecret } from "./config";
import { sessionCodec } from "./crypto";
import { businessId, hasVerifiedFactor, type AuthSession, type Payload } from "./session";
import type { SupabaseUser } from "./provider";

export const EMAIL_CODE_LIFETIME = 5 * 60_000;
export const EMAIL_CODE_ATTEMPTS = 5;

/** Reload-safe public state for this exact pending session; never return the hash or nonce. */
export function emailChallengeExpiresAt(s: AuthSession): number | undefined {
  const c = s.payload.emailChallenge;
  if (!developmentSupabaseAuth() || s.payload.recovery || s.payload.emailPrimary || s.aal2 ||
      !c || c.recipient !== s.user.email?.toLowerCase() ||
      c.expires <= Date.now() || c.attempts >= EMAIL_CODE_ATTEMPTS) return undefined;
  return c.expires;
}

/** Provider-verified mailbox + actual business authorization, never email-based ownership. */
export async function emailMfaEligible(s: AuthSession): Promise<boolean> {
  if (!developmentSupabaseAuth() || s.payload.recovery || s.payload.emailPrimary) return false;
  return verifiedGmailSuperAdmin(s.user);
}
export async function verifiedGmailSuperAdmin(user: SupabaseUser): Promise<boolean> {
  if (!supabaseEmailLoginEnabled() || !user.email_confirmed_at ||
      !/^[^@\s]+@gmail\.com$/i.test(user.email ?? "") || !hasVerifiedFactor(user)) return false;
  supabaseAuthConfiguration(); // Enforce pinned project/origin/runtime before any operation.
  const result = await pool.query(productionSupabaseAuth() ?
    "SELECT EXISTS(SELECT 1 FROM vynox_supabase_auth.active_admin_subjects() WHERE subject=$1::uuid) AS eligible" :
    "SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE clerk_user_id=$1 AND active=true) AS eligible",
    [productionSupabaseAuth() ? user.id : await businessId(user.id)]);
  return result.rows[0]?.eligible === true;
}

/** App-only assurance. Never forge a provider AAL2 token or use this for factor/password mutation. */
export async function applicationMfaSatisfied(s: AuthSession): Promise<boolean> {
  if (s.aal2) return true;
  if (s.payload.emailPrimary) return false; // An email first factor cannot also satisfy the second factor.
  const proof = s.payload.emailMfa;
  return !!proof && proof.expires > Date.now() && proof.recipient === s.user.email?.toLowerCase() &&
    !!s.user.factors?.some(f => f.id === proof.factorId && f.status === "verified" && f.factor_type === "totp") &&
    await emailMfaEligible(s);
}

async function accountLimit(subject: string, purpose: string, seconds: number, maximum: number) {
  const key = createHmac("sha256", supabaseSessionSecret())
    .update(`development-email-mfa-rate\0${subject}\0${purpose}`).digest("hex");
  const r = await pool.query(`INSERT INTO vynox_supabase_auth.rate_limits(key,hits,reset_at)
    VALUES($1,1,now()+make_interval(secs=>$2)) ON CONFLICT(key) DO UPDATE SET
    hits=CASE WHEN vynox_supabase_auth.rate_limits.reset_at<=now() THEN 1 ELSE vynox_supabase_auth.rate_limits.hits+1 END,
    reset_at=CASE WHEN vynox_supabase_auth.rate_limits.reset_at<=now() THEN now()+make_interval(secs=>$2)
      ELSE vynox_supabase_auth.rate_limits.reset_at END RETURNING hits`, [key, seconds]);
  if (r.rows[0].hits > maximum) throw new HttpError(429, "Too many email code requests or attempts. Try again later.");
}

function hash(s: AuthSession, recipient: string, nonce: string, code: string) {
  return createHmac("sha256", supabaseSessionSecret())
    .update(`development-email-mfa-code\0${s.user.id}\0${s.digest}\0${recipient}\0${nonce}\0${code}`).digest("hex");
}

async function requireEligible(s: AuthSession) {
  if (!await emailMfaEligible(s) || s.aal2)
    throw new HttpError(403, "Email verification is available only during eligible Super Admin sign-in.");
}

async function deliver(recipient: string, code: string) {
  const key = process.env.QXLAYER_DEVELOPMENT_RESEND_SMTP_KEY;
  if (!key || key === process.env.QXLAYER_STAGING_RESEND_SETUP_KEY || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    throw new HttpError(503, "Development verification email is not configured.");
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "VYNOX LAYER Development <development-auth@quicklychan.xyz>",
        to: [recipient], subject: "Your VYNOX LAYER Development verification code",
        text: `Your Development sign-in code is ${code}. It expires in 5 minutes and can be used once. Do not share it. If you did not request it, do not use it. This does not disable Google Authenticator.` }),
    });
    if (!r.ok) throw new Error("Delivery refused");
  } catch { throw new HttpError(503, "The verification email could not be sent. Use Google Authenticator or try again later."); }
}

export async function sendEmailChallenge(s: AuthSession) {
  await requireEligible(s);
  await accountLimit(s.user.id, "send-minute", 60, 1);
  await accountLimit(s.user.id, "send-hour", 3600, 5);
  const recipient = s.user.email!.toLowerCase();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const nonce = randomBytes(24).toString("base64url");
  const codec = sessionCodec(supabaseSessionSecret());
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query("SELECT envelope FROM vynox_supabase_auth.sessions WHERE digest=$1 AND expires_at>now() FOR UPDATE", [s.digest]);
    if (!r.rowCount) throw new HttpError(401, "Sign in again.");
    const p = codec.open<Payload>(r.rows[0].envelope);
    if (p.subject !== s.user.id || p.recovery || p.emailMfa?.expires && p.emailMfa.expires > Date.now())
      throw new HttpError(403, "A pending password sign-in is required.");
    const expires = Date.now() + EMAIL_CODE_LIFETIME;
    await deliver(recipient, code);
    p.emailChallenge = { hash: hash(s, recipient, nonce, code), nonce, recipient,
      expires, attempts: 0 };
    await c.query("UPDATE vynox_supabase_auth.sessions SET envelope=$2 WHERE digest=$1", [s.digest, codec.seal(p)]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}

export async function verifyEmailChallenge(s: AuthSession, code: string) {
  await requireEligible(s);
  if (!/^[0-9]{6}$/.test(code)) throw new HttpError(400, "Enter a 6-digit code.");
  await accountLimit(s.user.id, "verify", 900, 20);
  const codec = sessionCodec(supabaseSessionSecret());
  const c = await pool.connect();
  let accepted = false;
  try {
    await c.query("BEGIN");
    const r = await c.query("SELECT envelope FROM vynox_supabase_auth.sessions WHERE digest=$1 AND expires_at>now() FOR UPDATE", [s.digest]);
    if (!r.rowCount) throw new HttpError(401, "Sign in again.");
    const p = codec.open<Payload>(r.rows[0].envelope);
    const challenge = p.emailChallenge;
    if (p.subject !== s.user.id || p.recovery || !challenge || challenge.recipient !== s.user.email!.toLowerCase() ||
        challenge.expires <= Date.now() || challenge.attempts >= EMAIL_CODE_ATTEMPTS)
      throw new HttpError(400, "The code is invalid, expired or already used. Request a new code.");
    challenge.attempts++;
    accepted = timingSafeEqual(Buffer.from(challenge.hash, "hex"), Buffer.from(hash(s, challenge.recipient, challenge.nonce, code), "hex"));
    if (accepted) {
      p.emailMfa = { recipient: challenge.recipient,
        factorId: s.user.factors!.find(f => f.status === "verified" && f.factor_type === "totp")!.id,
        expires: Math.min(Date.now() + 12 * 3600_000, p.created + 7 * 24 * 3600_000) };
      delete p.emailChallenge;
    }
    await c.query("UPDATE vynox_supabase_auth.sessions SET envelope=$2 WHERE digest=$1", [s.digest, codec.seal(p)]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
  if (!accepted) throw new HttpError(400, "The code is incorrect. After 5 attempts, request a new code.");
}

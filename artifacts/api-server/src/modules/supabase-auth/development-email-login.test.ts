import test, { mock } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import { sendEmailLogin, verifyEmailLogin, EMAIL_LOGIN_COOKIE, emailLoginChallengeExpiresAt } from "./development-email-login";
import { applicationMfaSatisfied, emailMfaEligible } from "./development-email-mfa";
import { readSession, updateSession, SESSION_COOKIE, type Payload } from "./session";
import { requireAuthentication } from "../../middlewares/authentication";
import { sessionCodec } from "./crypto";
import { input, performAction, limitAction } from "./actions";
import { authRequest } from "./provider";

const subject = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const factor = "11111111-2222-3333-4444-555555555555";
const secret = "synthetic-independent-development-primary-email-key";
const jwt = (aal: string) => `fixture.${Buffer.from(JSON.stringify({ aal })).toString("base64url")}.fixture`;

async function scenario(run: (f: {
  req: Request; res: Response; cookies: Map<string, string>; requests: string[]; options: Record<string, unknown>[];
  payload: () => Payload; advance: (n: number) => void; eligible: (v: boolean) => void;
  mailbox: (email: string, verified: boolean, totp: boolean) => void; providerFailure: (v: boolean) => void;
}) => Promise<void>, environment: "development" | "staging" | "production" = "development") {
  const before = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "test", QXLAYER_EXTERNAL_ENVIRONMENT: "development",
    QXLAYER_AUTH_PROVIDER: "supabase", QXLAYER_DATABASE_PROVIDER: "replit",
    REPLIT_DEV_DOMAIN: "email-login-test.replit.dev",
    QXLAYER_DEVELOPMENT_SUPABASE_AUTH_URL: "https://email-login-test.replit.dev",
    QXLAYER_DEVELOPMENT_SUPABASE_AUTH_PROJECT_REF: "nktstksmfpcsjnjbeqsk",
    QXLAYER_DEVELOPMENT_SUPABASE_AUTH_SERVER_KEY: "sb_secret_synthetic",
    QXLAYER_DEVELOPMENT_SUPABASE_AUTH_SESSION_SECRET: secret,
    QXLAYER_DEVELOPMENT_SUPABASE_AUTH_MAIL_READY: "true" });
  if (environment === "staging") Object.assign(process.env, {
    QXLAYER_EXTERNAL_ENVIRONMENT: "staging",
    QXLAYER_SUPABASE_AUTH_URL: "https://email-login-test.replit.dev",
    QXLAYER_SUPABASE_AUTH_PROJECT_REF: "muvedavhbpgpdrrnjrih",
    QXLAYER_SUPABASE_AUTH_SERVER_KEY: "sb_secret_synthetic_staging",
    QXLAYER_SUPABASE_AUTH_SESSION_SECRET: secret,
    QXLAYER_SUPABASE_AUTH_MAIL_READY: "true",
  });
  if (environment === "production") {
    delete process.env.QXLAYER_SUPABASE_AUTH_TRIAL_ENABLED;
    delete process.env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_TRIAL_ENABLED;
    delete process.env.QXLAYER_SUPABASE_AUTH_SESSION_SECRET;
    delete process.env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_SESSION_SECRET;
    Object.assign(process.env, {
      NODE_ENV: "production", QXLAYER_EXTERNAL_ENVIRONMENT: "production",
      QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED: "true",
      QXLAYER_PRODUCTION_SUPABASE_AUTH_URL: "https://www.quicklychan.xyz",
      QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF: "abcdefghijklmnopqrst",
      QXLAYER_PRODUCTION_SUPABASE_AUTH_SERVER_KEY: "sb_secret_synthetic_production",
      QXLAYER_PRODUCTION_SUPABASE_AUTH_SESSION_SECRET: secret,
      QXLAYER_PRODUCTION_SUPABASE_AUTH_MAIL_READY: "true",
    });
  }
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const codec = sessionCodec(secret);
  const cookies = new Map<string, string>(), requests: string[] = [], options: Record<string, unknown>[] = [];
  const rows = new Map<string, { hits: number; reset: number }>();
  let envelope = "", eligible = true, providerFailure = false;
  const user = { id: subject, email: "synthetic@gmail.com", email_confirmed_at: "2026-01-01" as string | null,
    factors: [{ id: factor, factor_type: "totp", status: "verified" }] };
  function query(sql: string, values: unknown[] = []) {
    assert(!/(?:INSERT INTO|UPDATE|DELETE FROM) public\./.test(sql), "No role/business writes permitted");
    if (sql.includes("SELECT DISTINCT COALESCE") || sql.startsWith("SELECT subject::text FROM vynox_supabase_auth.active_admin_subjects"))
      return { rowCount: 1, rows: [{ subject }] };
    if (sql.includes("public.platform_admins") || sql.includes("EXISTS(SELECT 1 FROM vynox_supabase_auth.active_admin_subjects"))
      return { rowCount: 1, rows: [{ eligible }] };
    if (sql.includes("identity_links")) return { rowCount: 1, rows: [{ business_id: "preserved-synthetic-id" }] };
    if (sql.includes("INSERT INTO vynox_supabase_auth.sessions")) envelope = String(values[2]);
    if (sql.includes("UPDATE vynox_supabase_auth.sessions")) envelope = String(values[1]);
    if (sql.includes("SELECT envelope")) return { rowCount: envelope ? 1 : 0, rows: envelope ? [{ envelope }] : [] };
    if (sql.includes("SELECT 1 FROM vynox_supabase_auth.rate_limits")) {
      const r = rows.get(String(values[0]));
      return { rowCount: r && r.reset > Date.now() && r.hits < 5 ? 1 : 0, rows: [] };
    }
    if (sql.includes("VALUES($1,0,to_timestamp")) {
      rows.set(String(values[0]), { hits: 0, reset: Number(values[1]) * 1000 });
    } else if (sql.includes("INSERT INTO vynox_supabase_auth.rate_limits")) {
      const key = String(values[0]), old = rows.get(key);
      const seconds = typeof values[1] === "number" ? values[1] : 60;
      const r = old && old.reset > Date.now() ? { ...old, hits: old.hits + 1 }
        : { hits: 1, reset: Date.now() + seconds * 1000 };
      rows.set(key, r);
      return { rowCount: 1, rows: [{ hits: r.hits, retry_after: Math.ceil((r.reset - Date.now()) / 1000) }] };
    } else if (sql.includes("SET hits=hits+1")) {
      const r = rows.get(String(values[0]));
      if (!r || r.reset <= Date.now() || r.hits >= 5) return { rowCount: 0, rows: [] };
      r.hits++; return { rowCount: 1, rows: [{ hits: r.hits }] };
    } else if (sql.includes("SET hits=5")) {
      rows.get(String(values[0]))!.hits = 5;
    }
    return { rowCount: 1, rows: [{ hits: 1 }] };
  }
  let tail = Promise.resolve();
  mock.method(pool, "query", async (sql: string, values: unknown[] = []) => query(sql, values));
  mock.method(pool, "connect", async () => {
    let unlock: (() => void) | undefined;
    return { async query(sql: string, values: unknown[] = []) {
      if (sql === "BEGIN") {
        const previous = tail; tail = new Promise<void>(r => { unlock = r; }); await previous;
      }
      const result = query(sql, values);
      if (sql === "COMMIT" || sql === "ROLLBACK") { unlock?.(); unlock = undefined; }
      return result;
    }, release() { unlock?.(); } };
  });
  mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    requests.push(`${init?.method ?? "GET"} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith("/otp")) {
      assert.equal(body.create_user, false);
      assert.equal(body.email, "synthetic@gmail.com");
      return new globalThis.Response("{}", { status: providerFailure ? 503 : 200 });
    }
    if (path === "/auth/v1/verify") {
      if (body.token !== "246810") return new globalThis.Response('{"error_code":"otp_expired"}', { status: 400 });
      // Deliberately accept duplicate upstream verification: app must serialize it.
      return new globalThis.Response(JSON.stringify({ user, access_token: jwt("aal1"), refresh_token: "fixture-refresh", expires_in: 3600 }));
    }
    if (path.endsWith("/challenge")) return new globalThis.Response('{"id":"fixture-challenge"}');
    if (path.endsWith("/verify")) return new globalThis.Response(JSON.stringify({
      user, access_token: jwt("aal2"), refresh_token: "fixture-refresh", expires_in: 3600 }));
    return new globalThis.Response(JSON.stringify(user));
  });
  const headers = {} as Record<string, string>;
  Object.defineProperty(headers, "cookie", { get: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") });
  const req = { headers, get: (name: string) => headers[name.toLowerCase()],
    socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
  const res = { cookie(k: string, v: string, o: Record<string, unknown>) { cookies.set(k, v); options.push(o); },
    clearCookie(k: string) { cookies.delete(k); } } as unknown as Response;
  try {
    await run({ req, res, cookies, requests, options, payload: () => codec.open<Payload>(envelope),
      advance: n => mock.timers.tick(n), eligible: v => { eligible = v; }, providerFailure: v => { providerFailure = v; },
      mailbox: (email, verified, totp) => { user.email = email; user.email_confirmed_at = verified ? "2026-01-01" : null;
        user.factors = totp ? [{ id: factor, factor_type: "totp", status: "verified" }] : []; } });
  } finally {
    mock.restoreAll(); mock.timers.reset();
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    Object.assign(process.env, before);
  }
}

test("email login replaces password but requires fresh native Google Authenticator before app assurance", async () => {
  await scenario(async f => {
    assert((await performAction({ action: "login-email-send", email: "synthetic@gmail.com" }, f.req, f.res)).ok);
    assert.equal(f.options[0].secure, true); assert.equal(f.options[0].httpOnly, true); assert.equal(f.options[0].maxAge, 300000);
    const result = await performAction({ action: "login-email-verify", email: "synthetic@gmail.com", code: "246810" }, f.req, f.res);
    assert.equal(result.mfaRequired, true);
    assert.equal(f.payload().emailPrimary, true);
    assert(f.cookies.has(SESSION_COOKIE)); assert(!f.cookies.has(EMAIL_LOGIN_COOKIE));
    const pending = await readSession(f.req);
    assert(pending);
    assert.equal(pending.aal2, false);
    assert.equal(await applicationMfaSatisfied(pending), false);
    assert.equal(await emailMfaEligible(pending), false);
    await assert.rejects(performAction({ action: "mfa-email-send" }, f.req, f.res), { status: 403 });
    await performAction({ action: "mfa-verify", code: "123456" }, f.req, f.res);
    const full = await readSession(f.req);
    assert(full?.aal2);
    assert.equal(f.payload().emailPrimaryTotpVerified, true);
    assert(await applicationMfaSatisfied(full));
    assert(f.requests.every(p => !/password|admin\/generate_link/.test(p)));
  });
});

for (const environment of ["staging", "production"] as const) {
  test(`${environment} Gmail first factor preserves roles and requires fresh verified TOTP`, async () => {
    await scenario(async f => {
      await sendEmailLogin("synthetic@gmail.com", f.req, f.res);
      await verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res);
      assert.equal((await readSession(f.req))?.aal2, false);
      await performAction({ action: "mfa-verify", code: "123456" }, f.req, f.res);
      assert.equal((await readSession(f.req))?.aal2, true);
      assert(f.requests.every(p => !/password|admin\/generate_link/.test(p)));
    }, environment);
  });
}
test("unknown, non-admin, unverified, non-Gmail and missing-TOTP accounts cannot get email login or create accounts", async () => {
  for (const variant of ["unknown", "non-admin", "unverified", "non-Gmail", "missing-TOTP"]) {
    await scenario(async f => {
      let email = "synthetic@gmail.com";
      if (variant === "unknown") email = "unknown@gmail.com";
      if (variant === "non-admin") f.eligible(false);
      if (variant === "unverified") f.mailbox(email, false, true);
      if (variant === "non-Gmail") { email = "synthetic@example.test"; f.mailbox(email, true, true); }
      if (variant === "missing-TOTP") f.mailbox(email, true, false);
      await sendEmailLogin(email, f.req, f.res);
      assert(f.cookies.has(EMAIL_LOGIN_COOKIE)); // Same generic presentation, no enumeration.
      assert(!f.requests.some(p => p.endsWith("/otp")));
      await assert.rejects(verifyEmailLogin(email, "246810", f.req, f.res), { status: 400 });
      assert(!f.cookies.has(SESSION_COOKIE));
    });
  }
});
test("five-minute expiry, browser/email binding, tampered cookies and used codes fail closed", async () => {
  await scenario(async f => {
    await sendEmailLogin("synthetic@gmail.com", f.req, f.res);
    await assert.rejects(verifyEmailLogin("other@gmail.com", "246810", f.req, f.res), { status: 400 });
    const saved = f.cookies.get(EMAIL_LOGIN_COOKIE)!;
    f.cookies.set(EMAIL_LOGIN_COOKIE, saved.slice(0, -2) + "zz");
    await assert.rejects(verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res), { status: 400 });
    f.cookies.set(EMAIL_LOGIN_COOKIE, saved); f.advance(300000);
    await assert.rejects(verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res), { status: 400 });
    assert(!f.cookies.has(SESSION_COOKIE));
  });
});
test("missing and expired browser challenges explain restarting rather than blaming a fresh code", async () => {
  await scenario(async f => {
    await assert.rejects(verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res),
      { status: 400, message: /EMAIL_LOGIN_RESTART:.*not available in this browser/ });
    assert(!f.requests.some(p => p.endsWith("/verify")));
    await sendEmailLogin("synthetic@gmail.com", f.req, f.res);
    f.advance(300000);
    await assert.rejects(verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res),
      { status: 400, message: /EMAIL_LOGIN_RESTART:.*five-minute.*expired/ });
    assert(!f.requests.some(p => p.endsWith("/verify")));
    assert(!f.cookies.has(SESSION_COOKIE));
  });
});
test("passwordless send readback confirms the exact browser cookie and cannot restore used challenges", async () => {
  await scenario(async f => {
    const result = await performAction({ action: "login-email-send", email: "synthetic@gmail.com" }, f.req, f.res);
    assert.equal(await emailLoginChallengeExpiresAt(f.req), result.emailLoginChallengeExpiresAt);
    const cookie = f.cookies.get(EMAIL_LOGIN_COOKIE)!;
    f.cookies.delete(EMAIL_LOGIN_COOKIE);
    assert.equal(await emailLoginChallengeExpiresAt(f.req), undefined);
    f.cookies.set(EMAIL_LOGIN_COOKIE, "tampered");
    assert.equal(await emailLoginChallengeExpiresAt(f.req), undefined);
    f.cookies.set(EMAIL_LOGIN_COOKIE, cookie);
    await verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res);
    f.cookies.set(EMAIL_LOGIN_COOKIE, cookie);
    assert.equal(await emailLoginChallengeExpiresAt(f.req), undefined);
  });
});
test("unknown-account passwordless challenges have the same readback shape without sending mail", async () => {
  await scenario(async f => {
    f.eligible(false);
    const result = await performAction({ action: "login-email-send", email: "synthetic@gmail.com" }, f.req, f.res);
    assert.equal(await emailLoginChallengeExpiresAt(f.req), result.emailLoginChallengeExpiresAt);
    assert(!f.requests.some(p => p.endsWith("/otp")));
    f.advance(300000);
    assert.equal(await emailLoginChallengeExpiresAt(f.req), undefined);
  });
});
test("wrong-code attempts persist and the sixth attempt cannot redeem even the correct code", async () => {
  await scenario(async f => {
    await sendEmailLogin("synthetic@gmail.com", f.req, f.res);
    for (let n = 0; n < 5; n++) await assert.rejects(verifyEmailLogin("synthetic@gmail.com", "000000", f.req, f.res), { status: 400 });
    await assert.rejects(verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res), { status: 400 });
    assert.equal(f.requests.filter(p => p === "POST /auth/v1/verify").length, 5);
  });
});
test("parallel correct submissions create only one session even if upstream accepts duplicates", async () => {
  await scenario(async f => {
    await sendEmailLogin("synthetic@gmail.com", f.req, f.res);
    const nonceCookie = f.cookies.get(EMAIL_LOGIN_COOKIE)!;
    const results = await Promise.allSettled([verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res),
      verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    f.cookies.set(EMAIL_LOGIN_COOKIE, nonceCookie);
    await assert.rejects(verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res), { status: 400 });
    assert.equal(f.requests.filter(p => p === "POST /auth/v1/verify").length, 1);
  });
});
test("send cooldown/hourly ceilings and provider failures do not change credentials or create sessions", async () => {
  await scenario(async f => {
    await sendEmailLogin("synthetic@gmail.com", f.req, f.res);
    await assert.rejects(sendEmailLogin("synthetic@gmail.com", f.req, f.res), { status: 429, retryAfterSeconds: 60 });
    for (let n = 0; n < 4; n++) { f.advance(61000); await sendEmailLogin("synthetic@gmail.com", f.req, f.res); }
    f.advance(61000); await assert.rejects(sendEmailLogin("synthetic@gmail.com", f.req, f.res), { status: 429 });
    assert(!f.cookies.has(SESSION_COOKIE));
  });
  await scenario(async f => {
    f.providerFailure(true);
    await assert.rejects(sendEmailLogin("synthetic@gmail.com", f.req, f.res), { status: 503 });
    assert(!f.cookies.has(EMAIL_LOGIN_COOKIE));
  });
});
test("recovery remains account-limited with useful wait time; different accounts are not conflated", async () => {
  await scenario(async f => {
    await limitAction(f.req, "recover", "first@example.test");
    await assert.rejects(limitAction(f.req, "recover", "first@example.test"), { status: 429, retryAfterSeconds: 60 });
    await limitAction(f.req, "recover", "second@example.test");
    f.advance(61000); await limitAction(f.req, "recover", "first@example.test");
    f.advance(61000); await limitAction(f.req, "recover", "first@example.test");
    f.advance(61000); await assert.rejects(limitAction(f.req, "recover", "first@example.test"), { status: 429 });
  });
});
test("provider 429 preserves bounded retry guidance rather than swallowing or bypassing it", async () => {
  await scenario(async () => {
    const transport = async () => new globalThis.Response('{"error_code":"over_email_send_rate_limit"}',
      { status: 429, headers: { "retry-after": "75" } });
    await assert.rejects(authRequest("/recover", { method: "POST", body: { email: "synthetic@example.test" } }, transport),
      { status: 429, retryAfterSeconds: 75 });
  });
});
test("unconfigured environments fail closed; exact code shape and role/subject injection protection", async () => {
  await scenario(async f => {
    assert(!input.safeParse({ action: "login-email-verify", email: "synthetic@gmail.com", code: "123456", role: "super_admin" }).success);
    assert(!input.safeParse({ action: "login-email-verify", email: "synthetic@gmail.com", code: "12345678" }).success);
    process.env.QXLAYER_EXTERNAL_ENVIRONMENT = "staging";
    await assert.rejects(performAction({ action: "login-email-send", email: "synthetic@gmail.com" }, f.req, f.res));
    assert.equal(f.requests.length, 0);
  });
});
test("email first factor stays gated if TOTP disappears or an unrelated native AAL2 token arrives", async () => {
  await scenario(async f => {
    await sendEmailLogin("synthetic@gmail.com", f.req, f.res);
    await verifyEmailLogin("synthetic@gmail.com", "246810", f.req, f.res);
    const s = await readSession(f.req); assert(s);
    await updateSession(s, { user: s.user, access_token: jwt("aal2"), refresh_token: "fixture-refresh", expires_in: 3600 });
    assert.equal((await readSession(f.req))?.aal2, false, "A fresh Google verification is still required");
    f.mailbox("synthetic@gmail.com", true, false);
    f.req.method = "GET";
    await assert.rejects(Promise.resolve(requireAuthentication(f.req, f.res, () => {})), { status: 428 });
  });
});
test("insecure TLS cannot deliver an email first factor", async () => {
  await scenario(async f => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    await assert.rejects(sendEmailLogin("synthetic@gmail.com", f.req, f.res), { status: 503 });
    assert.equal(f.requests.length, 0);
  });
});
test("login code and recovery share the same mailbox cooldown without bypassing native limits", async () => {
  await scenario(async f => {
    await sendEmailLogin("synthetic@gmail.com", f.req, f.res);
    await assert.rejects(limitAction(f.req, "recover", "synthetic@gmail.com"), { status: 429, retryAfterSeconds: 60 });
    f.advance(61000);
    await limitAction(f.req, "recover", "synthetic@gmail.com");
  });
});
test("native mailbox cooldown is explained without exposing private errors or understating app cooldown", async () => {
  await scenario(async () => {
    const transport = async () => new globalThis.Response(JSON.stringify({
      error_code: "over_email_send_rate_limit", msg: "For security purposes, you can only request this after 26 seconds.",
    }), { status: 429 });
    await assert.rejects(authRequest("/recover", { method: "POST", body: { email: "synthetic@example.test" } }, transport),
      { status: 429, retryAfterSeconds: 60, message: "An email was recently requested for this address. Wait 60 seconds before requesting another." });
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { authActionSessionError } from "./auth-action-session";

const user = { id: "synthetic", email: "synthetic@gmail.com", name: "", emailVerified: true,
  twoFactorEnabled: true, totpFactorId: null };
const pending = { user, recovery: false, mfaRequired: true, emailMfaAvailable: false, existingAccountLinked: false };

test("successful login requires the matching browser-bound non-recovery identity", () => {
  const input = { action: "login" as const, email: user.email, password: "synthetic" };
  assert.equal(authActionSessionError(input, pending), null);
  assert(authActionSessionError(input, { ...pending, user: null }));
  assert(authActionSessionError(input, { ...pending, recovery: true }));
  assert(authActionSessionError(input, { ...pending, user: { ...user, email: "other@gmail.com" } }));
  assert(authActionSessionError({ action: "login-email-verify", email: user.email, code: "123456" },
    { ...pending, mfaRequired: false }));
});

test("MFA success must survive the authoritative session readback", () => {
  for (const action of ["mfa-verify", "mfa-email-verify"] as const) {
    const input = { action, code: "123456" };
    assert(authActionSessionError(input, pending));
    assert(authActionSessionError(input, { ...pending, user: null, mfaRequired: false }));
    assert.equal(authActionSessionError(input, { ...pending, mfaRequired: false }), null);
  }
  assert.equal(authActionSessionError({ action: "mfa-verify", code: "123456" },
    { ...pending, recovery: true, mfaRequired: false }), null);
  assert(authActionSessionError({ action: "mfa-email-verify", code: "123456" },
    { ...pending, recovery: true, mfaRequired: false }));
});

test("customer email login without an enrolled factor accepts matching non-MFA readback", () => {
  const input = { action: "login-email-verify" as const, email: user.email, code: "123456" };
  const customer = { ...pending, user: { ...user, twoFactorEnabled: false }, mfaRequired: false };
  assert.equal(authActionSessionError(input, customer, { ok: true, mfaRequired: false }), null);
  assert(authActionSessionError(input, customer, { ok: true, mfaRequired: true }));
});

test("anonymous email sends require their exact new cookie receipt, not an authenticated identity", () => {
  const anonymous = { ...pending, user: null, mfaRequired: false };
  const input = { action: "login-email-send" as const, email: user.email };
  assert(authActionSessionError(input, anonymous, { ok: true, emailLoginChallengeExpiresAt: 123 }));
  assert(authActionSessionError(input, { ...anonymous, emailLoginChallengeExpiresAt: 122 },
    { ok: true, emailLoginChallengeExpiresAt: 123 }));
  assert.equal(authActionSessionError(input, { ...anonymous, emailLoginChallengeExpiresAt: 123 },
    { ok: true, emailLoginChallengeExpiresAt: 123 }), null);
  assert.equal(authActionSessionError({ action: "logout" }, anonymous), null);
});

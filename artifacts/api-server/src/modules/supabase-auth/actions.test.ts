import assert from "node:assert/strict";
import test from "node:test";
import { input } from "./actions";
import { assertAuthOrigin, hasVerifiedFactor, publicUser } from "./session";
import { authRequest } from "./provider";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";

test("public requests cannot supply roles, IDs, redirects or injected factor paths", () => {
  const signup = { action: "signup", email: "synthetic@example.com", name: "Test", password: "Synthetic-only-123" };
  assert(input.safeParse(signup).success);
  for (const extra of [{ role: "super_admin" }, { subject: "other" }, { redirectTo: "https://evil.invalid" }])
    assert(!input.safeParse({ ...signup, ...extra }).success);
  assert(!input.safeParse({ ...signup, password: "short" }).success);
  assert(!input.safeParse({ action: "mfa-verify", code: "123456", factorId: "../../user" }).success);
  assert(!input.safeParse({ action: "link-existing", businessId: "user_owner" }).success);
});
test("unverified factors do not unlock MFA; public sessions never contain provider tokens", () => {
  const user = { id: "00000000-0000-4000-8000-000000000001", email: "test@example.com",
    email_confirmed_at: "2026-01-01", factors: [{ id: "factor", factor_type: "totp", status: "unverified" }] };
  assert(!hasVerifiedFactor(user));
  assert.equal(publicUser(user).totpFactorId, null);
  user.factors[0].status = "verified";
  assert(hasVerifiedFactor(user));
  assert.equal(publicUser(user).totpFactorId, "factor");
  assert(!JSON.stringify(publicUser(user)).includes("token"));
});
test("Customer, Client Admin and Super Admin keep explicit role and tenant boundaries", () => {
  const customer: Principal = { userId: "supabase:test", role: "unassigned", memberships: [] };
  const client: Principal = { ...customer, role: "client_admin", memberships: [{ tenantId: "own", role: "client_admin" }] };
  const admin: Principal = { ...customer, role: "super_admin" };
  assert.throws(() => contextFor(customer, "own"));
  assert.throws(() => requireSuperAdmin(customer));
  assert.throws(() => requireSuperAdmin(client));
  assert.throws(() => contextFor(client, "other"));
  assert(contextFor(client, "own", true).canWrite);
  assert(contextFor(admin, "other", true).isSuperAdmin);
});
test("provider transport is pinned and strips private error content", async () => {
  const before = { ...process.env };
  Object.assign(process.env, { QXLAYER_EXTERNAL_ENVIRONMENT: "staging", QXLAYER_SUPABASE_AUTH_TRIAL_ENABLED: "true",
    QXLAYER_SUPABASE_AUTH_URL: "https://stage.example.com", QXLAYER_SUPABASE_AUTH_PROJECT_REF: "muvedavhbpgpdrrnjrih",
    QXLAYER_SUPABASE_AUTH_SERVER_KEY: "synthetic-server-key" });
  try {
    const transport = (async (url: unknown, opts: RequestInit) => {
      const target = new URL(String(url));
      assert.equal(target.origin + target.pathname, "https://muvedavhbpgpdrrnjrih.supabase.co/auth/v1/signup");
      assert.equal(target.searchParams.get("redirect_to"), "https://stage.example.com/verify-email");
      assert.equal(opts.redirect, "error");
      return new Response(JSON.stringify({ error_code: "invalid_credentials", message: "DO-NOT-EXPOSE-private-value" }), { status: 400 });
    }) as typeof fetch;
    await assert.rejects(authRequest("/signup", { method: "POST" }, transport), e =>
      e instanceof Error && !e.message.includes("DO-NOT-EXPOSE") && e.message === "Email or password is incorrect.");
    await assert.rejects(authRequest("/admin/users", {}, transport));
    for (const origin of ["https://evil.example", "null", undefined])
      assert.throws(() => assertAuthOrigin({ get: (k: string) => k === "origin" ? origin : undefined } as never));
    assertAuthOrigin({ get: (k: string) => k === "origin" ? "https://stage.example.com" : "same-origin" } as never);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    Object.assign(process.env, before);
  }
});

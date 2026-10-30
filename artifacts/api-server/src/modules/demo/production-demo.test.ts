import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import { pool } from "@workspace/db";
import isolation from "../../routes/demo-isolation";
import demo from "../../routes/demo";
import { DEMO_TENANT_ID } from "./fixture";
import { HttpError } from "../../lib/errors";
import { issuePreview, verifyPreview } from "../website/operator-preview";
import { signProof, readProof } from "../../lib/scoped-proof";

test("Production preview binds authentication, tenant, expiry and purpose; fails closed", () => {
  const env = { NODE_ENV: process.env.NODE_ENV, SESSION_SECRET: process.env.SESSION_SECRET };
  try {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = randomBytes(32).toString("hex");
    const { token } = issuePreview(DEMO_TENANT_ID, "isolated-preview", "user_operator");
    assert(verifyPreview(token, "isolated-preview", "user_operator"));
    for (const actor of [null, undefined, "", "user_foreign"]) assert.equal(verifyPreview(token, "isolated-preview", actor), null);
    assert.equal(verifyPreview(token, "other-tenant", "user_operator"), null);
    assert.equal(verifyPreview(`x${token}`, "isolated-preview", "user_operator"), null);
    assert.equal(readProof("authenticated-operator-preview", `${token.split(".")[0]}.${"é".repeat(43)}`), null);
    assert.equal(verifyPreview(signProof("authenticated-operator-preview", { tenantId: DEMO_TENANT_ID, slug: "isolated-preview", actorId: "user_operator", expiresAt: Date.now() - 1 }), "isolated-preview", "user_operator"), null);
    assert.equal(readProof("isolated-admin-demo", token), null);
    delete process.env.SESSION_SECRET;
    assert.equal(verifyPreview(token, "isolated-preview", "user_operator"), null);
    assert.throws(() => issuePreview(DEMO_TENANT_ID, "isolated-preview", "user_operator"));
  } finally { for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test("Production-mode demo HTTP: all actions, snapshots, tracking and admin sections; no DB access, privilege or persistence", async () => {
  const env = { NODE_ENV: process.env.NODE_ENV, SESSION_SECRET: process.env.SESSION_SECRET,
    QXLAYER_AUTH_PROVIDER: process.env.QXLAYER_AUTH_PROVIDER,
    QXLAYER_DEVELOPMENT_SUPABASE_AUTH_TRIAL_ENABLED: process.env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_TRIAL_ENABLED,
    QXLAYER_SUPABASE_AUTH_TRIAL_ENABLED: process.env.QXLAYER_SUPABASE_AUTH_TRIAL_ENABLED };
  const connect = pool.connect;
  let dbAttempts = 0;
  // Fail the test if any demo request reaches database-backed application services.
  pool.connect = (() => { dbAttempts++; throw new Error("Demo touched the database"); }) as typeof pool.connect;
  process.env.NODE_ENV = "production";
  // Isolate the public demo test from the workspace's Development-only auth.
  // This test does not activate a Production authentication provider.
  process.env.QXLAYER_AUTH_PROVIDER = "disabled";
  process.env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_TRIAL_ENABLED = "false";
  process.env.QXLAYER_SUPABASE_AUTH_TRIAL_ENABLED = "false";
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  const app = express();
  app.use(express.json());
  app.use("/api", isolation, demo);
  app.get("/api/me", (_req, res) => res.json({ realSessionUnchanged: true }));
  app.use(((e: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(e instanceof HttpError ? e.status : 500).json({ error: e.message });
  }) as express.ErrorRequestHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  let cookie = "";
  async function request(path: string, status: number, method = "GET", body?: unknown, demoIntent = false, extra: Record<string, string> = {}) {
    const r = await fetch(`${base}/api${path}`, { method, headers: { Origin: base, "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}), ...(demoIntent ? { "X-QX-Demo": "read-only" } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    // Endpoint response shapes vary; the production route schemas validate each
    // response. This helper exercises the wire-level contracts and status codes.
    const data: any = await r.json();
    assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    if (method === "POST" && path === "/demo/session" && status === 200) {
      const setCookie = r.headers.getSetCookie()[0];
      assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /Secure/i);
      cookie = setCookie.split(";")[0];
    }
    return data;
  }
  try {
    await request("/demo/session", 400, "POST", { username: "old-public-credentials" });
    await request("/demo/session", 403, "POST", {}, false, { Origin: "https://foreign.invalid" });
    await request("/demo/session", 200, "POST", {});
    assert.equal((await request("/me", 200)).realSessionUnchanged, true, "demo cookie shadowed real identity");
    const principal = await request("/me", 200, "GET", undefined, true);
    assert.equal(principal.role, "staff"); assert(principal.demo); assert.deepEqual(principal.memberships[0].permissions, []);
    const root = `/tenants/${DEMO_TENANT_ID}`;
    assert.equal((await request("/asset-networks", 200, "GET", undefined, true)).length, 3);
    assert((await request("/entitlement-definitions", 200, "GET", undefined, true)).some((r: { key: string }) => r.key === "swap"));
    for (const path of [root, `${root}/subscription`, `${root}/exchange`, `${root}/exchange/dashboard`, `${root}/exchange/orders`,
      `${root}/exchange/customers`, `${root}/resources/staff`, `${root}/exchange/audit`, `${root}/provider-foundation`,
      `${root}/domain-verification`, `${root}/exchange/preview-integrations`]) {
      await request(path, 200, "GET", undefined, true);
    }
    assert.equal((await request(`${root}/exchange/orders?view=active`, 200, "GET", undefined, true)).total, 2);
    assert.equal((await request(`${root}/exchange/orders?view=archived`, 200, "GET", undefined, true)).total, 2);
    assert.equal((await request(`${root}/exchange/orders?from=2026-02-01`, 200, "GET", undefined, true)).total, 0);
    assert.equal((await request(`${root}/exchange/orders?page=2`, 200, "GET", undefined, true)).orders.length, 0);
    await request(`${root}/exchange/orders?from=2026-01-31&to=2026-01-01`, 400, "GET", undefined, true);
    for (const path of ["/plans", "/providers", "/customer/profile", "/operator/white-label-requests",
      `/tenants/${randomUUID()}`, `${root}/resources/api_keys`, `${root}/website-preview/open`]) {
      await request(path, 403, "GET", undefined, true);
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) for (const path of [root, `${root}/exchange`, `${root}/exchange/orders`,
      `${root}/provider-assignments`, "/plans", "/operator/white-label-requests"]) {
      await request(path, 403, method, { role: "super_admin" }, true);
    }
    await request("/public/sites/novax-live-demo", 200);
    await request("/public/sites/nova%78-live-demo", 200);
    const config = await request("/public/sites/novax-live-demo/exchange", 200);
    assert.equal(config.routes.length, 12);
    assert.deepEqual([...new Set(config.routes.map((r: { action: string }) => r.action))].sort(), ["convert", "swap"]);
    await request("/public/sites/novax-live-demo/exchange/quotes", 403, "POST", {}, true);
    for (const action of ["swap", "convert"]) {
      const route = config.routes.find((r: { action: string }) => r.action === action);
      const q = await request("/public/sites/novax-live-demo/exchange/quotes", 200, "POST", { action, source: route.source,
        destination: route.destination, amount: "0.025", ...(route.paymentMethodIds.length ? { paymentMethodId: route.paymentMethodIds[0] } : {}) });
      const body = { quoteToken: q.token, idempotencyKey: randomUUID() };
      const created = await request("/public/sites/novax-live-demo/exchange/orders", 201, "POST", body);
      const repeat = await request("/public/sites/novax-live-demo/exchange/orders", 201, "POST", body);
      assert.deepEqual(repeat.order, created.order);
      const tracked = await request(`/public/sites/novax-live-demo/exchange/orders/${created.order.id}`, 200, "GET", undefined, false, { trackingToken: created.trackingToken });
      assert.deepEqual(tracked, created.order); assert.equal(tracked.outputAmount, q.outputAmount);
      await request(`/public/sites/novax-live-demo/exchange/orders/${created.order.id}`, 404);
    }
    await request("/demo/session", 200, "DELETE", undefined, true);
    assert.equal(dbAttempts, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    pool.connect = connect;
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

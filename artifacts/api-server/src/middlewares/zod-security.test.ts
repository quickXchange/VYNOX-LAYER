import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { z } from "zod";
import { z as v4 } from "zod/v4";
import {
  SaveExchangeConfigurationBody, GetTenantParams, GetReleasedSiteConfigResponse,
  ListExchangeOrdersQueryParams, PerformSupabaseAuthActionBody, UpdateTenantModulesBody,
} from "@workspace/api-zod";
import { input as authInput } from "../modules/supabase-auth/actions";
import { settingsSchema } from "../modules/integrations/input";
import { jsonBody, formBody, requestBodyBudget } from "./request-body";

function oversizedArray() {
  const values = new Array(100_000);
  Object.defineProperty(values, 0, { get() { assert.fail("Oversized collection element was visited"); } });
  return values;
}

test("patched root, v4, generated and integration collections fail before visiting elements", async () => {
  assert.equal(z.ZodError, v4.ZodError);
  for (const schema of [
    z.array(z.string()).max(2), v4.array(v4.string()).length(2),
    SaveExchangeConfigurationBody.shape.fiatCurrencies,
    settingsSchema.shape.assignments,
  ]) {
    for (const result of [schema.safeParse(oversizedArray()), await schema.safeParseAsync(oversizedArray())]) {
      assert.equal(result.success, false);
      assert.equal(result.error!.issues.length, 1);
      assert.equal(result.error!.issues[0].code, "too_big");
      assert(result.error instanceof z.ZodError);
    }
  }
});

test("non-JSON Maps and Sets are capped before element validation", () => {
  let visits = 0;
  const element = z.string().superRefine(() => { visits++; });
  for (const [schema, data] of [
    [z.map(element, element).max(1), new Map([["a", "b"], ["c", "d"]])],
    [z.set(element).max(1), new Set(["a", "b"])],
  ] as const) {
    const result = schema.safeParse(data);
    assert.equal(result.error?.issues.length, 1);
    assert.equal(result.error?.issues[0].code, "too_big");
  }
  assert.equal(visits, 0);
});

test("contract UUIDs, integers, coercion and auth validation remain compatible", () => {
  const guid = "ABCDEF00-0000-0000-0000-000000000001";
  assert.equal(GetTenantParams.parse({ tenantId: guid, ignored: true }).tenantId, guid);
  assert(!("ignored" in GetTenantParams.parse({ tenantId: guid, ignored: true })));
  assert(!GetTenantParams.safeParse({ tenantId: "../../other" }).success);
  assert.equal(GetReleasedSiteConfigResponse.shape.schema_version.parse(2 ** 53), 2 ** 53);
  assert(!GetReleasedSiteConfigResponse.shape.schema_version.safeParse(1.5).success);
  assert.equal(ListExchangeOrdersQueryParams.parse({ page: "2" }).page, 2);
  assert(!ListExchangeOrdersQueryParams.safeParse({ page: "1.5" }).success);
  const login = { action: "login", email: "O'Connor+tag@EXAMPLE.com", password: "test-only" };
  assert(PerformSupabaseAuthActionBody.safeParse(login).success);
  assert.equal(authInput.parse(login).action, "login");
  assert(!authInput.safeParse({ ...login, role: "super_admin" }).success);
  for (const email of [".bad@example.com", "a..b@example.com", "a@invalid"]) {
    assert(!PerformSupabaseAuthActionBody.safeParse({ ...login, email }).success);
    assert(!authInput.safeParse({ ...login, email }).success);
  }
});

test("JSON, forms and repeated query parameters stay bounded and server remains responsive", async () => {
  const app = express();
  app.use(jsonBody, formBody, requestBodyBudget);
  let validations = 0;
  app.post("/", (req, res) => {
    validations++;
    const result = UpdateTenantModulesBody.safeParse(req.body);
    res.status(result.success ? 200 : 400).json({ ok: result.success });
  });
  app.get("/", (req, res) => {
    const result = ListExchangeOrdersQueryParams.safeParse(req.query);
    res.status(result.success ? 200 : 400).json({ ok: result.success });
  });
  app.use(((err, _req, res, _next) => res.status(err.status || 500).json({ error: "Rejected" })) as express.ErrorRequestHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleKeys: Array(20_001).fill(0) }) })).status, 413);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: Array(1001).fill("moduleKeys[]=0").join("&") })).status, 413);
    assert.equal(validations, 0);
    assert.equal((await fetch(`${url}?page=1&page=2`)).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "moduleKeys[]=exchange" })).status, 200);
    assert.equal((await fetch(`${url}?page=1`)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

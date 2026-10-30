import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { gzipSync } from "node:zlib";
import { bodyWithinBudget, jsonBody, formBody, requestBodyBudget } from "./request-body";

test("normal input and literal SQL/XSS-looking strings remain data", () => {
  assert.equal(bodyWithinBudget({ name: "O'Connor", description: "'; DROP TABLE users; -- <script>" }), true);
  assert.equal(bodyWithinBudget({ values: Array(1000).fill("valid") }), true);
});
test("deep nesting and oversized collections are bounded before validation", () => {
  let body: unknown = "value";
  for (let i = 0; i < 70; i++) body = { child: body };
  assert.equal(bodyWithinBudget(body), false);
  assert.equal(bodyWithinBudget(Array(20001).fill(null)), false);
});
test("real HTTP parsers reject compressed and oversized bodies without crashing", async () => {
  const app = express();
  app.use(jsonBody, formBody, requestBodyBudget);
  app.post("/", (_req, res) => res.json({ ok: true }));
  app.use(((err, _req, res, _next) => res.status(err.status || 500).json({ error: "Rejected" })) as express.ErrorRequestHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const compressed = Buffer.concat([gzipSync('{"valid":true}'), Buffer.from("malicious-trailing-bytes")]);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, body: compressed })).status, 415);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"broken"' })).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "x".repeat(140000) }) })).status, 413);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"valid":true}' })).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

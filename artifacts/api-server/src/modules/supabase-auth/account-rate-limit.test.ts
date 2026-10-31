import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { authSupportPool } from "@workspace/db";
import { limitAction } from "./actions";
import { HttpError } from "../../lib/errors";

test("non-Development account budget survives IP rotation and contains no raw identifiers", async () => {
  const before = { ...process.env };
  const query = authSupportPool.query;
  Object.assign(process.env, {
    QXLAYER_EXTERNAL_ENVIRONMENT: "staging",
    QXLAYER_SUPABASE_AUTH_SESSION_SECRET: "synthetic-independent-staging-secret-at-least-32-characters",
  });
  const counters = new Map<string, number>();
  const sqlSeen: string[] = [];
  authSupportPool.query = (async (sql: string, values: string[]) => {
    assert.match(values[0], /^[a-f0-9]{64}$/);
    assert(!sql.includes("example.com"));
    sqlSeen.push(sql);
    const hits = (counters.get(values[0]) ?? 0) + 1;
    counters.set(values[0], hits);
    return { rows: [{ hits, retry_after: 60 }], rowCount: 1 };
  }) as typeof authSupportPool.query;
  const req = (n: number) => ({ socket: { remoteAddress: `192.0.2.${n}` }, headers: {} }) as Request;
  try {
    for (let i = 1; i <= 5; i++) await limitAction(req(i), "login", "synthetic@example.com");
    await assert.rejects(limitAction(req(6), "login", "SYNTHETIC@example.com"), e =>
      e instanceof HttpError && e.status === 429 && e.retryAfterSeconds === 60);
    await limitAction(req(6), "login", "other@example.com");
    assert(sqlSeen.some(sql => sql.includes("reset_at<=now()")));
    counters.clear(); // model a completed fixed window, never a permanent lockout
    await limitAction(req(7), "login", "synthetic@example.com");
  } finally {
    authSupportPool.query = query;
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    Object.assign(process.env, before);
  }
});

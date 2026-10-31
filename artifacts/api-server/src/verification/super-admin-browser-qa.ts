// Explicitly approved disposable Development identities. Never mounted in the app.
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { pool, authSupportPool } from "@workspace/db";
import { developmentSupabaseAuth, supabaseAuthConfiguration } from "../modules/supabase-auth/config";

assert(process.env.NODE_ENV === "development" && developmentSupabaseAuth());
assert.equal(process.env.SUPER_ADMIN_BROWSER_QA_APPROVED, "true");
const cfg = supabaseAuthConfiguration(); // Enforces the pinned Development provider.
const manifest = new URL("../../../../.local/super-admin-browser-qa.json", import.meta.url);
type Actor = { role: string; email: string; subject?: string };
type Scope = { marker: string; tenants: string[]; actors: Actor[] };
const credentials = new Map<string, string>();
async function admin(path: string, method = "GET", body?: unknown): Promise<any> {
  const r = await fetch(`${cfg.providerOrigin}/auth/v1/admin${path}`, {
    method, redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { apikey: cfg.apiKey, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.status === 404 && method === "GET") return null;
  if (!r.ok) throw Error(`Disposable provider operation failed (${r.status})`);
  return r.status === 204 ? {} : r.json();
}
async function save(scope: Scope) {
  await writeFile(manifest, JSON.stringify(scope), { mode: 0o600 });
}
async function cleanup(scope: Scope) {
  // Resolve interrupted creates only by the persisted exact email AND marker.
  for (const actor of scope.actors) {
    if (!actor.subject) {
      for (let page = 1; page <= 100; page++) {
        const list = await admin(`/users?page=${page}&per_page=100`);
        const found = list.users.filter((u: any) => u.email === actor.email &&
          u.app_metadata?.super_admin_qa === scope.marker);
        assert(found.length <= 1);
        if (found.length) { actor.subject = found[0].id; await save(scope); break; }
        if (list.users.length < 100) break;
        assert(page < 100);
      }
    }
    if (actor.subject) {
      const u = await admin(`/users/${actor.subject}`);
      if (u) assert.equal(u.app_metadata?.super_admin_qa, scope.marker);
    }
  }
  const ids = scope.actors.filter(a => a.subject).map(a => `supabase:${a.subject}`);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // No customer submissions/catalog writes are authorized in this read-only pass.
    const used = await db.query("SELECT 1 FROM white_label_requests WHERE customer_user_id=ANY($1::text[])", [ids]);
    assert.equal(used.rowCount, 0, "Unexpected business data; retain manifest for scoped cleanup.");
    await db.query("DELETE FROM tenant_memberships WHERE clerk_user_id=ANY($1::text[]) AND tenant_id=ANY($2::uuid[])", [ids, scope.tenants]);
    await db.query("DELETE FROM platform_admins WHERE clerk_user_id=ANY($1::text[])", [ids]);
    await db.query("DELETE FROM tenants WHERE id=ANY($1::uuid[]) AND slug LIKE $2", [scope.tenants, `audit-${scope.marker}-%`]);
    await db.query("COMMIT");
  } catch (e) { await db.query("ROLLBACK"); throw e; }
  finally { db.release(); }
  for (const actor of scope.actors) if (actor.subject) {
    await authSupportPool.query("DELETE FROM vynox_supabase_auth.sessions WHERE subject=$1", [actor.subject]);
    await authSupportPool.query("DELETE FROM vynox_supabase_auth.recovery_codes WHERE subject=$1", [actor.subject]);
    await authSupportPool.query("DELETE FROM vynox_supabase_auth.recovery_events WHERE subject=$1", [actor.subject]);
    if (await admin(`/users/${actor.subject}`)) await admin(`/users/${actor.subject}`, "DELETE");
    assert.equal(await admin(`/users/${actor.subject}`), null);
  }
  const remaining = await pool.query("SELECT 1 FROM platform_admins WHERE clerk_user_id=ANY($1::text[]) UNION ALL SELECT 1 FROM tenants WHERE id=ANY($2::uuid[])", [ids, scope.tenants]);
  assert.equal(remaining.rowCount, 0);
  await unlink(manifest);
}
if (process.argv[2] === "cleanup") {
  await cleanup(JSON.parse(await readFile(manifest, "utf8")));
  console.log(JSON.stringify({ cleanupVerified: true }));
  await Promise.all([...new Set([pool, authSupportPool])].map(p => p.end()));
} else {
  const marker = randomUUID();
  const scope: Scope = { marker, tenants: [randomUUID(), randomUUID()],
    actors: ["customer", "tenant-admin", "super-admin"].map(role => ({
      role, email: `audit-${role}-${marker}@example.test`,
    })) };
  await writeFile(manifest, JSON.stringify(scope), { flag: "wx", mode: 0o600 });
  try {
    for (const actor of scope.actors) {
      const password = `Aa1!${randomBytes(24).toString("base64url")}`;
      const user = await admin("/users", "POST", { email: actor.email, password, email_confirm: true,
        app_metadata: { super_admin_qa: marker }, user_metadata: { name: "Disposable audit account" } });
      actor.subject = user.id; credentials.set(actor.role, password); await save(scope);
    }
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      for (let i = 0; i < scope.tenants.length; i++)
        await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)",
          [scope.tenants[i], "Disposable security audit", `audit-${marker}-${i}`]);
      await db.query("INSERT INTO tenant_memberships(tenant_id,clerk_user_id,role) VALUES($1,$2,'client_admin')",
        [scope.tenants[0], `supabase:${scope.actors[1].subject}`]);
      await db.query("INSERT INTO platform_admins(clerk_user_id) VALUES($1)", [`supabase:${scope.actors[2].subject}`]);
      await db.query("COMMIT");
    } catch (e) { await db.query("ROLLBACK"); throw e; }
    finally { db.release(); }
  } catch {
    await cleanup(scope);
    throw Error("Fixture setup failed; disposable resources cleaned.");
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    // Only local Node clients; reject all browser-origin requests, no CORS.
    if (req.headers.origin || req.headers["sec-fetch-site"]) { res.writeHead(403).end("{}"); return; }
    try {
      if (req.method === "GET" && req.url === "/fixtures") {
        res.end(JSON.stringify({ origin: cfg.origin, tenants: scope.tenants,
          actors: scope.actors.map(a => ({ ...a, password: credentials.get(a.role) })) }));
      } else if (req.method === "POST" && req.url === "/cleanup") {
        await cleanup(scope); credentials.clear();
        res.end(JSON.stringify({ cleanupVerified: true }));
        server.close();
        await Promise.all([...new Set([pool, authSupportPool])].map(p => p.end()));
      } else res.writeHead(404).end("{}");
    } catch {
      if (!res.headersSent) res.writeHead(500).end('{"error":"Scoped operation failed; inspect cleanup manifest"}');
      else console.error("Fixture helper shutdown failed after response.");
    }
  });
  server.listen(9385, "127.0.0.1", () => console.log(JSON.stringify({ ready: true, roles: 3, tenants: 2, brokerPort: 9385 })));
}

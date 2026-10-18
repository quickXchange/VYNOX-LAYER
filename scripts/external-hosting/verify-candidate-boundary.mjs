import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
const headers = { Authorization: `Bearer ${process.env.RENDER_API_KEY}` };
const get = async path => {
  const r = await fetch(`https://api.render.com/v1/${path}`, { headers, redirect: "error", signal: AbortSignal.timeout(30000) });
  assert(r.ok, `Candidate boundary unavailable: HTTP ${r.status}`);
  return r.json();
};
const [api, worker, staging, production, variables] = await Promise.all([
  get("services/srv-db5b47qjnfac739s374g"),
  get("services/srv-db5b48o473hc73ah56d0"),
  get("env-groups/evg-db5ate8473hc73agdon0"),
  get("env-groups/evg-db936g3bc2fs73cmm5dg"),
  get("services/srv-db5b47qjnfac739s374g/env-vars?limit=100"),
]);
// Service-level values override linked groups on Render.
assert(variables.length < 100, "Paginated service configuration needs explicit reconciliation");
const linked = group => group.serviceLinks.some(s => s.id === api.id);
assert.notEqual(linked(staging), linked(production), "Exactly one candidate configuration must be linked");
const group = linked(production) ? production : staging;
const env = Object.fromEntries([...group.envVars, ...variables.map(e => e.envVar)]
  .map(e => [e.key, e.value]));
assert.equal(api.repo, "https://github.com/quickXchange/VYNOX-LAYER");
assert.equal(api.branch, "main");
assert.equal(api.serviceDetails.plan, "starter");
assert.equal(api.serviceDetails.envSpecificDetails.startCommand, "node scripts/external-hosting/start-api.mjs");
assert.equal(api.environmentId, group.environmentId);
assert.equal(worker.suspended, "suspended");
const acceptance = env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED === "true";
assert.equal(env.QXLAYER_EXTERNAL_STARTUP_APPROVED, acceptance ? "true" : "false");
const productionOnly = group.id === production.id;
assert.equal(env.QXLAYER_EXTERNAL_ENVIRONMENT, productionOnly ? "production" : "staging");
if (productionOnly) {
  assert.equal(env.QXLAYER_EXTERNAL_CANDIDATE, "true");
  assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED, "false");
  assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF, "qcgvhlphalxqzzsxqjhi");
  assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_URL, acceptance ?
    "https://qxlayer-acceptance-vynox3.vercel.app" : "https://www.quicklychan.xyz");
  assert(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_SERVER_KEY?.startsWith("sb_secret_"));
  if (env.DATABASE_URL) {
    assert.equal(decodeURIComponent(new URL(env.DATABASE_URL).username), "qxlayer_app.qcgvhlphalxqzzsxqjhi");
    assert.equal(decodeURIComponent(new URL(env.QXLAYER_PRODUCTION_AUTH_DATABASE_URL).username), "qxlayer_auth_app.qcgvhlphalxqzzsxqjhi");
  }
  if (acceptance) {
    assert.equal(env.QXLAYER_PRODUCTION_SCHEMA_VERIFIED, "true");
    assert(env.SESSION_SECRET?.length >= 32, "Application proof signing must be configured");
    const authOrigin = "https://qcgvhlphalxqzzsxqjhi.supabase.co";
    assert.equal(env.SUPABASE_STORAGE_URL, authOrigin);
    assert.equal(env.SUPABASE_STORAGE_BUCKET, "vynox-production-private");
    const authSettings = await fetch(`${authOrigin}/auth/v1/settings`, {
      headers: { apikey: env.QXLAYER_PRODUCTION_SUPABASE_AUTH_SERVER_KEY,
        Authorization: `Bearer ${env.QXLAYER_PRODUCTION_SUPABASE_AUTH_SERVER_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    assert(authSettings.ok); const settings = await authSettings.json();
    assert.equal(settings.disable_signup, false, "Customer registration must be available behind the private gate");
    assert.equal(settings.mailer_autoconfirm, false, "Customer email verification must remain required");
    const storage = await fetch(`${authOrigin}/storage/v1/bucket/${env.SUPABASE_STORAGE_BUCKET}`, {
      headers: { apikey: env.SUPABASE_STORAGE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_STORAGE_SERVICE_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    assert(storage.ok); assert.equal((await storage.json()).public, false, "Customer uploads must remain private");
  }
  const db = new URL(env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL);
  assert(db.hostname === "db.qcgvhlphalxqzzsxqjhi.supabase.co" ||
    (db.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(db.username) === "postgres.qcgvhlphalxqzzsxqjhi"));
  assert(Object.keys(env).every(k => !k.startsWith("QXLAYER_SUPABASE_AUTH_") &&
    !k.startsWith("QXLAYER_DEVELOPMENT_") && !k.includes("CLERK")));
}
assert.equal(env.QXLAYER_HEALTH_MONITOR_ENABLED, "false");
assert.equal(env.QXLAYER_HEALTH_MONITOR_MODE, "disabled");
assert.equal(env.PRODUCTION_ACCESS_GATE_ENABLED, "true");
assert.equal(process.env.GITHUB_REF_NAME, "main");
console.log("Pinned candidate only: startup hold, access gate and suspended worker verified; no Live activation.");
if (process.env.GITHUB_ENV)
  await appendFile(process.env.GITHUB_ENV,
    `CANDIDATE_AUTH_ENVIRONMENT=${productionOnly ? "production" : "staging"}\n` +
    `CANDIDATE_SUPABASE_PROJECT_REF=${productionOnly ? "qcgvhlphalxqzzsxqjhi" : ""}\n` +
    `CANDIDATE_AUTH_ORIGIN=${productionOnly ? env.QXLAYER_PRODUCTION_SUPABASE_AUTH_URL : ""}\n` +
    `CANDIDATE_ACCEPTANCE_APPROVED=${acceptance ? "true" : "false"}\n` +
    `CANDIDATE_REFERENCE_SYNC_ALLOWED=${env.QXLAYER_PUBLIC_PREPARATION_ACTIVE === "true" ? "false" : "true"}\n`);

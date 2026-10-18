import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicPreparation } from "../../lib/production-access-gate/public-preparation.mjs";

export function startupMode(env) {
  const mode = env.QXLAYER_EXTERNAL_ENVIRONMENT;
  assert(["staging", "production"].includes(mode), "Explicit external environment required");
  if (publicPreparation(env)) {
    assert.equal(env.QXLAYER_EXTERNAL_STARTUP_APPROVED, "true");
    assert.equal(env.QXLAYER_PRODUCTION_SCHEMA_VERIFIED, "true");
    assert.equal(env.QXLAYER_DATABASE_PROVIDER, "supabase");
    return "approved";
  }
  if (env.QXLAYER_EXTERNAL_CANDIDATE === "true") {
    assert.equal(mode, "production", "Production candidate must be explicit");
    if (env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED === "true") {
      assert.equal(env.QXLAYER_EXTERNAL_STARTUP_APPROVED, "true");
      assert.equal(env.QXLAYER_PRODUCTION_SCHEMA_VERIFIED, "true");
      assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED, "false");
      assert.equal(env.QXLAYER_PLATFORM_URL, "https://qxlayer-acceptance-vynox3.vercel.app");
      assert.equal(env.PRODUCTION_ACCESS_GATE_ENABLED, "true");
      assert.equal(env.QXLAYER_DATABASE_PROVIDER, "supabase");
      return "approved";
    }
    assert.equal(env.QXLAYER_EXTERNAL_STARTUP_APPROVED, "false", "Candidate cannot activate business routes");
    return "held";
  }
  if (mode === "staging" && env.QXLAYER_EXTERNAL_STARTUP_APPROVED === "false") return "held";
  assert.equal(env.QXLAYER_EXTERNAL_STARTUP_APPROVED, "true", "External startup remains unapproved");
  assert.equal(env.QXLAYER_DATABASE_PROVIDER, "supabase", "External database provider must be explicit");
  return "approved";
}

// No application/runtime-pool imports in held mode. A Production candidate may
// run its separate READ ONLY preflight; liveness never means business readiness.
export function createHeldCandidateServer({ environment = "staging", checks = {}, commit } = {}) {
  assert(["staging", "production"].includes(environment));
  assert(commit === undefined || /^[a-f0-9]{40}$/.test(commit));
  const server = createServer((req, res) => {
    const health = ["GET", "HEAD"].includes(req.method) &&
      (req.url ?? "").split("?")[0] === "/api/healthz";
    req.resume();
    res.writeHead(health ? 200 : 503, {
      "Content-Type": "application/json", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", ...(health ? {} : { "Retry-After": "300" }),
    });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({
      ...checks, ...(commit ? { commit } : {}), status: "held", ready: false, environment,
      startupApproved: false, businessRoutesEnabled: false, databaseConnected: false,
      ...(environment === "production" ? { databaseConnected: checks.databaseConnected === true } : {}),
    }));
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 32;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (startupMode(process.env) === "held") {
    const port = Number(process.env.PORT);
    assert(Number.isInteger(port) && port > 0 && port <= 65535, "Valid PORT required");
    const environment = process.env.QXLAYER_EXTERNAL_ENVIRONMENT;
    const checks = environment === "production" ? { preflightComplete: false } : {};
    const server = createHeldCandidateServer({ environment, checks,
      commit: process.env.RENDER_GIT_COMMIT }).listen(port, "0.0.0.0", () =>
      console.info("Candidate process held; business routes disabled."));
    if (environment === "production") {
      const { productionCandidatePreflight } = await import("./production-candidate-preflight.mjs");
      Object.assign(checks, await productionCandidatePreflight(process.env));
      console.info(JSON.stringify({ status: "held", ...checks }));
    }
    const close = () => {
      server.close(() => process.exit(0));
      setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 2000).unref();
    };
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
  } else {
    // Keep every existing approved startup/schema/Auth/runtime guard.
    await import("../../artifacts/api-server/dist/index.mjs");
  }
}

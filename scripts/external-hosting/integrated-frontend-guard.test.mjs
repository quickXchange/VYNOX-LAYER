import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { publicPreparation } from "../../lib/production-access-gate/public-preparation.mjs";

// Evaluate the actual configuration guard with only its static-serving factory stubbed.
const source = readFileSync(new URL("../../deploy/vercel/handler.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replaceAll("import.meta.url", JSON.stringify("file:///frontend/handler.mjs"))
  .replace("export default ", "globalThis.handler = ");
function load(overrides) {
  const env = { PRODUCTION_ACCESS_CODE: "synthetic-test-only", QXLAYER_STAGING_ACCESS_CODE: "s".repeat(43), PRODUCTION_ACCESS_GATE_ENABLED: "true",
    QXLAYER_EXTERNAL_ENVIRONMENT: "staging", VERCEL_ENV: "preview",
    VERCEL_URL: "qxlayer-staging-synthetic-team.vercel.app", ...overrides };
  runInNewContext(source, { process: { env }, URL, publicPreparation, fileURLToPath: () => "/static/",
    createStaticHandler: () => () => {} });
  return env;
}
test("Integrated Staging derives the immutable Preview origin", () => {
  assert.equal(load({}).QXLAYER_PLATFORM_URL, "https://qxlayer-staging-synthetic-team.vercel.app");
  assert.equal(load({ QXLAYER_PLATFORM_URL: "https://stale.invalid" }).QXLAYER_PLATFORM_URL,
    "https://qxlayer-staging-synthetic-team.vercel.app");
});
test("Integrated Staging rejects Production, missing metadata and foreign origins", () => {
  for (const overrides of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: undefined },
    { VERCEL_URL: "other-project.vercel.app" }, { VERCEL_URL: "qxlayer-staging-synthetic.vercel.app.attacker.invalid" }])
    assert.throws(() => load(overrides), /Preview-only/);
});
test("Private gate remains required and non-Staging keeps its explicit URL", () => {
  assert.throws(() => load({ PRODUCTION_ACCESS_GATE_ENABLED: "false" }), /Private Access/);
  assert.throws(() => load({ QXLAYER_STAGING_ACCESS_CODE: undefined }), /Private Access/);
  assert.equal(load({ QXLAYER_EXTERNAL_ENVIRONMENT: "production", VERCEL_ENV: "production",
    QXLAYER_PLATFORM_URL: "https://synthetic-production.invalid" }).QXLAYER_PLATFORM_URL,
    "https://synthetic-production.invalid");
});

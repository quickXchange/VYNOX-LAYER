import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { databaseIdentity, effectiveEnvironment, targetScopePreflight } from "./target-scope-preflight.mjs";
import { migrate } from "../external-postgres/migrate.mjs";

const direct = (project, role = "postgres", password = "private-password") =>
  `postgresql://${role}:${password}@db.${project}.supabase.co/postgres`;
const pooled = project => `postgres://runtime.${project}:other-secret@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=verify-full`;
const config = { renderServiceId: "srv-public", operatorTargetScope: {
  acceptanceServiceId: "srv-acceptance", publicServiceIds: ["srv-public"],
} };
const vars = values => Object.entries(values).map(([key, value]) => ({ key, value }));
function fixture({ publicUrl = direct("public"), overrides = {}, groups } = {}) {
  groups ??= [{ id: "evg-shared", serviceLinks: [{ id: "srv-acceptance" }, { id: "srv-public" }],
    envVars: vars({ DATABASE_URL: direct("acceptance") }) }];
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(options.method, undefined, "preflight must only GET provider configuration");
    const path = new URL(url).pathname.replace("/v1/", "");
    let data;
    if (path === "env-groups") data = groups.map(g => ({ envGroup: { id: g.id } }));
    else if (path.startsWith("env-groups/")) data = groups.find(g => path.endsWith(g.id));
    else if (path === "services/srv-public/env-vars") data = vars({ DATABASE_URL: publicUrl });
    else if (path === "services/srv-acceptance/env-vars") data = vars(overrides);
    else throw Error("Unexpected request");
    return { ok: true, json: async () => data };
  };
  return { config, connectionString: direct("acceptance"), token: "test-token", fetchImpl, calls };
}

test("database identity ignores credentials, role, pooler host and port, but retains project and database", () => {
  assert.equal(databaseIdentity(direct("alpha")), databaseIdentity(pooled("alpha")));
  assert.equal(databaseIdentity(direct("alpha", "other")), databaseIdentity(direct("alpha")));
  assert.notEqual(databaseIdentity(direct("alpha")), databaseIdentity(direct("beta")));
  assert.notEqual(databaseIdentity(direct("alpha")), databaseIdentity(direct("alpha").replace(/\/postgres$/, "/other")));
  for (const value of ["bad-secret", "postgres://user:secret@unknown/postgres",
    direct("alpha") + "?host=db.beta.supabase.co", direct("alpha") + "?options=-csearch_path=secret",
    direct("alpha").replace("5432", "6543") + "#secret"]) {
    assert.throws(() => databaseIdentity(value), e => !e.message.includes(value));
  }
});

test("service overrides beat groups; unresolved group collisions and duplicate keys fail closed", () => {
  const groups = ["one", "two"].map(value => ({ serviceLinks: [{ id: "srv-a" }], envVars: vars({ DATABASE_URL: value }) }));
  assert.deepEqual(effectiveEnvironment(groups, "srv-a", vars({ DATABASE_URL: "override" })), { DATABASE_URL: "override" });
  assert.throws(() => effectiveEnvironment(groups, "srv-a", []));
  assert.throws(() => effectiveEnvironment([], "srv-a", [...vars({ DATABASE_URL: "one" }), ...vars({ DATABASE_URL: "two" })]));
});

test("isolated Acceptance target succeeds using complete effective configuration", async () => {
  const result = await targetScopePreflight(fixture());
  assert.deepEqual(result.receipt, { scope: "acceptance-only", sharedPublicServices: [], targetVerified: true });
  assert(!JSON.stringify(result.receipt).includes("password"));
});

test("public override sharing the Acceptance pooler target blocks despite different group and hostname", async () => {
  await assert.rejects(targetScopePreflight(fixture({ publicUrl: pooled("acceptance") })), /Target-scope preflight blocked/);
});

test("inherited shared database and missing public configuration both block", async () => {
  const input = fixture();
  const noPublicOverride = async (url, options) => url.includes("services/srv-public/")
    ? { ok: true, json: async () => [] } : input.fetchImpl(url, options);
  await assert.rejects(targetScopePreflight({ ...input, fetchImpl: noPublicOverride }));
  const missing = fixture({ groups: [] });
  await assert.rejects(targetScopePreflight(missing));
});

test("every configured public service must be resolved, not just the primary", async () => {
  const input = fixture();
  input.config = structuredClone(config);
  input.config.operatorTargetScope.publicServiceIds.push("srv-other");
  await assert.rejects(targetScopePreflight(input));
});

test("Acceptance override supersedes its group and is compared with public target", async () => {
  const input = fixture({ publicUrl: direct("public"), overrides: { DATABASE_URL: pooled("public") } });
  input.connectionString = direct("public");
  await assert.rejects(targetScopePreflight(input), /Target-scope preflight blocked/);
  await assert.rejects(targetScopePreflight(fixture({ overrides: { DATABASE_URL: pooled("elsewhere") } })));
});

test("shared global writes require both public scope and explicit public approval", async () => {
  const input = fixture({ publicUrl: pooled("acceptance") });
  await assert.rejects(targetScopePreflight({ ...input, publicWriteApproved: true }));
  await assert.rejects(targetScopePreflight({ ...input, scope: "public" }));
  const result = await targetScopePreflight({ ...input, scope: "public", publicWriteApproved: true });
  assert.deepEqual(result.receipt.sharedPublicServices, ["srv-public"]);
  await assert.rejects(targetScopePreflight({ ...input, scope: "isolated" }));
  await assert.rejects(targetScopePreflight({ ...input, scope: "anything" }));
});

test("missing, failed, malformed and ambiguous provider readbacks fail without disclosing values", async () => {
  const input = fixture();
  for (const changes of [
    { token: "" }, { config: {} }, { publicUrl: "not-url" },
    { fetchImpl: async () => { throw Error("private-password test-token"); } },
    { fetchImpl: async () => ({ ok: false }) },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ error: "private-password" }) }) },
  ]) {
    const args = "publicUrl" in changes ? fixture(changes) : { ...input, ...changes };
    await assert.rejects(targetScopePreflight(args), error => {
      assert.equal(error.message.includes("private-password"), false);
      assert.equal(error.message.includes("test-token"), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("pagination cannot silently truncate configuration", async () => {
  const input = fixture({ overrides: { DATABASE_URL: direct("acceptance") } });
  await assert.rejects(targetScopePreflight({ ...input, fetchImpl: async () => ({
    ok: true, json: async () => Array.from({ length: 100 }, () => ({ envGroup: { id: "evg-a" } })),
  }) }));
  const pages = [];
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname === "/v1/env-groups") {
      pages.push(url);
      if (!new URL(url).searchParams.has("cursor")) return { ok: true, json: async () =>
        Array.from({ length: 100 }, (_, i) => ({ envGroup: { id: `evg-${i}` }, cursor: `cursor-${i}` })) };
      return { ok: true, json: async () => [] };
    }
    if (new URL(url).pathname.startsWith("/v1/env-groups/")) return { ok: true, json: async () =>
      ({ id: new URL(url).pathname.split("/").at(-1), serviceLinks: [], envVars: [] }) };
    return input.fetchImpl(url, options);
  };
  await targetScopePreflight({ ...input, fetchImpl });
  assert.equal(pages.length, 2);
  assert.match(pages[1], /cursor=cursor-99/);
});

test("migration scope failure precedes CA access, database connection and all SQL", async () => {
  await assert.rejects(migrate({
    QXLAYER_EXTERNAL_MIGRATIONS_APPROVED: "true", MIGRATION_DATABASE_URL: direct("alpha"),
    SUPABASE_PROJECT_REF: "alpha", MIGRATION_EXPECTED_HOST: "db.alpha.supabase.co",
    DB_TLS_CA_FILE: "/must-not-be-read", RENDER_API_KEY: "",
  }), /Target-scope preflight blocked/);
});

test("Staging schema workflow passes provider credentials and its isolated service scope", async () => {
  const yaml = await readFile(new URL("../../.github/workflows/external-release.yml", import.meta.url), "utf8");
  const step = yaml.split("- name: Apply approved external schema versions")[1].split("- name:")[0];
  assert.match(step, /RENDER_API_KEY: \$\{\{ secrets\.RENDER_API_KEY \}\}/);
  assert.match(step, /QXLAYER_OPERATOR_SERVICE_ID: \$\{\{ vars\.RENDER_API_SERVICE_ID \}\}/);
  assert.match(step, /QXLAYER_OPERATOR_WRITE_SCOPE: "isolated"/);
  assert(!step.includes("QXLAYER_PUBLIC_GLOBAL_WRITES_APPROVED"));
  const input = fixture({ overrides: { DATABASE_URL: pooled("staging") } });
  const result = await targetScopePreflight({ ...input, connectionString: direct("staging"),
    serviceId: "srv-acceptance", scope: "isolated" });
  assert.equal(result.receipt.targetVerified, true);
});

test("all global operator entrypoints preflight before creating a database client", async () => {
  for (const file of ["plan-entitlements-operator.mjs", "synchronize-reference-configuration.mjs", "../external-postgres/migrate.mjs"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const start = source.indexOf(file.startsWith("synchronize") ? "export async function synchronize" :
      file.includes("plan-entitlements") ? "export async function protectedOperator" : "export async function migrate");
    const body = source.slice(start);
    assert(body.indexOf("await targetScopePreflight(") < body.indexOf("new Client("));
  }
});

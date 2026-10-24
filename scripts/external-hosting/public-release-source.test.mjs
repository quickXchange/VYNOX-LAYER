import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertPublicReleaseTrigger, assertCurrentReleaseSource } from "./public-release-source.mjs";

const sha = "a".repeat(40);
const env = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_SHA: sha,
  GITHUB_REPOSITORY: "example/project", QXLAYER_AUTO_RELEASE_AFTER_CANDIDATE: "true", GITHUB_TOKEN: "synthetic" };
const event = { repository: { full_name: env.GITHUB_REPOSITORY }, ref: env.GITHUB_REF, after: sha, deleted: false, forced: false };
test("accepts approved main push and approved manual release", () => {
  assertPublicReleaseTrigger(env, event);
  assertPublicReleaseTrigger({ ...env, GITHUB_EVENT_NAME: "workflow_dispatch" },
    { ...event, inputs: { approve_temporary_production: "true" } });
});
test("rejects PRs, workflow_run events, other branches, missing chain, changed SHA and foreign events", () => {
  for (const patch of [{ GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_EVENT_NAME: "workflow_run" },
    { GITHUB_REF: "refs/heads/test" }, { QXLAYER_AUTO_RELEASE_AFTER_CANDIDATE: "false" }, { GITHUB_SHA: "invalid" }])
    assert.throws(() => assertPublicReleaseTrigger({ ...env, ...patch }, event));
  for (const patch of [{ after: "b".repeat(40) }, { deleted: true }, { forced: true },
    { ref: "refs/heads/test" }, { repository: { full_name: "other/project" } }])
    assert.throws(() => assertPublicReleaseTrigger(env, { ...event, ...patch }));
  assert.throws(() => assertPublicReleaseTrigger({ ...env, GITHUB_EVENT_NAME: "workflow_dispatch" },
    { ...event, inputs: { approve_temporary_production: "false" } }));
});
test("stale source and unavailable GitHub fail before deployment", async () => {
  await assertCurrentReleaseSource(env, event, async () => Response.json({ object: { sha } }));
  await assert.rejects(assertCurrentReleaseSource(env, event, async () => Response.json({ object: { sha: "b".repeat(40) } })), /Superseded/);
  await assert.rejects(assertCurrentReleaseSource(env, event, async () => new Response("", { status: 403 })), /HTTP 403/);
});
test("workflow chain waits for both successful jobs and pins production checkout", async () => {
  const candidate = await readFile(".github/workflows/external-sync.yml", "utf8");
  const production = await readFile(".github/workflows/public-preparation.yml", "utf8");
  assert.match(candidate, /needs: \[checks, candidate\]/);
  assert.match(candidate, /needs\.candidate\.result == 'success'/);
  assert.match(candidate, /needs\.checks\.result == 'success'/);
  assert.match(candidate, /github\.event_name == 'push'/);
  assert.match(production, /workflow_call:/);
  assert.match(production, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(production, /environment: vynox-public-preparation/);
  assert.match(production, /QXLAYER_FINANCIAL_EXECUTION_ENABLED: "false"/);
  assert(production.indexOf("node scripts/external-hosting/public-release-source.mjs") <
    production.indexOf("node scripts/external-hosting/release-render.mjs"));
});

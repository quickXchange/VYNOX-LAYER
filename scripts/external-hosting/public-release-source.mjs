import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** Reusable workflows retain the caller's event and SHA, not a new main checkout. */
export function assertPublicReleaseTrigger(env, event) {
  assert.equal(env.GITHUB_REF, "refs/heads/main", "Only main can release Production.");
  assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/, "Exact source SHA is required.");
  assert.match(env.GITHUB_REPOSITORY ?? "", /^[\w.-]+\/[\w.-]+$/);
  assert.equal(event.repository?.full_name, env.GITHUB_REPOSITORY, "Foreign repository event rejected.");
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    assert([true, "true"].includes(event.inputs?.approve_temporary_production), "Manual release requires approval.");
    return;
  }
  assert.equal(env.GITHUB_EVENT_NAME, "push", "Only approved manual or chained main-push releases are allowed.");
  assert.equal(env.QXLAYER_AUTO_RELEASE_AFTER_CANDIDATE, "true", "Automatic release requires the candidate chain.");
  assert.equal(event.ref, "refs/heads/main");
  assert.equal(event.after, env.GITHUB_SHA, "Release must use the original push SHA.");
  assert.equal(event.deleted, false);
  assert.notEqual(event.forced, true, "Force-pushed source requires a manual release.");
}

export async function assertCurrentReleaseSource(env, event, request = fetch) {
  assertPublicReleaseTrigger(env, event);
  assert(env.GITHUB_TOKEN, "Read-only GitHub token is required for source verification.");
  const response = await request(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/ref/heads/main`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28" },
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, `Unable to verify current main: HTTP ${response.status}`);
  const ref = await response.json();
  assert.equal(ref.object?.sha, env.GITHUB_SHA, "Superseded release: main has advanced. Let the newer candidate finish.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await assertCurrentReleaseSource(process.env, JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")));
  console.log("Approved release event and exact current source verified; no deployment performed by this check.");
}

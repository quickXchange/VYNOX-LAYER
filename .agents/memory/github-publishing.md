---
name: GitHub publishing
description: Authentication and integrity constraints when uploading this project to GitHub.
---

An active native GitHub source-control connection and successful public repository reads do not establish that workspace Git pushes are authenticated. A separately authorized GitHub App connection can work even when native Git push credentials are rejected.

**Why:** The native connection reported active and read the empty public repository, but rejected a push. The authorized GitHub App successfully performed the upload through its authenticated API proxy.

**How to apply:** Distinguish native source-control authentication from the GitHub App integration. Use the authorized integration without extracting credentials. Do not report a push as successful until the remote branch points to the expected commit.

Repository aliases may redirect API reads even when the configured Git remote is unchanged. The App proxy and an explicitly approved native credential may have different repository access.

**Why:** A bounded Staging read failed through the App proxy while the approved native API read succeeded after GitHub's same-provider repository alias redirect.

**How to apply:** Do not change the repository or connection merely to bypass an alias. Follow only validated HTTPS redirects on api.github.com to the provider's numeric repository path, and never forward credentials to another host. Preserve the existing remote and verify the exact Staging ref.

When reproducing existing Git history through the GitHub Git Data API, preserve commit messages byte-for-byte, including trailing newlines, and verify tree and commit hashes before updating a branch.

**Why:** Removing the original trailing newline preserved the visible message but changed the commit hash.

**How to apply:** Read the original commit object's message rather than trimming formatted Git output. Check each recreated tree and commit against its local hash; stop if another writer changes the destination branch.

Contents-write access through the GitHub App does not prove permission to change
GitHub Actions workflows. In this connection, tree writes containing workflow
changes returned HTTP 404, while application-only tree writes succeeded.

**Why:** Staging source synchronization encountered this boundary even though
blob creation and ordinary source-tree writes were authorized.

**How to apply:** When the user requires existing automation to remain unchanged,
preserve the remote workflow files and verify the resulting application/config
tree against that intentional scope. Do not claim a complete workflow/history
export. If workflow synchronization is requested, resolve its authorization
instead of silently excluding it. Keep Production branches unchanged when
publishing an isolated staging snapshot.

The integration proxy can throttle concurrent GitHub blob writes independently
of what successful repository reads suggest about available access.

**Why:** A burst of concurrent source-blob writes returned HTTP 429 during staging
synchronization.

**How to apply:** Bound write concurrency and payload sizes, honor rate-limit
backoff, and verify tree and branch integrity after synchronization rather than
assuming partial object uploads mean the source has been published.

For user-authorized native Git pushes with a saved PAT, use an ephemeral
credential helper reading `GITHUB_TOKEN`; never embed credentials in a remote URL
or persist them in Git configuration. Verify the destination ref afterward.

For a bounded Staging snapshot, determine changed files against the fetched
remote Staging revision, not just local HEAD or the worktree's clean status.

**Why:** Automatic workspace checkpoints can commit approved work before the
next release turn. A clean worktree does not mean Staging already has those
changes.

**How to apply:** Preserve the remote tree outside explicitly reviewed paths;
do not broaden a frontend release to backend, schema, package or workflow files
merely because the local checkpoint contains them.

**Why:** Direct native authentication succeeded where the source-control
connection lacked workflow permission. A token-shaped shell variable name does
not reference the saved `GITHUB_TOKEN` variable.

**How to apply:** Disable inherited Git traces before authenticated commands.
Unset `GIT_CURL_VERBOSE` entirely: setting it to `0` still enabled verbose HTTP
logging. Keep credential redaction enabled and capture/sanitize errors before
displaying them.

Bounded API snapshot releases do not advance the workspace's Git branch.
Before native GitHub Sync, fetch the actual remote and compare ancestry as well
as file contents. Preserve both histories with a normal merge, never force-push
the workspace checkpoint history over external releases.

**Why:** Identical application files coexisted with divergent local checkpoint
and externally deployed commit histories, blocking an ordinary Sync.

**How to apply:** Prove the merge result preserves the reviewed source tree,
then reconcile locally without prematurely pushing. A push dry-run alone does
not validate the Git panel's pull step.

Replit Sync uses an explicit `pull --rebase`. After merging snapshot-release
history, keep repository-local `rebase.rebaseMerges=true`; plain rebase flattens
the reconciliation and replays old checkpoints over their already-deployed
equivalents.

**Why:** The original Git-panel pull was reproduced as a conflict in the
landing Exchange demo. Merge-preserving rebase passed the identical command
while retaining the exact tip, tree and every original commit.

**How to apply:** Rehearse the actual panel pull command in a temporary clone,
assert ancestry and exact source preservation, then verify the real configured
pull and a normal push dry-run. Do not force-push, flatten the merge, reset
source or resolve this by discarding application code.

## GitHub-to-Vercel repair boundary

The user explicitly chose to retain the existing backend when repairing
GitHub-to-Vercel synchronization; this is not authorization for a Vercel-only
backend migration.

**Why:** The initial report described Vercel sync, but the failed step was an
upstream API deployment. Removing that dependency would not repair API/frontend
compatibility.

**How to apply:** Compare the deployed API source with GitHub main before
retrying old failed runs. A newer bounded API release may contain isolation
protections missing from main. Reconcile those protections without discarding
either history, and use read-only checks against the current database before
assuming that an old schema-readiness failure still requires a migration.

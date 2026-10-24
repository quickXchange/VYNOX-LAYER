# Automatic release after a successful candidate

After this change is reviewed and merged into `main`, each normal push to `main`
runs the existing checks and candidate deployment, then calls the existing
official-domain Production workflow. The Production job cannot run after a
failed, skipped or cancelled candidate/check job.

The reusable workflow inherits the original push SHA, explicitly checks out that
SHA, and passes it unchanged to the existing Render/Vercel release checks.
A read-only GitHub check rejects a release already superseded by a newer main
commit before deployment begins. A later push during an active deployment does
not interrupt it; the candidate workflow's existing concurrency queue schedules
the next run. GitHub may replace an older pending run with a newer one.

The original manual approval checkbox remains available as a recovery path.
Manually re-running the candidate via its Run workflow button does not
automatically release Production. Force pushes also require manual release.

Existing environment protections remain unchanged. If `vynox-candidate` or
`vynox-public-preparation` requires a human approval, GitHub will still pause for
that approval. This change does not remove reviewers, bypass branch protection,
alter secrets, migrate databases, enable financial execution, or change DNS.
The existing official-domain and protected-acceptance verification remains in
place.

## One-time enablement

Review and merge the automation pull request. Its merge is itself a main push
and can run the new automatic release chain. Only merge when that release is
intended. Subsequent approved main merges no longer require manually starting
the official Production workflow.

## Local validation

`node --test scripts/external-hosting/public-release-source.test.mjs`

These tests use synthetic events and mocked read-only responses. No deployment
is performed. Actual GitHub execution remains unverified until an approved merge.

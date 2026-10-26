# Subscription trials: prepared Production migration

Status: prepared only. This document does not authorize database application,
merging, publishing, or changes to Owner access, protected Acceptance or financial holds.

## Scope

`deploy/production-candidate/0014_subscription_trials.sql` appends one nullable
JSONB column, `public.tenant_subscriptions.trial`, to the existing checksummed
Production manifest. Earlier migration entries and their checksums are unchanged.
The existing external runner owns the advisory lock, transaction, timeouts and
ledger write. No new runner, deployment/startup hook or automatic DDL is added.

Existing subscriptions retain NULL trial state. No agreement, frozen amount,
invoice, account, permission, RLS policy, reference configuration or trial state
is backfilled or rewritten. An incompatible pre-existing column fails explicitly.

## Local verification

Run `node --test scripts/external-postgres/subscription-trials-release.test.mjs`.
The test starts a disposable PostgreSQL cluster on a private Unix socket, with
no TCP listener or inherited database credentials. It exercises the real
external migration runner against synthetic data, including failure rollback,
ledger idempotency, historical agreement preservation and unchanged RLS/grants.
It is not evidence that a hosted database has been inspected or migrated.

## Required before a separately authorized application

1. Confirm the exact approved external Supabase target and shared
   Production/Acceptance impact. Preserve all original Owner identities and MFA.
2. Read back the live migration ledger against the manifest prefix through
   `0013_plan_management_safety.sql`. Stop on any unexpected history or schema
   drift; do not replay old seed/configuration migrations.
3. Confirm the pending set is exactly `0014_subscription_trials.sql`. Obtain
   a verified encrypted backup and record the existing subscription data and
   security baseline without exposing customer records in logs.
4. Rehearse the SQL and ledger insertion in a rolled-back transaction, checking
   nullable JSONB/no default and preservation of prior fields, policies and
   permissions. Apply only under separate explicit authorization through the
   established external migration procedure, never the app build or startup.
5. Read back the committed checksum and column shape and compare original
   agreement fields and security baseline. A failed readback after commit is
   not a rollback. Do not drop the column after trials have been written.
6. Verify authorized customer trial/preview journeys and only then consider
   merging the draft PR. A merge to main starts candidate and Production release
   automation; this preparation has not triggered either.

The Development migration runner is not a Production deployment command.
The legacy plan-only application script is likewise not a trial migration tool.
Hosted application/readback and signed-in browser verification remain release
gates after this preparation.

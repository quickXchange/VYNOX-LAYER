# Tenant Release sync: final report

## Diagnosis

The pre-edit diagnosis is in `release-sync-diagnosis.md`, committed separately.
The fresh Development reproduction showed that Save immediately changed public
branding even though no tenant Release handler or snapshot table existed.

- **A — No:** the website was already a runtime SPA, not tenant build-time config.
- **B — No:** it used the server API, not an anonymous database client. Existing
  tenant RLS was retained; new anonymous/unscoped snapshot reads are denied.
- **C — Yes, primary:** draft/live were the same mutable tables and independent
  branding/Exchange reads could observe different configurations. No complete,
  atomic tenant Release existed.
- **D — No demonstrated original cache cause:** runtime responses changed on Save.
  The new endpoint revalidates by checksum and the SPA refreshes the complete
  snapshot every 15 seconds, including background tabs, and on focus/reconnect.
- **E — Historical asset problem:** the old branding URL resolved the current
  attachment rather than preserving historical bytes. Published logos now use
  tenant-owned immutable content hashes.
- **F — No demonstrated resolution fault:** tenant lookup remained explicit and
  bounded; unknown sites do not inherit another tenant or the master.
- **G — No demonstrated deployed-field skew:** existing master deployment pins the
  API/frontends to one source commit. A shared versioned runtime contract now
  additionally validates every snapshot and maps supported old versions.
- **H — Existing adapter credential storage was tenant-scoped and encrypted.**
  It is reused, not replaced with copied secrets or new environment variables.
  Unsupported payment-gateway execution remains blocked, never simulated as ready.

## Implementation

- Existing configuration remains Draft. Added `tenant_releases`,
  `tenant_release_assets` and the tenant-owned `tenants.live_release_id` pointer.
- Release validates and builds the entire public projection inside one
  repeatable-read transaction with a tenant row lock. An immutable snapshot,
  audit record and live pointer commit together. Rollback changes the pointer.
- Database trigger prevents independent update/delete of existing snapshots.
  Composite foreign key prevents cross-tenant live pointers. Both new tables use
  scoped policies, FORCE RLS and restricted grants.
- `GET /api/public/site-config?slug=...` or `?host=...` returns the released
  projection only, with checksum ETag, conditional 304 and `no-cache`. Public
  branding compatibility URLs resolve released assets, never current draft bytes.
- Authenticated short-lived preview is actor/tenant bound and rechecks the
  existing native session, membership and MFA. Token possession alone is not login.
- Added Customer Admin Release/history/checklist/diff/rollback controls and a
  private logo upload. Preview displays “Preview, not live.”
- Website and widget consume one snapshot response. Unknown/corrupt/unsupported
  configurations fail explicitly; no default-brand fallback is used.
- Private draft uploads are type/size checked; SVG is sanitized and retains its
  required SVG namespace. Release copies authenticated bytes to
  `public-assets/<tenant>/<sha256>.<ext>` and retains old asset versions.
- Existing provider vault/adapters are reused. Credential-required enabled
  connections must have verified health and pass a new read-only Release test.
  No credentials enter snapshots. Rotation remains independent of Release.
- Retained the current hosts. Added the versioned additive master migration and
  a narrow schema/security readback supplement without rewriting the old baseline.
  No automatic snapshot bootstrapping or tenant configuration exports were added.

## Verification

Passed locally:

1. Fresh A: logo, primary color, route and add-on sync in an anonymous browser
   without deploy or reload, within 60 seconds.
2. Saving Draft leaves Live unchanged; authorized draft projection contains edits.
   Signed-token actor/tenant/tamper tests pass.
3. Rollback restores old config and actual old logo bytes, including an already-open
   background page.
4. Fresh B retains distinct branding, assets and routes; cross-tenant read/write,
   rollback and live-pointer attempts are rejected.
5. Unknown slug returns API 404 and a site-not-found page. Deliberately invalid
   snapshot returns 503 and a tenant/release-scoped error log, not master defaults.
6. Synthetic credential sentinel absent from public JSON, rendered HTML, compiled
   SPA JS and acceptance logs. No real credential was printed or copied.
7. Missing logo and untested credentials refuse Release without pointer changes.
   Invalid image bytes/SVG active content are rejected or removed.
8. A checksummed v0 snapshot reads through the v1 mapper; future versions fail.

Additional checks: all workspace TypeScript; existing `release:test` and
`external:test` suites; compiled tenant SPA; transactional-abort proof; database
immutability; anonymous RLS; ETag/304. A fresh disposable PostgreSQL 16 migration
rehearsal verified **46 tables, 92 policies, FORCE RLS and least-privilege grants**.
The same CI entrypoint passed its database and compiled-SPA Playwright tests.
It is wired into the existing GitHub checks workflow with screenshot artifacts.
No remote push, hosted CI run or deployment was initiated.

Development browser evidence:
- Before: `generated-artifacts/release-sync/development-before.jpg`
- After: `generated-artifacts/release-sync/development-after.jpg`
- Continuous-page browser captures: baseline `7660vt`, updated `irbc3g`,
  isolated B `5jvd9x`, background rollback `ds4u6v`.

The first browser observation compared a new `brandName` to unchanged, separately
authored website/hero texts. The fixture now edits those fields explicitly rather
than incorrectly making production overwrite intentional customer copy. Background
polling was also explicitly enabled. The final browser flow passed.

## Boundaries and owner decisions

No production data, DNS, hosting cutover, original Owner credentials/MFA, customer
authentication identities, pricing/quote/order calculations or order snapshots
were changed. All Development tenants and storage objects created for this QA
are removed after evidence capture. The disposable CI database is stopped.

- `TODO(owner)`: review/merge the four commits and run the hosted checks; then
  authorize the protected master-code/schema release. This work did not deploy it.
- `TODO(owner)`: deliberately review existing tenant drafts before their first
  Release. Unreleased existing data is not silently made Live.
- `TODO(owner)`: exercise the signed-in Customer Admin controls using an existing
  authorized account. No suitable native signed-in browser session was available;
  positive authenticated browser navigation was not claimed. Service authorization,
  signed-token rules and anonymous preview rejection were tested.
- `TODO(owner)`: approve an actual supported payment-gateway contract before
  enabling that capability. Missing/unsupported connectivity remains a blocker;
  no financial activation was performed.

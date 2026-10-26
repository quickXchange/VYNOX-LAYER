# Subscription Plans Management

Extends the existing `plans` / `plan_entitlements` / `tenant_subscriptions` catalog and the
existing `pricing_publication`. No parallel subscription system.

## Migration
- File: `lib/db/migrations/plan-management-profiles.sql` (additive, idempotent).
- Runner: `NODE_ENV=development QXLAYER_EXTERNAL_ENVIRONMENT=development CONFIRM_PLAN_MANAGEMENT_MIGRATION=yes pnpm --filter @workspace/scripts exec tsx src/apply-plan-management-migration.mjs`
  (Development only; refuses other targets.)
- Steps: adds `plans.profile` (structured config), `plans.revision` (optimistic concurrency),
  `plans.updated_by`; unique active slug index; append-only `pricing_publication_versions`
  (UPDATE/DELETE blocked by trigger); `tenant_subscriptions.contract_snapshot` and freezes every
  existing subscription BEFORE archiving prior plans; one-time seed (ledger key
  `vynox-three-tier-2025`) of Starter / Standard / Premium as contact-sales (no prices invented),
  archiving all prior plans (never deleted, references retained). Rerunning never recreates or
  overwrites.
- After migrating, a Super Admin must review and publish from /plans. Nothing is published by the migration.

## Behaviour
- Draft: edits save to the catalog row (draft) and do not reach customers until publication.
- Publish: existing pricing publication; each publish appends an immutable version.
- Rollback: re-publishes a prior immutable version payload (recorded as a new version).
- Contracts: the resolver reads `contract_snapshot` entitlements when present, so catalog edits
  never change existing customers. Moving customers requires preview + explicit confirm.
- `profile.internalNotes` is stripped from publication and public/customer output.

## Unavailable (shown as unavailable, not functioning toggles)
Best-rate routing, fiat Buy/Sell (Transak, MoonPay, Ramp), monitor exports (BestChange, Kursoff,
Obmify), affiliates, languages, analytics, AML/KYC rules, multi-admin roles, merchant gateway.
ChangeNOW / SwapSpace / FixedFloat are stored only as requested provider names.

## Revision safety and published-only migration

- Migration is now two files run ONLY via `scripts/src/apply-plan-management-migration.mjs` (tsx):
  1. `lib/db/migrations/plan-management-profiles.sql` — schema, versions tables (Acceptance copy: RLS forced, revoked from PUBLIC/anon/authenticated/service_role/qxlayer_public_app, policies pinned to `session_user='qxlayer_app'`), contract freeze incl. public profile and billing periods.
  2. runner calls `freezePricingBeforeEdit` so the public pricing baseline exists BEFORE any archive.
  3. `lib/db/migrations/plan-management-seed.sql` — refuses to run without a publication or with unfrozen contracts, records the baseline as a version (rollback target), archives old plans, inserts Starter/Standard/Premium (contact sales, no prices, explicit inherited feature lists). Ledger key `vynox-three-tier-2025`. New plans are NOT published automatically.
- Every plan write (PUT, status, delete, reorder, billing periods) requires the expected revision: 428 when missing, 409 on mismatch.
- Billing modes: paid / free (0 prices) / custom (text) / contact_sales (no prices). Fixed discount and monthly promo price + window are paid-only and validated against prices and enabled billing periods. Trials are explicitly unavailable pending a billing scheduler.
- Migration preview/confirm: blocked in Acceptance; target is the PUBLISHED plan; confirm requires the preview token (sha256 of published revision, target snapshot and subscriber contracts).

## Enforcement and verification
- Effective policy (`effective-policy.ts`) reads the structured format (`state`, `dependsOn`); empty-profile (legacy) contracts are untouched. Unimplemented capabilities (incl. pair_markup, multi_admin_roles, languages) fail closed; buy/sell stay denied.
- Live gates: convert provider assignments enforce `max_convert_providers`; brand save enforces contract theme modes (`system` needs both) and a single site language for profile contracts; admin seats map to `max_staff` (seats minus owner).
- DB verification: `QXLAYER_EXTERNAL_ENVIRONMENT=development pnpm --filter @workspace/api-server exec tsx src/verification/plan-management-db.ts` (single outer transaction, always rolled back) and `src/verification/plan-management-fingerprint.ts` (read-only before/after fingerprint).

## Pricing rules
- Pricing: `effectiveRecurring` (`entitlements/commercial-pricing.ts`) is the single rule for quotes, invoices (`commerce/pricing.ts`), subscription estimates, landing "starting at" and (mirrored) console cards/estimates: active monthly promotion [start, end) replaces the monthly price; else fixed discount subtracted (floor 0); else percentage. Orders store `pricedAt` at submission; invoices evaluate promotions at that instant. Trials remain explicitly unavailable (no billing scheduler).
- `publicProfile` forces `availability: unavailable` for `UNSUPPORTED_CAPABILITIES` (same list as enforcement).
- `plan-management-capability-fix.sql`: corrects seeded pair-markup availability only on unedited seed rows (revision 0).
- Development publication: `CONFIRM_PUBLISH_DEFAULT_TIERS=yes QXLAYER_EXTERNAL_ENVIRONMENT=development tsx src/verification/publish-default-tiers.ts` (idempotent; refuses non-heliumdb, production, acceptance).

## Production release boundary
Development schema and publication have been updated, not Production. These code changes require the additive schema before a Production deployment; do not merge into the automatic release chain until a separately approved, backed-up external-database migration is prepared and verified. The Development runner deliberately refuses Production. Existing external migration manifests have not been updated by this work.

## API changes
Existing `/api/plans` CRUD/status/duplicate APIs now accept structured profiles and require revision checks for edits. Existing pricing-publication APIs preserve immutable history.
Additional `/api/plan-management` endpoints provide `/preview`, `/versions`, `/versions/:id`, `/versions/:id/rollback`, `/order`, `/plans/:id/history`, `/plans/:id/migration-preview`, and `/plans/:id/migrate`. They reuse Super Admin authorization, same-origin mutation protection, strict request validation and the existing catalog audit.

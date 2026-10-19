---
name: Commercial pricing safety
description: Separate unpriced commercial plans from technical Production recovery; never substitute demo or invented free pricing.
---

## Public plan publication and descriptive fields

The user subsequently authorized showing the previously approved plans on
official Live and named them Starter, Standard (formerly Business), and Premium
(formerly Professional). Prices and limits below stay the same. This supersedes
the earlier Acceptance-only publication restriction for these three plans.

The user explicitly chose customer-visible label/value feature rows, not new
enforced entitlements. Allow repeatable descriptive rows without a small fixed
count cap; ordinary text-length and request-size limits still apply.

**Why:** The user reported “No plans available” in Live Exchange configuration
and requested these plans plus Super Admin-editable descriptive fields.

**How to apply:** Keep the catalogs isolated after this deliberate publication.
Do not continually copy Acceptance edits into Live. Preserve existing subscribers
and historical quotations. Publishing plans does not authorize payments,
payment-method activation, customer delivery or real financial execution.

## Historical plan snapshot compatibility

New required plan-response fields need read compatibility in every historical
snapshot consumer, not only the current catalog and pricing publication.
Never backfill an old order's agreed pricing or approvals from today's plan.

**Why:** Adding descriptive rows made old requested/approved plan snapshots
fail response validation and reject the entire Super Admin order queue.

**How to apply:** Preserve immutable saved snapshots; supply only semantically
empty defaults for newly introduced descriptive fields when reading them.
Check historical order list and detail responses against their actual schemas.

## Earlier approved Acceptance plan definition

The user approved the following White Label plan prices and limits for
**Acceptance only**, not the official public catalog:

| Tier | EUR monthly / yearly / setup | Assets / networks / payment methods / staff | Monthly simulated orders / EUR volume |
|---|---|---|---|
| Starter | 39 / 390 / 149 | 3 / 2 / 2 / 1 | 100 / 10,000 |
| Business | 99 / 990 / 399 | 10 / 10 / 5 / 5 | 1,000 / 1,000,000 |
| Professional | 249 / 2,490 / 999 | 25 / 25 / 15 / 15 | 10,000 / 10,000,000 |

Only Website, Exchange, Swap and Convert are included. Buy/Sell and other
features remain off; API-key and webhook limits are zero. No payment-method
activation or real financial execution was approved.

**Why:** The user explicitly approved these prices, then these exact tier limits,
and selected Acceptance rather than Development or official Live.

**How to apply:** This supersedes the earlier unapproved-price status for these
three plans only. Do not publish them into a shared official catalog under an
Acceptance-only approval. Add-ons remain unapproved.

## Acceptance is not a separate catalog database

Provider configuration readback confirmed that the separate Acceptance and
official public API services connect to the same database. The default catalog
and publication are public-service data, not Acceptance-only data. Acceptance
runtime flags and a private hostname do not isolate data.

**Why:** An Acceptance-only pricing request exposed this distinction after an
additive schema migration. A candidate connection alone cannot prove that a
catalog or schema write will not affect the public service.

**How to apply:** Before any environment-scoped write, compare effective service
configuration (including overrides) and database targets for both services.
Require catalog isolation or explicit public scope before shared pricing writes.
An Acceptance API restart does not authorize restarting the separate public API.

The user explicitly authorized additional Acceptance-only catalog isolation,
including schema/application work and an Acceptance code release. Catalog
selection and editing do not authorize checkout, payment activation, provisioning,
or changes to existing customer subscriptions.

**Why:** The user chose isolation specifically to publish the approved plans
without changing official public pricing.

**How to apply:** Keep Acceptance catalog/audit writes separate from shared
operational data. Historical subscriptions must resolve their original public
catalog even when viewed through Acceptance; retaining identical plan IDs in a
private copy does not make them interchangeable. Never fall back from a missing
private catalog/publication to public data. Public API logins must be denied
private rows even after assuming the common runtime role.

Apply the same target-isolation rule to rollback rehearsals as to committed
global writes, and stop when provider readback is incomplete or conflicting.

**Why:** A rehearsal still takes locks and executes DDL/DML against the actual
shared database; rollback is not proof that the public service was unaffected.

**How to apply:** Resolve service overrides before inherited group values and
compare database identity across direct and pooled endpoints, not credentials
or API hostnames. Public scope needs separate explicit approval.

## Historical provisional baseline

Phase 1 permitted suggested EUR default plans and add-ons as **unapproved proposals
only**. Proposed amounts are not user-approved real prices. Do not enable purchases
until the Owner explicitly approves actual prices and a configured payment method.

**Why:** The user requested default EUR commercial offers while expressly requiring
provisional prices and unconfigured payment methods to remain unavailable for real purchases.

**How to apply:** Distinguish provisional defaults from approved commercial settings.
Keep the older unpriced-recovery rules below for technical recovery; they do not
forbid clearly identified, non-purchasable Phase 1 proposals.

Undecided commercial pricing must not block unrelated technical Production recovery. Prepare the real Exchange feature/limit configuration separately. Never substitute a Development/demo plan or interpret an undecided price as zero.

**Why:** The user explicitly requires a real White Label Exchange commercial offering without invented prices, and does not want an undecided business price to block the technical recovery.

**How to apply:** Use Contact / Requires Review only where the architecture genuinely supports unpriced plans. A billing label alone is not an unpriced billing mode. If numeric prices are mandatory, leave creation pending the business decision while progressing independently authorized technical work.

The user chose: “Finish controls; leave commercial prices unconfigured.” Super Admin controls must include deletion, but sandbox/sample amounts must not become commercial prices.

**Why:** The user wants to set the business prices themselves, not have demo amounts or blank prices interpreted as real or free offers.

**How to apply:** Provide complete pricing, discount, feature, limit and lifecycle controls without inventing rates. Preserve existing records and historical quotations. An explicitly configured zero is different from an unconfigured price; keep that distinction in customer estimates and future billing integrations.

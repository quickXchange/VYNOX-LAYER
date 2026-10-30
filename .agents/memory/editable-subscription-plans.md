---
name: Editable subscription plans
description: Business requirements and historical-contract boundaries for the new editable VynoX tiers.
---
The user replaced the old commercial offering with Starter (“Launch your exchanger”), Standard (“Grow your volume”), and Premium (“Run it like a business”). These are editable defaults, not hardcoded permanent tiers. No price amounts were supplied; unconfigured prices must not imply free service.

**Why:** The user explicitly requested a complete Super Admin plan-management system, not renamed frontend cards.

**How to apply:** Reuse existing plans and entitlements. Archive old offers but preserve invoices, subscription identities and historical contracts. Never silently move customers, change agreed prices, or charge for a migration. Drafts require explicit publication; customer migrations require reviewed published targets and concurrency-safe confirmation.

Requested integration names and commercial features are not evidence of implementation. Plans cannot activate providers, routing, financial execution, AML/KYC or merchant services merely by editing a checkbox.

**Why:** The user explicitly forbids false operational claims and requires backend enforcement.

**How to apply:** Independently check entitlement, implementation, eligible provider configuration and existing financial holds. Preserve Acceptance isolation and use a separately approved Production migration; Development catalog publication is not a Production release.

Legacy-plan removal means permanently delete only truly unused plans and archive plans with retained references.

**Why:** The user explicitly chose deletion of unused old plans while preserving those with history.

**How to apply:** Check subscriptions, orders, invoices, JSON snapshots, publication history and protected Acceptance references before deletion. Preserve Starter, Standard and Premium and existing agreements; do not equate an inactive plan with an unused one.

Super Admin must be able to select USD as well as EUR for subscription plans.

**Why:** The user explicitly requested USD support and administrator-controlled currency rather than EUR-only new plans.

**How to apply:** Treat currency as a plan draft setting requiring publication, not an exchange-rate conversion or permission to reprice existing customer agreements.

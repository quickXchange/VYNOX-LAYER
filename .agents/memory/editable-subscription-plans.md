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

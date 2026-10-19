---
name: Acceptance request sandbox
description: Identity and operational boundaries for the one approved Acceptance customer-request sandbox.
---

The user approved one designated requester for Acceptance Preparation-mode logo/attachment uploads and customer request submissions. Identify that requester from the normalized email confirmed by the active Supabase provider session, compared by SHA-256 fingerprint; never store or log the raw email. This sandbox exception applies only to the exact upload and submit endpoints while Acceptance isolation is active, and must remain disabled in public-preparation mode.

The user subsequently explicitly approved real customer request submissions on vynoxlayer.com, including the uploads needed for intake, while payments and delivery remain blocked. Live intake is ordinary authenticated customer intake, not an extension of the Acceptance sandbox allowlist. Preserve native authentication/MFA, CSRF, ownership and idempotency checks; do not enable review mutations, checkout, provisioning or delivery as a side effect.

**Why:** The user confirmed “Enable real request submissions; keep payments and delivery blocked” after the final configuration submission was blocked.

**How to apply:** Permit only the two public customer intake endpoints through the preparation barrier. Keep Acceptance identity restrictions and sandbox-only records separate from Live customer records and notifications.

Requests from this path may persist in the Production-backed Acceptance database, but must be marked as sandbox-only and excluded from operator review, notes, payments, notifications/email, provisioning and delivery. Do not broaden the exception to other identities, write endpoints, Production traffic, or customer records.

**Why:** The user explicitly chose a provider-verified email fingerprint rather than an account ID and separately approved persistent records only for one sandbox requester.

**How to apply:** Keep the fingerprint in Acceptance runtime configuration, fail closed when it is absent or malformed, and verify end-to-end behavior only after the Acceptance schema/runtime blockers are resolved. No database migration or deployment is included in that approval.

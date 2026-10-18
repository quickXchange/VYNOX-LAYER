---
name: Acceptance request sandbox
description: Identity and operational boundaries for the one approved Acceptance customer-request sandbox.
---

The user approved one designated requester for Preparation-mode logo/attachment uploads and customer request submissions. Identify that requester from the normalized email confirmed by the active Supabase provider session, compared by SHA-256 fingerprint; never store or log the raw email. The exception applies only to the exact upload and submit endpoints while Acceptance isolation is active, and must remain disabled in public-preparation mode.

Requests from this path may persist in the Production-backed Acceptance database, but must be marked as sandbox-only and excluded from operator review, notes, payments, notifications/email, provisioning and delivery. Do not broaden the exception to other identities, write endpoints, Production traffic, or customer records.

**Why:** The user explicitly chose a provider-verified email fingerprint rather than an account ID and separately approved persistent records only for one sandbox requester.

**How to apply:** Keep the fingerprint in Acceptance runtime configuration, fail closed when it is absent or malformed, and verify end-to-end behavior only after the Acceptance schema/runtime blockers are resolved. No database migration or deployment is included in that approval.

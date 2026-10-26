---
name: Subscription trial safety
description: Trial agreement and financial-hold boundaries.
---
Trials are opt-in for new subscriptions, never a retrofit to an existing customer agreement. Use a published offer, freeze the effective recurring amount at start (including any promotion active then), and preserve the original agreement through cancellation and expiry.

**Why:** The requested trial support explicitly protects existing customer billing agreements. Recalculating a promotion against today's date can silently change an agreed amount even when the underlying catalog snapshot is immutable.

**How to apply:** No automatic renewal or charge is authorized. Renewal requests are review requests only and must not extend access. Keep financial, delivery and Acceptance isolation holds independent of trial entitlement. Enforce the deadline on reads/admission even if background auditing is unavailable. Any future paid-conversion flow needs explicit agreement and approval rather than clearing trial state through a generic restore or migration.

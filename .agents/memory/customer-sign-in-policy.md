---
name: Customer sign-in policy
description: Both password and email-code sign-in are authorized for White Label customers.
---

White Label customers must be able to use either their existing password or an email sign-in code, without a Gmail-only or Super Admin eligibility restriction.

**Why:** After a customer received no code because of the administrator-only restriction, the user explicitly said “Both should work.”

**How to apply:** Keep sign-in separate from account creation and role assignment. Preserve existing account identities, password access, provider-verified email ownership, browser binding and rate limits. Require the existing authenticator for accounts with MFA; do not force customers without enrolled MFA into an impossible authenticator step. Workspace verification is not evidence of Live delivery.

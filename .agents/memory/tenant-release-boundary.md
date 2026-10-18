---
name: Tenant release boundary
description: User-authorized configuration releases, immutable master presentation, and test boundaries.
---

Tenant Release is a data operation against one approved master, not a customer
deployment or frontend/backend fork. Existing drafts must receive deliberate
review before their first Release; never silently publish them during migration.

**Why:** The user's uploaded release-sync brief requires complete Draft→Release→Live
isolation while explicitly preserving pricing/quote/order logic, original Owner
credentials/MFA, tenant isolation, and the no-DNS/no-financial-activation boundary.

**How to apply:** Distinguish released public presentation from operational
authority and encrypted credential custody. Retain intentionally authored website
names/text independently of the business brand name. For schema-only CI databases,
seed public reference catalogs explicitly in the disposable harness, never at
application startup and never by copying a customer tenant.

---
name: Retained provisioning-review fixture
description: Retention and scope rules for intentional fictional customer review fixtures.
---

Keep the fictional Asterlane Development provisioning-review customer, order,
its isolated temporary test plan, branding uploads, and any tenant the user subsequently provisions until the
user explicitly asks for removal. Do not automatically advance its lifecycle
or clean it up as a disposable browser-test fixture.

**Why:** The user explicitly requested a retained Development-only order so
they can personally review, approve, provision, configure, preview and deliver
it, and inspect same-account customer access afterwards.

**How to apply:** Treat Asterlane as an intentional manual-inspection fixture,
not legitimate Production customer data. Never publish or transfer it to
Production, alter real customers, or create a frontend copy. Preserve the
existing shared Master Exchange and leave lifecycle decisions to the user.
Do not modify existing shared or real plans to satisfy this fixture's requested
actions; its test entitlements must remain isolated in its own Development plan.

## Retained external customer demo

Keep the fictional Solara Exchange customer, its dedicated plan, order, tenant,
branding upload and Sandbox orders accessible on the existing protected external
Preview until the user explicitly requests removal. A custom domain is not
required. This is a separate fixture from Asterlane; do not transfer Asterlane.
Keep financial execution in Sandbox and deliver separate customer credentials
privately to the already verified Owner, never in chat or an ordinary asset file.

**Why:** The user requested a complete retained White Label customer demo for
manual review, explicitly without a custom domain and with separate securely
delivered demo credentials.

**How to apply:** Remove only disposable operator/outsider test access after
verification. Preserve the demo customer and all its review data. Use the
existing Owner account for Super Admin review without changing its password,
MFA or permissions. Do not publish synthetic plans globally merely to enable
customer design selection; use the approved private-quotation lifecycle.

## Official-domain Owner viewing

The user approved Owner-only access to the retained demo's private Customer
Admin on vynoxlayer.com. Keep its public website, public demo access and other
accounts blocked there. This approval is for viewing the admin; it does not
remove the existing business-write or financial-execution holds.

**Why:** The public Production fixture exclusion also blocked the original
Owner's private admin requests, making the existing Open Customer Admin link
fail. The user explicitly chose Owner-only official-domain access rather than
protected-preview-only access.

**How to apply:** Require the original canonical Owner identity, an active
Super Admin role and the normal session/MFA checks. Never substitute generic
Super Admin access, weaken MFA, expose the public fixture, or modify the
separate protected preview to satisfy this permission.

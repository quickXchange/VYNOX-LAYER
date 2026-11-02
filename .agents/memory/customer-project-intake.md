---
name: Customer project intake
description: Simplified Project step for customer Configure Exchange requests.
---

The customer Configure Exchange Project step must ask only for Brand name and Preferred domain, both required. Do not reintroduce separate Project name, Company name, or Website name inputs.

**Why:** The user explicitly requested removing those three redundant fields and making both remaining fields mandatory.

**How to apply:** New wizard submissions may derive the internal project name from the brand for compatibility. Do not delete or rewrite existing historical project, company, or independently authored website names. Required preferred-domain intake does not authorize DNS changes, domain ownership claims, or website activation.

Preserve unsent intake drafts per signed-in identity within the browser session, including attachment references and the original submission retry key. Do not describe this as a database-saved request or cross-device persistence.

**Why:** Independent browser verification found that refresh and history navigation discarded the intake; the user requested correction of the observed failures and persistence gaps.

**How to apply:** Keep draft data isolated between identities, expire stale drafts, clear after successful submission, and validate restored data before rendering.

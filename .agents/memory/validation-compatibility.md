---
name: Validation namespace compatibility
description: Type inference and runtime error handling must use the same Zod namespace as the schema.
---

Match inferred types and caught validation errors to the namespace that created each schema. Do not assume root Zod and versioned entry points match across major upgrades.

**Why:** The generated OpenAPI validators and Drizzle validation can coexist using different namespaces. Inferring a generated validator with the other namespace yielded unknown input types; catching the other namespace's ZodError would also miss actual request-validation errors.

**How to apply:** Inspect the generated validator's import before choosing inference/error imports. Root and `/v4` share a namespace on Zod 4, unlike the former Zod 3 setup. Never reintroduce `/v3` as a compatibility shortcut: the constrained-collection security fix is in v4.

Preserve accepted UUID/GUID, integer and omitted-unknown semantics explicitly when changing validator generation.

**Why:** A supported major security upgrade can otherwise silently tighten public contracts even when all types compile. Upstream issue wording may change, but existing accepted values and the application's error envelope should not.

**How to apply:** Keep compatibility adjustments in the repeatable generation pipeline, not manual generated-file edits, and test accepted/rejected values alongside exploit-focused cases.
---
name: Reference seed idempotency across schema releases
description: Additive schema versions must not replay previously applied reference data over operator edits.
---

A reviewed schema-only release carrying exactly the same already-applied
reference-data digest must preserve subsequent operator edits and deletions.
Keep the original data immutable; record the new reviewed schema version
without reapplying that seed data.

**Why:** Recapturing Development reference data after an additive catalog
migration encountered legitimate existing operator configuration conflicts.
The protected candidate correctly blocked overwriting them.

**How to apply:** Check strict schema parity first, then match the exact
reference-data digest against an earlier applied version. Unknown or changed
digests still need full conflict review; never skip checks for novel data.

Independently applied catalog DDL must also be recorded in the standard
migration ledger. A healthy schema alone does not establish migration-history
readiness.

**Why:** The approved direct catalog importer left the schema correct but did
not record its migration checksum, making the canonical manifest appear pending.

**How to apply:** Reconcile an already-applied entry only after matching the
immutable execution receipt and SQL checksum, verifying exact reviewed schema,
and proving public records unchanged. Never mark unknown DDL applied or replay
seed data to repair bookkeeping.

A Production migration ledger can contain both ordered schema versions and
independent, approved data-release receipts.

**Why:** Comparing every receipt as an ordered schema migration incorrectly
rejected a structurally verified existing Production target.

**How to apply:** Separate only explicitly recognized, exact-checksum historical
data receipts before schema-prefix validation. Keep them in the live ledger,
never replay them, and reject changed receipts or unknown schema entries.

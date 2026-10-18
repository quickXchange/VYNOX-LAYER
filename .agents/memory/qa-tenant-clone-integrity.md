---
name: QA tenant clone integrity
description: A configuration-only clone can read correctly yet fail safe write and pricing verification.
---
Clone a QA tenant's relational assignments and remap all globally owned method
and pricing identifiers, not just its settings JSON. Keep the original tenant's
identities and records unchanged.

**Why:** A partial clone passed authentication and displayed pricing, but missing
asset/network assignments caused the save review to propose clearing the
catalog. After repairing assignments, ownership validation correctly rejected
reused payment-method identifiers. Healthy reads therefore did not establish
that a fixture was valid for write tests.

**How to apply:** Before testing a bounded settings save, check that catalog
counts survive the review and that every materialized identifier belongs to the
new tenant. Scope cleanup to that exact tenant and its newly created identities,
including relational rows materialized by the save. Fix an invalid fixture
rather than weakening ownership validation or approving unrelated deletions.

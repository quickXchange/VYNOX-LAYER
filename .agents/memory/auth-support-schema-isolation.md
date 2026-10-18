---
name: Auth support schema isolation
description: Keep private authentication support schemas separate from public tenant-RLS inventory and grants.
---

Private authentication support tables must not inherit the public business
table inventory's RLS expectations or tenant-runtime access.

**Why:** Adding declarations for the existing private Auth schema exposed a
namespace-loss assumption: a names-only inventory looked for private tables in
public and blocked authenticated account reads. The native browser test caught it.

**How to apply:** Preserve namespaces when deriving security inventories, or
explicitly constrain an inventory to its intended schema. Keep all public
business tables covered. Never fix such a mismatch by disabling readiness/RLS,
weakening policy checks or widening tenant-role grants to Auth session storage.

Validate private Auth DDL against a fresh empty PostgreSQL instance, not only an
already-initialized Development database.

**Why:** Qualified private table declarations can be generated successfully
while the namespace creation is omitted. An existing namespace hides this
first-install failure; metadata and TypeScript checks alone do not catch it.

**How to apply:** Export namespace declarations alongside their tables and
require a clean first-apply rehearsal with private-table access-denial checks
before accepting generated schema as release-ready.

Pre-authentication administrator eligibility must use a narrowly scoped
server-only authority projection, not direct public-table grants to private
Auth or tenant runtime connections.

**Why:** An isolated Auth connection can be healthy while its email flow fails
before SMTP because it cannot read administrator bindings. Broadening table
access would undermine the separation that connection was created to enforce.

**How to apply:** Verify the real private Auth login can resolve existing active
administrator subjects and the tenant login cannot execute that projection.
Keep user role assignment, passwords, identity links and MFA factors unchanged.
SMTP management responses may redact passwords; do not test a redacted value or
misreport its authentication failure as invalid configured credentials.

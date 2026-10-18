---
name: Production readback evidence
description: Why schema-diff and SQL success envelopes are insufficient proof of Production state.
---

PostgreSQL `name[]` metadata can arrive from this project's Node PostgreSQL driver
as an array-literal string, not a JavaScript array.

**Why:** Policy-role checks incorrectly used `.length` and indexed the string
`{qxlayer_runtime}`, causing preflight failures before any DDL.

**How to apply:** Compare metadata arrays in SQL using typed arrays/cardinality,
or explicitly decode the database type; never infer the JavaScript representation.

Production SQL tooling already supplies a read-only transaction wrapper.
Explicit BEGIN/COMMIT and transaction-control or read-only-mode changes are
rejected rather than providing an additional safety boundary.

**Why:** An authorized read-only inventory's explicit wrapper was rejected;
the same bounded SELECT succeeded inside the managed wrapper, whose readback
reported transaction_read_only=on.

**How to apply:** Use a single SELECT for related snapshot evidence and validate
its expected result fields. Do not attempt to escape the Production wrapper or
infer that generic multi-statement examples authorize transaction control there.

Check the exact named CHECK definition and validation state independently of
the publishing schema diff. A reported empty diff does not prove CHECK parity.

**Why:** The managed read-only diff ignored changed expressions under the same
CHECK name while direct metadata showed different semantics. A name-only
Development probe made the native diff emit the required drop/add replacement.

**How to apply:** Compare exact metadata to the intended predicate before
claiming schema readiness; never add a startup/build migration to compensate.
An empty native publishing plan can persist even when same-named CHECK
expressions have different semantics. For approved semantic changes, use a
distinct descriptive CHECK name in the schema source, apply through the supported
Development flow, and verify that the native diff replaces the old rule without
data-bearing structural changes. Do not claim publishing readiness without that
readback. Managed schema repair must use the supported publishing flow, not a
standalone Production DDL script or credential workaround.

Restoring a stricter historical CHECK after a correction may be incompatible
with newly valid records. Guard reversals and refuse them when they would
require deleting records, clearing links or changing lifecycle statuses.

Policy names and RLS enablement do not prove predicate parity. Require actual
USING/WITH CHECK clauses and the restricted role's privileges in the native
publishing plan, and fail closed when runtime metadata is incomplete.

**Why:** Native diff inspection has emitted policy-creation statements without
their security conditions and omitted Development role grants. Missing conditions
can default to permissive access, even though the Development policies passed.

**How to apply:** Compare policy semantics and grants before publishing. Hold
the release if the supported plan loses them; do not add Production DDL or startup
repair, and do not label a passing Development isolation check as Live acceptance.

An explicit constant-true read policy is not a workaround for the native
generator's omitted predicates.

**Why:** Regeneration still omitted `USING` after source and Development metadata
both independently confirmed a literal true pricing read condition.

**How to apply:** Retain the native plan exactly as returned, report the blocker,
and never edit its SQL to fabricate a passing review.

Local Drizzle dependency alignment does not establish correctness of the managed
native publishing generator.

**Why:** Offline migration generation preserved all source predicates, while an
offline push-path reproduction lost them and the native service independently
returned incomplete policies. The callback does not expose its package versions.

**How to apply:** Distinguish workspace generate/migration and push paths from the
managed schema-diff service. Require a fresh complete native response; never
replace that evidence with locally generated SQL or claim a workspace patch fixes
the inaccessible service.

**Why:** Isolated lifecycle verification showed that legitimate pre-delivery
tenant links must survive; transaction rollback is safe before commit, but an
unconditional post-commit schema reversal can reject valid new state.

**How to apply:** Distinguish failure rollback from post-commit reversal.
Preserve valid records and use forward correction when the old predicate no
longer fits them.

Require the expected result header and parseable rows from SQL readbacks, not
only a successful tool envelope.

**Why:** A read-only query referencing a nonexistent table returned a successful
envelope containing only transaction wrapper output, without result rows.

**How to apply:** Treat missing result sets as unverified, correct the query, and
never interpret missing output as zero records.

Decode provider file-response envelopes before inspecting deployed content.

**Why:** Vercel's deployment-file API returned JSON containing base64 `data`.
Searching the response text directly falsely indicated that deployed
authentication functions were missing.

**How to apply:** Validate the response envelope, decode its file payload, and
only then compare bytes or inspect source markers. An HTTP 200 or JSON content
type does not establish that the response body is the original file.

Preservation snapshots must record the exact fingerprint algorithm and original
column set. Compare original columns across additive schema changes, and verify
the new columns' intended defaults separately.

**Why:** Changing JSON serialization or aggregation separators produced different
hashes for unchanged records. A new false-default pricing guard also changed the
full-row hash although every pre-existing column remained identical.

**How to apply:** Never weaken a preservation guard or rewrite business data to
force a match. Reproduce the original serialization, digest ordering and separator;
prove original-column equality and the expected additive defaults independently.

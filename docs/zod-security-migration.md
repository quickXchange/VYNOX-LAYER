# Zod security migration — 2026-10-30

## Finding and supported fix

The prior report at `generated-artifacts/security-audit/security-report.html`
identified GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404 in Zod 3.25.76.
The GitHub advisory lists `<4.6.6` as affected and 4.6.6 as the first fix.
Registry inspection found no newer stable Zod 3 release; the latest supported
stable release was 4.6.7. The workspace catalog and lockfile now use 4.6.7.
No Zod transitive override, vendored patch, scanner suppression, authentication
provider change, production data operation, or deployment was used.
`drizzle-zod@0.8.3` explicitly supports `^3.25.0 || ^4.0.0`.

Sources:
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd

The advisory description mentions unconstrained arrays, but the actual upstream
patch gates **constrained** arrays, maps and sets before element traversal.
Unconstrained collections still require input limits. A clean package scan is
not proof that arbitrary validation workloads have bounded memory usage.

## Entry points and remaining defenses

| Entry point | Runtime / controls |
| --- | --- |
| Generated request bodies, path/query parameters and responses | Orval-generated root `zod` now resolves to patched v4. Existing maxItems limits gain early rejection. Unbounded arrays such as moduleKeys retain HTTP body budgets; no invented business limit was added. |
| Hand-authored commerce, release, file metadata and Auth schemas | Root `zod` uses patched v4; strict Auth action union, password bounds, role rejection and transformation behavior retained. |
| Integration settings / Telegram | Explicit `zod/v4` now resolves to patched v4, preserving their existing namespace and bounded arrays. |
| Drizzle-generated schemas | Supported v4 peer; no database/schema migration. |
| Browser site snapshots | Shared generated validators and site-release validators use the same patched runtime. |
| JSON | Existing 128 KiB, no decompression, 20,000 visited-node and depth-64 limits before validators. |
| URL-encoded forms | Same byte/structural controls plus 1,000 parameters and depth 16. |
| Query/path input | Express query parsing followed by scalar/coerced generated schemas, or scalar upload metadata; no collection traversal in these query schemas. Repeated page parameters rejected in regression. HTTP URL/header limits are separate from body limits. |
| Binary uploads | Authenticated order attachments (8 MiB) and release assets (2 MiB) use route-local raw parsers. Zod parses scalar query/path metadata, not binary bytes. Body structural checks precede those raw parsers and are **not** claimed to bound file bytes. |
| Programmatic Map/Set inputs | No application Map/Set schemas found; direct patched-runtime regressions confirm size caps precede element validation. |

Source search found no application `zod/v3` imports. Do not switch to the bundled
legacy entry point merely to avoid a migration: it does not gain the v4 fix.

## Major-version compatibility scope

All catalog consumers move together, including generated contracts, the API,
shared database library, both sites, scripts and the mockup sandbox.
Orval explicitly generates v4 schemas. No OpenAPI routes, properties, enums,
business constraints, persisted data, permissions or authentication flows change.

`lib/api-spec/preserve-validator-contracts.mjs` runs on every standard codegen:

- Converts generated UUID checks to v4 GUID checks, preserving Zod 3's acceptance
  of hex IDs without RFC version/variant restrictions. Former root-v3
  hand-authored UUID checks also use GUID; existing explicit-v4 UUID checks stay
  strict.
- Preserves the former integral-number predicate, including coerced queries,
  rather than silently rejecting integral values outside the safe-integer range.
  Existing schema min/max limits still apply.
- Preserves omitted unknown-valued object properties.

Email syntax remains equivalent with upstream's optimized regex. Existing
defaults are plain array defaults, without optional-default or transformed-default
chains that would acquire changed semantics. Records already use explicit
key/value schemas. Object stripping, Auth strictness, nullable values and query
coercion are retained. Root and `/v4` now share ZodError; API errors still expose
only the existing `{error, details: [{path, message}]}` envelope. Upstream wording
and internal issue codes can differ; oversized containers intentionally emit one
size issue rather than many element issues.

## Verification

- `pnpm --filter @workspace/api-spec run codegen` — passed.
- `pnpm run typecheck` — passed across root libraries and all leaf packages.
- `pnpm --filter @workspace/api-server exec tsx --test src/middlewares/*.test.ts src/modules/supabase-auth/*.test.ts src/products/exchange/*.test.ts src/modules/integrations/*.test.ts src/modules/commerce/*.test.ts src/modules/entitlements/*.test.ts`
  — 193 passed, zero failures.
- New exploit regressions cover synchronous/asynchronous oversized arrays,
  generated and integration schemas, Maps/Sets, shared error identity, contract
  compatibility, Auth role rejection, form parameter flooding, JSON structural
  flooding, repeated query parameters, and successful requests after rejection.
  Getter traps prove no element access rather than relying on timing thresholds.
- Dependency rescan — **0 critical, high, moderate, low or informational findings**;
  raw result retained at
  `generated-artifacts/security-audit/zod-dependency-rescan.json`.
- Managed services restarted; API build/start and both Vite sites succeeded.
  Public console screenshot loaded normally without browser errors.

This closes the dependency advisory, not the separate pending authenticated
OWASP/production verification. No fresh production or signed-in browser
verification is claimed.

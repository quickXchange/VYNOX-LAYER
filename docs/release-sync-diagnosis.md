# Tenant release sync — diagnosis before application changes

## Development reproduction

Run `NODE_ENV=development node scripts/development-runtime.mjs pnpm --filter @workspace/api-server exec tsx src/verification/release-sync-before.ts`.
This creates only a disposable Sandbox tenant, using an in-process service test
principal; it creates no authentication identity or platform administrator.

Observed: public brand `Release Sync Probe` changed to `Unreleased Draft Brand`,
including primary color `#153F6B`, immediately after **Save**, without Release.
`to_regclass('public.tenant_releases')` returned null. There is no tenant Release
button or handler to press: activation/delivery and the unrelated global pricing
publication are not tenant configuration releases. Therefore the exact requested
four-field release reproduction cannot run against the old implementation.

## Cause checklist

| Cause | Finding | Evidence |
|---|---|---|
| A Build-time config | No | `private-label-website/src/pages/site.tsx` fetches `useGetPublicSite(slug)` at runtime; Vite variables select infrastructure/auth, not tenant branding. |
| B Anon/RLS empty fallback | No for this path | `routes/website.ts` calls the server's `getPublicSite`; it does not query Supabase with an anon browser key. Missing tenants produce 404, not a default tenant. Public projections use explicit database context. |
| C Draft/live not separated | **Yes, primary cause** | `modules/website/service.ts` reads mutable `tenant_branding`, entitlements, product settings and asset selections directly; `products/exchange/service.ts:publicExchange` independently reads current mutable configuration. There is no release snapshot or live pointer. A save leaks immediately; separate reads can represent different revisions. |
| D Stale cache | No demonstrated API-cache cause | `/public/sites` sends `Cache-Control: no-store`; the SPA refetches every 15 seconds/on focus. No release exists to key/invalidate a whole-configuration revision. A snapshot checksum is still needed. |
| E Private logo storage | **Yes, structural rollback risk** | `modules/website/branding-files.ts` resolves the current order attachment and current selected branding URL on every request. It does not preserve the bytes selected by a historical release. Curated current logos are streamed publicly; an arbitrary private object is intentionally not. |
| F Wrong tenant resolution | No demonstrated cross-tenant result | `publicTenantId` checks validated slug, status/delivery and exact preview tenant. Unknown slugs fail explicitly. Custom-host resolution remains ownership-gated; no domain is changed in this work. |
| G Version skew | No demonstrated current mismatch | The existing Production release workflow pins frontend and API to one reviewed SHA and verifies it; the previous deployed API readback is `51da637…`. This is not sufficient snapshot schema compatibility, which is currently absent. |
| H Keys saved/used elsewhere | No for implemented adapters; payment-gateway execution is not implemented | `modules/integrations/service.ts` seals per-tenant credentials into `tenant_integrations.encrypted_credentials`, resets verified health on edits and uses server-side adapters. `vault.ts` binds ciphertext to tenant/provider/environment. Do not invent gateway connectivity or enable financial execution. Release must refuse an enabled credential-required provider that lacks a successful test for its current revision. |

## Repair boundary

Keep the approved shared renderer and existing draft tables. Add atomic immutable
presentation releases, a tenant-owned live pointer, strict public projection,
version compatibility, content-addressed release assets, signed authorized draft
preview, history/diff/rollback UI and automated isolated-tenant tests. Existing
quote/pricing/order calculation and immutable order snapshots remain untouched.
Operational admission can still suspend a tenant immediately; release is never
financial activation. Existing websites without a release must not be silently
converted from arbitrary current drafts.

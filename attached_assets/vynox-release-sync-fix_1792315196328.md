# VYNOX LAYER: fix "what the customer configures is not what gets released"

**For the coding agent. Read the whole file first. Work through every step without stopping, one commit per step, then send one final report.**

## 0. The problem

A customer configures their white-label project in the Customer Admin: logos, colors, crypto payment gateway API keys, add-ons, routes, fees. When they press **Release**, the live tenant website does **not** match what they configured. Some changes are missing, old, or replaced by defaults.

**Rules:**

1. **One approved master.** Never fork the frontend or backend per customer. This rule comes from the architecture plan.
2. **Release is a data operation, not a code deployment.** Publishing a customer's settings must not need a rebuild, a GitHub Action or a redeploy.
3. Tenant isolation (RLS, memberships, permissions) must stay as strict as it is now, or get stricter.
4. **Secrets never reach the browser.** Gateway API keys stay server-side and encrypted.
5. Don't touch pricing, quote or order logic. Order snapshots stay immutable.
6. No DNS changes or domain cutovers, and no financial activation. The plan doesn't authorize any of these.

---

## 1. Step 1: find the cause (report before changing anything)

Reproduce the bug with a **fresh test tenant**: change the logo, the primary color, one route and one add-on, press Release, then open the tenant site in a private window.

Check each likely cause below and record **yes / no + evidence** for each one.

| # | Likely cause | How to check |
|---|---|---|
| A | **The site reads config at build time.** Config is baked in during `next build` / `vite build` or via env vars, so a release only shows up after a rebuild. | Search the frontend for config reads in build-time code (`getStaticProps`, `generateStaticParams` without revalidation, `import.meta.env.*` / `process.env.*` holding tenant values, JSON committed by an Action). |
| B | **RLS hides the config from the public site.** The public site uses the anon key, the RLS policies only allow tenant members, the query returns nothing and the UI quietly falls back to defaults. | Run the public site's exact config query as `anon`. Look for `?? defaultConfig` / `|| DEFAULTS` fallbacks that hide the empty result. |
| C | **Draft and live are the same rows, or Release copies only part of the data.** Release updates some tables (branding) but not others (routes, add-ons, payment methods), or it isn't in one transaction. | Read the Release handler. List every table the site reads, then every table Release writes. Note any table that is read but never written. |
| D | **A cache serves stale data.** CDN, ISR, a React Query/SWR cache, a service worker or the Render API's in-memory cache keeps old config, and nothing is invalidated on Release. | Release, then compare the raw API response with the page HTML and its response headers (`cache-control`, `age`, `x-vercel-cache`, `cf-cache-status`). |
| E | **Logos sit in private Storage.** Uploads go to a private bucket, the public site can't load them (403), and it falls back to the default logo. | Open a tenant logo URL while logged out. |
| F | **Tenant resolution is wrong.** The site works out the tenant from the host or path incorrectly, or from a cookie/session. Logged out, or on another URL, it shows the default or wrong tenant. | Load the tenant site logged out, on the path URL and on the subdomain (if any). Log which tenant ID the server resolves. |
| G | **Version skew.** The API and frontend are deployed from different commits, so field names don't match (the frontend reads `logoUrl` while the API returns `logo_url`) and values are silently dropped. | Compare the deployed commit SHAs. Diff the config type used by the frontend against the API response. |
| H | **API keys entered in the admin never reach the server that uses them.** The keys are saved in one place but the order/quote service reads env vars. | Trace a gateway key from the save handler to where it's used. |

**Deliverable for step 1:** a short report with the cause or causes, file paths and evidence. Several causes at once is normal. **Then continue with step 2. Don't wait for approval.**

---

## 2. Step 2: the target design (fix everything it requires)

### 2.1 Draft → Release → Live, all in the database

- **Draft:** what the customer is editing. These are `tenant_config_draft` tables, or a `status='draft'` row; keep the existing structure if it's sound.
- **Release:**
  - Run **one server-side function, in one database transaction**: validate the draft (section 2.4).
  - Build **one complete, immutable snapshot** in `tenant_releases`, with these columns: `id`, `tenant_id`, `version`, `config jsonb`, `created_by`, `created_at`, `checksum`.
  - Set `tenants.live_release_id = new id`.
- **Live:** the public site reads **only** the snapshot `tenants.live_release_id` points to. It never reads the draft tables.

**Rollback** means pointing `live_release_id` at an older release.

**The snapshot `config` must include everything the public site shows:**

- branding (name, logo URLs, colors, fonts, default theme);
- texts, legal pages and languages;
- enabled products and add-ons;
- assets, networks and payment methods (public fields only);
- routes;
- display limits;
- contacts and social links.

**It must exclude:** secrets, staff details, internal notes.

### 2.2 One public, read-only endpoint for the site

- Add `GET /public/site-config?host=<host>` (or `?slug=<slug>`).
- **It's served by the API using server-side credentials**, not the anon key. It returns only that tenant's `live` snapshot, with an `ETag` equal to the release checksum.
- It never returns draft data or secrets.
- RLS on the draft and secret tables stays members-only.
- An unknown tenant gets a **404 "site not found" page**, never a silent default brand.
- **Remove the code paths that silently fall back to default config** (cause B). A missing config is an error, logged with the tenant ID.

### 2.3 Rendering: no rebuilds

- The tenant site fetches `site-config` **at request time**, on the server (SSR or middleware) or at app start (SPA), keyed by host or path.
- **Caching is allowed only when it is invalidated by Release:**
  - **Next.js:** `fetch` with `next: { tags: ['tenant:<id>'] }`; the Release function calls a protected revalidate endpoint, which calls `revalidateTag('tenant:<id>')`.
  - **SPA:** `Cache-Control: no-cache` + `ETag` on `site-config`. React Query `staleTime` is at most 60 s and refetches on focus.
  - **CDN:** purge or short TTL for `site-config` only; static JS and CSS can stay long-cached.
- **Remove all tenant values from build-time env vars and committed JSON** (cause A).
- **GitHub Actions deploy only the master code, never customer config.**

### 2.4 Validation before Release

The Release function **refuses** with a clear list of what's missing if:

- a required brand field is empty (name, logo);
- a color pair fails 4.5:1 contrast;
- an enabled route uses a disabled asset, network or method;
- an enabled add-on has no required credentials;
- a payment gateway's required keys are missing or fail a **test call**.

The Customer Admin shows this list as a "Ready to release" checklist.

### 2.5 Assets

- Uploads stay in a private bucket for the draft.
- **On Release**, copy each used asset to a **public, content-addressed path**: `public-assets/<tenant_id>/<sha256>.<ext>`. The snapshot stores those URLs.
- A new logo gets a new URL, so caches never show an old logo, and old releases keep working for rollback.
- Validate type and size, and sanitize SVG.

### 2.6 Secrets (gateway API keys)

- Store them in a `tenant_secrets` table, encrypted (Supabase Vault or app-level encryption with a key held only in the API env).
- **No client can read them back.** The admin shows them masked (`••••1234`) with "Replace" and "Test".
- The quote/order service reads them **server-side per tenant** at use time. Releasing doesn't copy secrets; the snapshot holds only `gateway: "<provider>", configured: true`.
- Rotating a key takes effect at once, with no release needed. Record the change in the audit log.

### 2.7 Version alignment (cause G)

- **Put the config type in one shared package**, used by both the API and the frontend, with a `schema_version` in every snapshot.
- **The API and frontend deploy together** from the same commit (one workflow). The frontend checks `schema_version` and shows a clear error on a mismatch.
- **Old snapshots are migrated forward** on read, by a mapper per `schema_version`.

### 2.8 Release history in the admin

- A **Releases** panel showing the version, who released it, when, and a **diff** against the previous release (changed fields).
- Buttons: **Release**, **Preview draft** and **Roll back**.
- **Preview draft** opens the tenant site with a signed short-lived preview token. It renders the draft for that admin only and shows a "Preview, not live" banner.

---

## 3. Step 3: hosting (where Vercel fits)

Changing hosts **doesn't fix this bug by itself**. Steps 1 and 2 do. Once they're done, choose one of these:

- **Keep the current setup** (Render API + frontend host): fine, as long as step 2.3's caching rules hold.
- **Move the tenant website frontend to Vercel.** This is useful because:
  - its multi-tenant pattern serves one Next.js app for many hosts (middleware rewrites by host);
  - its Domains API can add a customer's custom domain and issue TLS automatically;
  - `revalidateTag` gives instant cache refresh on Release.

  The API and the database stay where they are (Render + Supabase).

**Custom domains** stay a **separate, later onboarding step**, as the architecture plan says: verify ownership, add the domain through the host's API, confirm TLS, then map host → tenant. **Start with path or subdomain URLs. No DNS cutover in this work.**

---

## 4. Step 4: tests that prove it's fixed

Automate these and run them in CI:

1. **Sync:** create tenant A. Change logo, color, route and add-on, then Release. The public page (logged out, private session) shows **all four changes within 60 s, without a deploy**.
2. **Draft isolation:** edit the draft without releasing. The live site is **unchanged**, and Preview shows the edit.
3. **Rollback:** roll back. The live site returns to the previous release, logo included.
4. **Two tenants:** tenants A and B release different brands. Neither ever shows the other's config, assets or routes.
5. **No silent defaults:** an unknown host returns the "site not found" page. A broken config logs an error rather than rendering the default brand.
6. **Secrets:** no gateway key appears in any public response, in the HTML, in the JS bundle or in the logs. Search the built bundle and the responses for test key strings.
7. **Validation:** releasing with a missing logo or untested gateway keys is refused with the right checklist item.
8. **Version skew:** a snapshot with an old `schema_version` still renders through the mapper.

---

## 5. Final report

- The causes found in step 1, with evidence.
- What changed: tables, functions, endpoints, frontend.
- The test results, with before/after screenshots of the sync test.
- Any open decisions for the owner, as `TODO(owner)`.

# VYNOX LAYER — official-domain migration plan

**Status: NO-GO for DNS switch. Preparation only; final switch requires explicit approval.**

Prepared on 18 October 2026 (Africa/Algiers). Provider observations were captured on 17 October 2026 UTC. No DNS records, domain assignments, deployments, authentication settings, accounts, secrets, policies or business records were changed for this preparation.

## 1. Confirmed frontend and current architecture

The correct existing main-platform Vercel project is **`qxlayer-staging`**, ID **`prj_MoGcFUBrfUHrmtRjHqNuYIaUbQcx`**. Its historical name is not its product identity. Its approved deployment serves the VYNOX LAYER main platform and the shared client-site application; it is not a Solara-only site or a customer Admin preview.

- Protected acceptance: `https://qxlayer-acceptance-vynox3.vercel.app`.
- Current approved application commit: `4c27c9ca1ea4fc318eb24cce75ecd1265d0e249b`.
- Vercel currently has **no Production deployment**, neither official hostname assigned, and automatic custom-domain assignment disabled.
- Provider protection remains `all_except_custom_domains`; acceptance retains provider SSO and its separate application access gate.
- Render API: `https://qxlayer-api.onrender.com`, service `qxlayer-api`, Frankfurt, existing Starter plan. Its effective application and Auth origins are currently the protected acceptance hostname.
- Supabase Production project: `qcgvhlphalxqzzsxqjhi`. Existing data, Auth identities, verified Owner TOTP and private storage must remain intact.
- `main` pushes trigger GitHub Actions → Render → protected Vercel Preview. The latest inspected release succeeded. This is intentionally a candidate-only workflow, **not** a public-production release.
- The old website remains on Replit at `https://www.quicklychan.xyz`; its current publishing metadata reports an active successful build. No Replit republish is part of this migration.

**Do not point the official domains at the current acceptance deployment.**

## 2. Canonical hostname and exact DNS targets

Use **`https://www.quicklychan.xyz`** as canonical. This preserves the existing Production Auth origin contract and the old site's primary hostname. Configure an HTTPS **308** redirect from `quicklychan.xyz` to `www.quicklychan.xyz`, preserving paths and query strings, with no reverse redirect or loop.

The values below were returned by Vercel's actual domain-configuration API for this project and both hostnames. They are not inferred from an old generic guide. Re-read the API immediately before an approved switch in case Vercel changes its recommendations.

### Recommended first-switch records: preserve existing verification TXT

| Type | Registrar host | Value | Intended TTL |
| --- | --- | --- | --- |
| A | `@` | `76.76.21.21` | 300 seconds, if supported |
| A | `www` | `76.76.21.21` | 300 seconds, if supported |

Vercel returned `76.76.21.21` as its rank-1 recommended IPv4 for **each** hostname. This first-switch option intentionally uses A records for both names.

**Why not immediately use a CNAME for www?** The existing `www.quicklychan.xyz` name also has a Replit verification TXT record. A CNAME cannot coexist with TXT or A records at the same name. Keeping that TXT while using Vercel's returned A target avoids deleting the old verification record and makes rollback simpler.

### Optional CNAME variant, not simultaneous with the www A/TXT records

| Type | Registrar host | Exact Vercel-returned value | Preconditions |
| --- | --- | --- | --- |
| CNAME | `www` | `cname.vercel-dns.com.` | Replace the www A and retire its old verification TXT only with explicit approval and a registrar backup |

Never install both variants, or leave a www A alongside a www CNAME. The apex A remains `76.76.21.21` in either variant.

### TXT, CAA, IPv6 and mail

- Neither official hostname is currently registered on the Vercel project. **No project-domain ownership TXT challenge has been issued yet.** Do not invent a TXT value or claim ownership verification is complete.
- When domains are attached to the approved public release, follow any exact Vercel-issued TXT ownership challenge. Its name/value must be captured then; adding it is itself a DNS change and needs approval under the present hold.
- Keep existing Replit verification TXT for the recommended A-record option. It is preserved in the observed DNS backup.
- Keep the existing apex SPF TXT, both Private Email MX records, all Resend/DKIM/DMARC records, storage and other subdomains. Do not change nameservers.
- No apex/www AAAA or CAA answers were observed. Do not introduce an IPv6 record pointing to the old site. Current CAA observations do not show a restriction blocking Let's Encrypt; recheck at execution.
- No DNS change is authorized now, including lowering TTL.

## 3. Current DNS backup and rollback values

Authoritative nameservers observed: `dns1.registrar-servers.com` and `dns2.registrar-servers.com`.

| Name/type | Observed current value | Observed TTL |
| --- | --- | --- |
| apex A | `162.255.119.145` | 1800 |
| www A | `34.111.179.208` | approximately 300; cached responses may show less |
| apex MX | `10 mx1.privateemail.com.` and `10 mx2.privateemail.com.` | 1800 |
| apex TXT | `v=spf1 include:spf.privateemail.com ~all` | approximately 1800 |
| www TXT | Existing Replit verification value, retained verbatim in the DNS snapshot | 300 |

The machine-readable snapshot is `generated-artifacts/official-domain-migration/dns-observed-backup.json`. It includes queried DNS answers, TTLs and authority responses.

**This is an observed public-DNS backup, not a complete registrar zone export.** DNS cannot enumerate all unknown hostnames or a registrar's URL-forwarding configuration. Obtain a complete registrar export/screenshots, including URL forwarding, original editable record types and configured TTLs, before switching. In particular, the parking/forwarding apex A may be generated by a registrar URL Redirect record; restore the actual registrar configuration, not merely a guessed record type.

Do not detach the old Replit domain, delete its deployment, cancel its hosting, remove source accounts, or alter its certificate configuration during the rollback period.

## 4. HTTPS readiness

**Vercel HTTPS is not yet issued or verified for these domains.** Neither domain is attached and their DNS still points elsewhere. Vercel automatically attempts Let's Encrypt issuance after domain attachment and successful validation; for ordinary non-wildcard names its documentation describes HTTP-01 validation, which depends on traffic reaching Vercel.

- The **old** www endpoint currently has a hostname-valid Let's Encrypt certificate, observed expiry **3 January 2027**. This is not evidence of a Vercel certificate.
- Direct TLS to the current apex timed out during this preparation. Do not treat apex HTTPS as verified.
- Before marking the new site healthy, verify valid hostname/chain/expiry for **both** names, then HTTP→HTTPS and apex→www behavior. An HTTPS redirect still needs a valid certificate on the apex.
- Test with normal certificate validation. No `ignoreHTTPSErrors`, disabled hostname checks or custom trust bypass can satisfy acceptance.
- Exact production-host browser testing remains pending; some final validation necessarily follows the separately approved DNS change. Keep rollback ready during certificate issuance.

## 5. Backend, authentication and email findings

### Verified now

- Render health responds; existing deployment remains acceptance-only.
- Render's `QXLAYER_PLATFORM_URL` and `QXLAYER_PRODUCTION_SUPABASE_AUTH_URL` both point to acceptance.
- `QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED=true`, application gate enabled, and public Auth cutover approval remains **false**.
- Supabase's current Site URL is acceptance.
- Supabase redirect allowlist already contains **both** `/verify-email` and `/reset-password` on official www and acceptance, with exact HTTPS URLs.
- Email verification remains required; SMTP is configured through Resend on port 465.
- The original migrated Production Owner is present, email confirmed, original business binding intact and a verified TOTP factor present. No password reset, factor reset or identity replacement was performed.
- Application mutations enforce a strict configured origin. API routes are proxied through the frontend's same-origin `/api/...`; wildcard credentialed CORS is neither needed nor appropriate.
- Account-session cookies are server-issued, Secure, HttpOnly, SameSite=Lax and host-scoped. The separate acceptance gate has its own cookie and remains separate from account authentication.

### Required public-release changes — not executed

1. **Separate runtime contracts.** Public www must use the exact canonical public origin; acceptance must retain its exact acceptance origin. Simply replacing the existing Render origin breaks acceptance mutations/authentication.
2. **Recommended backend isolation:** prepare a separate public Render API runtime connected to the already-approved Production Supabase and restricted roles. Preserve the current acceptance API and its configuration. Any additional hosting cost requires approval; no service has been created.
3. **Release path:** prepare an explicitly approved public-production GitHub Actions environment and release path, separate from automatic candidate deployments. Record exact frontend/backend commits and rollback releases. Do not turn routine main pushes into unreviewed public promotions.
4. **Vercel public runtime:** support a tightly validated public mode without the whole-site private-review form, while keeping acceptance's gate compulsory. `deploy/vercel/handler.mjs` currently requires the private gate unconditionally; copying its existing configuration would leave the public site gated or fail startup.
5. **Candidate workflow compatibility:** keep its verifier requiring that each new candidate deployment is Preview-only and has no custom-domain aliases. These checks can coexist with a separate Production deployment in the same project; do not weaken them. Add preservation checks proving candidate jobs leave the recorded public deployment and both official-domain mappings unchanged. The one-time `configure-automatic-candidate.mjs` setup helper assumes no existing Production target and must not be rerun blindly after launch.
6. **Email routing:** current confirmation/recovery templates use `.SiteURL`. Changing Site URL to www alone could send acceptance users to public www. Make these flows use an exactly validated per-request redirect destination (or another tested origin-aware template mechanism), preserving token-hash redemption and recovery controls. Keep both exact redirect pairs allowed; no wildcard allowlist.
7. **Sessions and keys:** configure public server-only secrets through provider secret stores, never browser variables or reports. Do not rotate existing acceptance/session secrets. Determine the session-table/encryption-key strategy before provisioning a second runtime; preserve accepted sessions and validate realm/host isolation. Do not copy candidate-only provider-vault custody into a new public runtime without separate authorization.
8. **Final activation controls:** public Auth cutover flags must remain false until separately approved. Existing guards are deliberate safety holds, not defects to disable during preparation.

No application-level failure was found in the currently approved acceptance setup requiring an immediate runtime change. The public-release gaps above require a separately verified release configuration; bypassing them now would violate the cutover hold.

## 6. Public exposure and data-safety acceptance criteria

Before authorizing the switch, all of the following must be evidenced:

- Anonymous official-domain visitors see only approved public marketing and public-read-only endpoints.
- Anonymous account/admin APIs return 401/403; Admin routes require native account sign-in, appropriate role and Owner MFA. Public-domain exemption from Vercel SSO must not be mistaken for account authorization.
- Solara, retained test tenants, customer Admin previews, operator previews and fictional customer records do not become public merely because the platform-wide gate is absent. Review their actual delivery/domain state, route authorization and host policy. Do not delete retained fixtures to hide them.
- Approved catalog visual previews are distinguished from real customer data and from financial execution.
- Provider monitoring, wallet/RPC configuration and demo sessions do not activate deposits, payouts, transfers, exchange execution, provisioning workers or sandbox-only money operations. Workers/financial capabilities require their own authorization; domain connection is not that authorization.
- Private uploads/storage, tenant RLS, role grants, account identities and MFA factors remain unchanged. No schema replay, sample-customer import, destructive seed replay or blanket permission change is part of a DNS migration.
- Reconcile current old-Live and Supabase customer/business records before selecting an authoritative writer. Preserve both datasets. If legitimate writes occurred since the accepted baseline, resolve the delta explicitly; DNS changes do not migrate it.
- Separate frontend/API runtimes do **not** by themselves isolate data when they use the same Production Supabase. Acceptance testing after launch must be read-only or explicitly confined to authorized isolated fixtures. The candidate workflow currently includes reviewed global-reference synchronization into this database. Review that write path before launch: a protected-candidate deployment must not become an unreviewed way to change live global configuration. Keep any production-impacting synchronization behind the approved public-release controls, or design separate acceptance data isolation; do not silently change the current workflow during this preparation.

## 7. Readiness matrix

| Check | Result |
| --- | --- |
| Correct main-platform project identified | PASS |
| Exact current Vercel A/CNAME recommendations read | PASS |
| Existing DNS observations captured | PASS, registrar export still required |
| New public Production deployment ready | BLOCKED: absent |
| Official hostnames attached/ownership verified | PENDING |
| New Vercel HTTPS certificates verified | PENDING |
| Backend supports public origin while acceptance remains working | BLOCKED: current API is acceptance-pinned |
| Public release workflow and candidate boundaries compatible | BLOCKED: public release path absent; preserve existing Preview-only guards |
| Supabase www callback allowlist | PASS |
| Origin-aware public + acceptance email behavior | BLOCKED: Site URL/template coupling needs tested preparation |
| Existing Owner identity, email and TOTP readback | PASS; new-host native login/MFA still pending |
| Public route/demo/financial isolation | PENDING targeted public-release verification |
| Data/schema/Owner-role preservation readback | PASS at handoff; retained demo excluded by existing verifier; repeat before execution |
| Post-launch acceptance/global-reference write isolation | PENDING explicit data/write-policy review |
| Exact-host sessions/login/reload/logout/recovery | PENDING real public release and valid HTTPS |
| Explicit final DNS-switch approval | NOT GIVEN |

**It is not safe to switch the domain yet.** Known DNS values alone are not a release-readiness result.

## 8. Ordered execution plan

### A. Preparation, with DNS unchanged

1. Approve the public-runtime isolation/cost decision. Keep the existing acceptance runtime and alias untouched.
2. Prepare public-mode validation, origin-aware mail behavior, release workflow and isolation tests in the existing repository. Pin immutable releases; protect the public release with explicit approval.
3. Prepare the public runtime/Production environment without copying Development customers, credentials or provider-vault permissions. Use already-approved Supabase roles and identity bindings; no identity migration/reset.
4. Test candidate behavior and future-public origin contracts at code/configuration level. Recheck private-route, cookie, tenant-RLS, demo and financial boundaries. Report any checks that cannot yet be executed against valid official-host HTTPS.
5. Obtain the full registrar export and rollback screenshots. Record old and new release IDs, DNS values/TTLs, source availability and approved read/write state.
6. Present the final bounded change set, residual certificate/host checks, maintenance window and rollback conditions. Request explicit approval for the final DNS change. No routine push or existing approval is a substitute.

### B. Only after explicit switch approval

1. Freeze old-Live/new-public business writes or establish another proven single-writer arrangement. Capture a final consistent data baseline and reconcile any delta before opening writes.
2. Take fresh provider and registrar backups. If lowering TTL to 300, wait for prior TTLs to expire; changing TTL is included in the approved DNS operation.
3. Publish the approved public frontend/backend release through GitHub Actions with public-only origin/configuration. Keep the acceptance alias/runtime protected and verify they still work.
4. Assign www and apex to that public Production release, set the apex 308→www redirect, obtain exact ownership challenges if any, and revalidate Vercel's recommended DNS values.
5. Change only the approved traffic records (recommended two A records). Retain MX/SPF/DKIM/DMARC, nameservers and rollback verification TXT. Remove registrar URL forwarding only as specified in the approved record diff.
6. Verify propagation through authoritative DNS and independent resolvers, domain ownership, both valid certificates, canonical redirects without loops, and exact frontend/backend release identities.
7. Run the real native Owner sign-in → existing TOTP → authorized Admin → reload/logout journey, plus confirmation/recovery and account-session isolation. Use no password/MFA resets, no injected application sessions and no destructive test customers.
8. Verify anonymous public access and protected Admin/tenant routes, email destinations, private storage and financial holds. Recheck acceptance remains separately protected.
9. Open public business writes only after the checks pass. Monitor errors and mail behavior; retain old hosting and rollback records through the agreed observation window.

## 9. Rollback

Trigger rollback for incorrect site/tenant content, certificate failure that exceeds the approved window, broken login/MFA/recovery, API/origin/session failures, private-data exposure, or unintended financial execution.

1. Stop new public business writes and protect the failing public release; do not disturb acceptance.
2. Snapshot any post-switch Supabase writes. Restore the backed-up registrar traffic/forwarding configuration, including old apex behavior and www `34.111.179.208`; preserve mail and verification records.
3. Restore previous public application/configuration releases if those changed. Keep accepted Owner identities, passwords, MFA and secrets intact.
4. Verify old-source DNS, HTTPS, account access and business data. Cached DNS may continue sending users to either site until TTL expiry.
5. Reconcile all new transactions before restoring old-Live writes. **DNS rollback alone cannot safely roll back two diverging databases.** Never restore an old database over new customer activity.
6. Retain the failed release, logs and new data for investigation. Do not delete Supabase data or recreate accounts as recovery.

## Evidence and references

- Provider inventory: `generated-artifacts/official-domain-migration/readiness-inventory.json`.
- Public DNS snapshot: `generated-artifacts/official-domain-migration/dns-observed-backup.json`.
- Existing preservation verifier: `.local/customer-external-preservation.mjs --exclude-demo --verify` (read-only; its explicitly retained demo exception is not authority to expose that demo publicly).
- Vercel: https://vercel.com/docs/domains/working-with-domains/add-a-domain
- Vercel certificates: https://vercel.com/docs/domains/working-with-ssl
- CNAME exclusivity: https://www.rfc-editor.org/rfc/rfc1034#section-3.6.2

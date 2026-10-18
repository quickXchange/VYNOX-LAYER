# Official domain connection — activated and verified

## Final verification — 2026-10-18

- Primary: `https://vynoxlayer.com`, serving the main VYNOX LAYER website.
- `https://www.vynoxlayer.com` redirects with HTTP 308 to the primary,
  preserving path and query, including the sign-in route.
- Valid independent Let's Encrypt certificates are present for both hosts;
  Vercel reports automatic renewal enabled. No SSL blocker remains.
- Both aliases use the existing `qxlayer-staging` Production project
  `prj_MoGcFUBrfUHrmtRjHqNuYIaUbQcx`, READY Production deployment
  `dpl_7wahxuNYMXgzSFx9vedBE6UVaBCz`.
- Frontend and Render API are at source
  `0088940d6c35231bdeff6531abaa93eba1129675`.
- Existing GitHub Actions Production workflow completed successfully:
  https://github.com/quickXchange/VYNOX-LAYER/actions/runs/39136004507
- The release is based on verified Live, with only domain/authentication-origin,
  packaging, workflow and verification changes. Unrelated pending Exchange and
  schema changes were not included. Normal push candidate automation was
  suppressed to preserve the exact acceptance deployment.

### Diagnosed and resolved

Certificate issuance completed after DNS became accepted. The missing deployment
aliases were assigned to the verified Production deployment without editing DNS.
The existing project-level www redirect remained HTTP 308.

Browser verification then found an independent rendering blocker: the browser
authentication guard still pinned previous origins and aborted before React
mounted. The browser and packaging now share an explicit approved-origin
validator, with regression coverage. The corrected public bundle renders.

### Authentication and preservation evidence

- Production frontend, API and authentication configuration now use
  `https://vynoxlayer.com`; the HTML includes the canonical and Open Graph URL.
- Supabase Site URL is primary. Its exact verification/recovery callback URLs
  were added without removing legacy or protected acceptance callbacks.
  Existing mail text, policy, credentials and unrelated provider fields were
  verified unchanged.
- The same-origin `/api` proxy reaches the existing Render Public API.
  Health is ready, database/private Auth connected, schema verified and the
  reviewed source commit matches.
- Canonical authentication requests pass the origin guard; unapproved and
  cross-site origins return 403. CORS was not widened.
- Fresh anonymous `/api/auth/session` and `/api/me` return 401.
  Anonymous logout clears the original host-only Production cookie with
  Secure, HttpOnly, SameSite=Lax and Path=/; no Domain attribute was added.
- Browser checks pass on desktop and mobile, including the native password
  sign-in form and anonymous `/admin` redirect to `/sign-in`. No page errors,
  console errors or failed requests were observed in the corrected flow.
- Protected acceptance remains Vercel SSO-protected at its exact existing
  deployment `dpl_9tzDi1xCmKpVdFWT6hJecU5X1HDR`.
- quicklychan.xyz project records and alias assignments remain unchanged.
  The existing `www.quicklychan.xyz` private-gate 403 is unchanged from baseline;
  this release does not claim to restore or alter that legacy site's access.
- No DNS edits, customer/business-data migrations, new identities, password/MFA
  resets, or financial activation occurred. Financial execution and the internal
  public-Live business activation flag remain false.
- **Pending personal confirmation only:** the original Owner must sign in on
  the primary domain with their existing password and Google Authenticator,
  confirm Super Admin access and reload to verify their authenticated session.
  Positive Owner access is not inferred from anonymous checks.

Machine-readable HTTPS/API/origin/cookie evidence is retained in the ignored
`generated-artifacts/official-domain/https-api-auth-readback.json`.

## Earlier DNS-ready readback (superseded by final verification)

- Both apex and www now resolve to `64.29.17.1` and `216.198.79.1`.
- Vercel reports both domains verified, `misconfigured: false`, with no conflicts.
- www is configured through A records, not CNAME; Vercel accepts this configuration.
- Project configuration retains www → apex HTTP 308.
- Direct HTTPS requests to both domains fail during the TLS handshake.
  Certificate readiness, actual redirect behavior and frontend/API functionality
  on the new domain remain unverified.
- No DNS, hosting, application, identity or database changes were made during
  this readback. Registrar API automation is no longer a prerequisite for the
  presently accepted web DNS configuration.

The sections below record the earlier preparation and blockers; their
DNS-not-ready observations are superseded by the readback above.

## Authorized scope

Primary `https://vynoxlayer.com`, with `https://www.vynoxlayer.com` redirecting
to primary. Preserve quicklychan.xyz, protected acceptance, customer data,
the existing Owner/password/Google Authenticator, and disabled financial execution.

## Provider preparation completed

- Verified Vercel project `qxlayer-staging`,
  `prj_MoGcFUBrfUHrmtRjHqNuYIaUbQcx`, team
  `team_eoJE6FCcm9esuqnRTUsmopzy`.
- Existing public alias resolves to READY **Production** deployment
  `dpl_HVDhdASEYmqhtYMt6Vje2KBWsCBq`, source
  `51da6373b7b50fee39926a025b40992ad559e2e1`. The separate Preview target was not used.
- Added `vynoxlayer.com` to that project; ownership verification returned true.
- Added `www.vynoxlayer.com` with project redirect to `vynoxlayer.com`, HTTP 308;
  ownership verification returned true.
- Existing quicklychan.xyz and www.quicklychan.xyz project records/redirects
  remain unchanged. Protected acceptance still redirects to Vercel SSO.
- No source deploy, environment update, database write or identity change occurred.

Ownership verification is **not** DNS readiness. Both new domains still have
`misconfigured: true`. Assigning apex to the exact existing Production deployment
returned HTTP 400 `cert_missing`: no SSL certificate is available yet.
Neither new domain has a working deployment alias; do not report launch complete.

## Exact Vercel DNS recommendations after project registration

Authoritative nameservers are Namecheap:
`dns1.registrar-servers.com`, `dns2.registrar-servers.com`.
Do not change nameservers.

| Type | Host | Value |
|---|---|---|
| A | @ | 216.198.79.1 |
| A | @ | 64.29.17.1 |
| CNAME | www | c49844fce727e926.vercel-dns-017.com |

These are the rank-1 values returned by
`GET /v6/domains/{domain}/config` after adding the domains. Use Automatic TTL.
Current public DNS has no apex A/AAAA or www A/CNAME configured. Preserve all
unrelated records. Publicly observed email records include both
`mx1.privateemail.com` and `mx2.privateemail.com` at priority 10 and SPF
`v=spf1 include:spf.privateemail.com ~all`. No DNS records were edited.

## Exact registrar blocker

No Namecheap integration is connected/available in the searched integration
catalog. The authorized browser attempt to open Advanced DNS redirected to the
official Namecheap login form; it had no authenticated session and no secure
user-interactive login handoff. No passwords, codes, cookies or recovery flows
were requested or used. Existing Namecheap SMTP credentials are not DNS authority.

Smallest manual unblock: in Namecheap Domain List → vynoxlayer.com → Manage →
Advanced DNS, add the three records above without changing any mail/TXT records.
Alternative: explicitly authorize Namecheap API automation through secure
credential entry plus the registrar's API/IP authorization requirements. Never
send the API key, password or 2FA code in chat.

## Checks already performed

- Existing frontend: HTTPS 200 and VYNOX LAYER landing.
- Existing API `/api/healthz`: HTTPS 200, ready, database/private Auth connected,
  schema verified, financial execution disabled; still public-preparation mode.
- Existing frontend `/api/auth/session`: 401 for an anonymous request with
  Render response headers, confirming same-origin proxy reaches the API.
  This is not positive login evidence.
- Protected acceptance: Vercel SSO redirect remains in place.
- New apex and www: DNS not resolving to web targets; valid HTTPS not verified.

## Continue after registrar unblock

1. Re-read DNS on authoritative/public resolvers and compare mail/TXT preservation.
2. Re-read Vercel configuration and certificate readiness. Assign the new apex
   explicitly to the verified existing Production deployment when certificate-ready.
   Verify www's actual HTTPS redirect preserves path/query and uses 308.
3. Complete canonical-domain/API/Auth configuration without changing identity,
   secrets, original MFA or protected acceptance.
   The current public-preparation guard explicitly pins the old quicklychan
   origin; do not blindly change environment values alone or deploy unrelated
   unapproved tenant-release work just to change domains. Use a tested,
   narrowly scoped master change based on the verified Live version.
4. Verify landing/assets, same-origin API, auth/session/logout cookies,
   allowed-origin/CSRF rejection and customer/Super Admin routing.
5. Original Owner verification stays **pending** until the user personally checks
   their original password + Google Authenticator MFA + Super Admin access.

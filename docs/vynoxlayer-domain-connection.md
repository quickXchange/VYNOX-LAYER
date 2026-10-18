# Official domain connection — blocked at registrar access

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

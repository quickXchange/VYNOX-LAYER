---
name: Publishing domain
description: User's intended custom domain for the published project.
---

The official primary domain is https://vynoxlayer.com, with
https://www.vynoxlayer.com redirecting to it. Preserve the old quicklychan.xyz
domain and protected acceptance environment unchanged.

**Why:** The user explicitly authorized DNS and hosting configuration for
vynoxlayer.com and superseded the earlier quicklychan.xyz primary-domain goal.

**How to apply:** Use the existing Production frontend and API identified by
provider readback. Do not move domains to a new project or deploy unrelated pending
features. Check current provider metadata and DNS; preserve mail records and
unrelated TXT records. A registrar login in the user's own browser does not
authenticate an isolated automation browser without a supported secure handoff.

The official domain must serve the main VYNOX LAYER website, not the Solara demo
or a customer Admin preview. Preserve the protected acceptance website separately
for testing after the public-domain migration.

**Why:** The user explicitly required these product and environment boundaries
in the official-domain migration instructions.

**How to apply:** The user has authorized this official-domain connection.
Verify the main-platform destination, valid HTTPS, API connectivity and continued
acceptance protection before claiming activation. Original Owner sign-in remains
pending until the user personally verifies their existing password, Google
Authenticator MFA and Super Admin access. Never create a replacement Owner.

Use the established GitHub Actions Production release workflow for official-domain
activation. Preserve the exact protected acceptance deployment during a domain-only
release, not merely its SSO setting. Keep unrelated pending Exchange work out of
the Production source snapshot.

**Why:** The user explicitly required the existing deployment workflow and
preservation of protected acceptance and Exchange. The normal main-push candidate
automation can independently advance acceptance.

**How to apply:** Release from verified Live with a bounded source change and
suppress unrelated push automation; verify both deployment identities afterward.
DNS is now accepted by Vercel. Namecheap API access is no longer needed or
authorized as a prerequisite; do not edit the correct DNS records.

Treat server, packaging and browser authentication-origin guards as one release
boundary. HTTPS, an HTML 200 and a healthy API are not proof the website renders.

**Why:** A canonical-domain mismatch in the browser guard aborted module
evaluation before React mounted, while the page assets and API all returned 200.

**How to apply:** Validate shared origin metadata at packaging time and verify
the rendered public website and native sign-in route after domain changes.
Keep positive Owner/MFA proof separate from anonymous rendering evidence.

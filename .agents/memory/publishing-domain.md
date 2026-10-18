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

---
name: Vercel custom-domain alias safety
description: Safety checks when registering or binding a Vercel custom hostname.
---

Assigning a Vercel alias to a deployment can remove it from its previous deployment.

**Why:** The Vercel Assign an Alias API explicitly documents that an alias already assigned elsewhere is moved to the requested deployment.

**How to apply:** Treat binding as a routing change: require explicit approval of the exact hostname and READY Production deployment, verify project ownership, then read the deployment's alias list back before reporting the binding as complete.

---
name: Render Corepack runtime
description: Writable-shim assumptions fail on newer Render Node build images.
---
Use the pinned package manager through `corepack pnpm`, without requiring
`corepack enable` to rewrite global executable shims on a fresh Render service.

**Why:** The newer Node 24 Render build image exposed `/usr/bin/pnpm` on a
read-only filesystem; enabling Corepack failed before dependency installation,
even though the existing older service's command had worked.

**How to apply:** When provisioning or repairing a Render build, prefer a
package-manager invocation that does not mutate system executable paths. Do not
change a working acceptance runtime merely to match a new service.

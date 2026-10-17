---
name: Protected provider configuration
description: Sensitive Vercel variables and provider-specific PostgreSQL backup authentication.
---

For existing Vercel Sensitive Environment Variables, PATCH only the fields being
changed; do not include key or type even when their values would be unchanged.
Keep Preview changes separate from other targets.

**Why:** Vercel rejects key/type fields on Sensitive updates, including apparently
unchanged values. Recreating variables or narrowing a shared target list can
unnecessarily change unrelated environments.

**How to apply:** Preserve sensitivity and non-Preview targets. Split a shared
entry carefully if an isolated Preview value is required.

Do not copy the Live source's mandatory SCRAM channel-binding backup setting to
the isolated Supabase session pooler without checking advertised capability.
The target pooler does not advertise SCRAM-PLUS; its backup uses negotiated
channel binding, matching its existing Node client, with verify-full CA and
hostname validation. The Live source's require policy remains unchanged.

**Why:** Requiring an unadvertised authentication mechanism prevented the encrypted
snapshot before DDL. This is a provider capability boundary, not grounds to weaken
TLS or change the Live source's required channel binding.

**How to apply:** Keep target and source transport policies separate and report
negotiated channel binding honestly; never claim it is mandatory on this target.

Provider protection and the application private gate are separate boundaries.
A non-browser request without `Accept: text/html` can receive the application's
intended 403 JSON even after Vercel has authorized the request.

**Why:** Approved project automation access issued a provider cookie successfully,
but non-HTML probes looked blocked; the real browser completed the private gate
and same-origin API journey. Do not diagnose an application-gate 403 as failed SSO.

**How to apply:** Classify the responding layer, not just the status. Keep bypass
headers restricted to the exact protected host, keep credentials in memory, and
revoke temporary access with a readback that preserves SSO and existing bypasses.

Successful provider authorization in a Node HTTP request does not prove that a
managed browser's navigation carries the same authorization. Establish a genuine
provider-issued session in that browser context before testing the native gate.

**Why:** A fresh browser reached provider SSO even though the same approved grant
returned the real application gate in Node. A provider-issued browser session
resolved verification without changing SSO or bypassing application authentication.

**How to apply:** Keep provider authorization separate from application access.
Use only the exact protected origin, never fabricate application cookies, and
revoke temporary provider grants after closing the test context.

Normalize object-key order before comparing provider protection snapshots across
the execution sandbox boundary.

**Why:** Sandbox serialization reordered object keys, so plain JSON string
comparison falsely reported a protection change; normalized per-field comparisons
confirmed every protected setting was unchanged.

**How to apply:** Compare recursively key-sorted structures, verify response
success before comparison, and keep credential-map contents out of logs.

Do not assume standard Node/browser cancellation globals exist inside the
execution sandbox, even in impure functions.

**Why:** Its fetch implementation was available while AbortSignal was undefined,
so a diagnostic failed before making any network request.

**How to apply:** Check cancellation support before using it, or use bounded
CLI HTTP requests. Distinguish a local runtime exception from provider rejection.

Provider-vault provisioning approval is candidate-only: keep its key on the
protected Render API service, not in linked environment groups, Development,
Replit Shared secrets, or browser configuration. This is not permission to add
provider credentials, activate financial execution, resume workers, or cut over Live.

**Why:** The user explicitly approved provisioning the candidate-only vault.

**How to apply:** Preserve existing keys rather than rotating them, verify
unrelated configuration and held-runtime boundaries, and obtain separate scope
before extending credential provisioning to another environment.

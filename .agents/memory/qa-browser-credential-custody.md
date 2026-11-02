---
name: QA browser credential custody
description: Browser-test subprocess credentials and inherited provider runtime settings can differ.
---

Do not assume the browser tester's Node process inherits workspace secrets. Keep approved test credentials in a narrowly scoped loopback broker's memory, never in output, browser storage or files.

**Why:** Native Staging verification stopped because the tester had no workspace access-password variable. An inherited provider runtime value also differed from the original password input, even though the approved Staging password verifier was correct.

**How to apply:** Before starting a critical native journey, check credential availability and, when possible, verify the supplied private-gate input against the existing verifier using boolean-only results. Capture the approved input before loading inherited runtime settings. Continue through the actual gate form and native identity sign-ins; missing test credentials never justify injected auth cookies or ownership-verification bypass.

A managed browser's resource exhaustion or closed service is an incomplete test, not an application failure or a passing verification. Preserve partial results and recover with an isolated workspace browser when available, rather than changing app code to address the tester service.

**Why:** The managed browser failed with resource exhaustion and could not create new contexts, while independent Chromium completed the same public and native authenticated flows successfully.

**How to apply:** Continue the same tester's scope, dispose pages/contexts, keep temporary browser dependencies out of application dependencies, and retain the loopback/in-memory credential boundary during recovery.

Native sign-in tests must suppress automatic accessibility snapshots of populated credential fields.

**Why:** A managed browser snapshot included disposable sign-in field values despite instructions not to print credentials. The test stopped and the identities were deleted.

**How to apply:** Use a browser execution path with controlled, sanitized output before entering credentials. Never reuse affected disposable credentials; revoke sessions and delete their exact scoped accounts first.

Do not create replacement QA administrators for repeated browser-harness retries after losing the only in-memory MFA material. Stop and request secure access to the retained fixture instead.

**Why:** Failed harness runs left additional active Development administrator fixtures with unrecoverable in-memory factors, without advancing the cross-role verification.

**How to apply:** Persist exact non-secret fixture scope, keep one controlled credential process alive across journeys, and treat its loss as a blocker. Never reset existing factors, create more privileged identities, or delete fixtures without the required approval.

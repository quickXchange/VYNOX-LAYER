---
name: Security scanner runtime boundaries
description: Temporary-storage quotas, native versus direct Pro authorization, and streaming very large privacy reports.
---

Treat scanner runtime failures separately from application findings. Use the
managed scanner first. If system temporary storage fails, a local CLI can use
workspace-local scratch/cache paths; HoundDog may also need a process-scoped
workspace-local HOME. Do not change the app's HOME or shared credentials to fix
a scanner.

**Why:** System temporary-directory quotas broke scanners, browser startup and
workflow helpers while the workspace volume remained writable. HoundDog's
direct CLI completed only with isolated scratch/cache/home storage.

**How to apply:** Scope temporary environment changes to the scanner subprocess,
keep generated reports ignored, and distinguish a failed tool attempt from a
successfully completed equivalent scan. A successful managed Pro scan does not
mean the separately installed direct Pro binary has authentication; its login
error is not evidence that the managed scanner is unavailable.

Shell free-space readings and successful scanner runs do not prove browser
runtime capacity.

**Why:** Browser startup still reported ENOSPC after shell scratch storage showed
ample capacity and all managed scanners completed.

**How to apply:** Verify the specific failing runtime; do not declare the storage
blocker resolved from shell disk statistics alone.

Stream large privacy report summaries instead of loading their whole JSON into
Node memory.

**Why:** A full privacy report exceeded Node's 2 GiB Buffer limit, despite having
very few flagged flows. Data-element occurrences can dominate report size.

**How to apply:** Use a streaming JSON parser for counts/severities and retain
raw reports only in ignored generated-output storage. Do not dump occurrence
content or credentials into chat while summarizing scan results.

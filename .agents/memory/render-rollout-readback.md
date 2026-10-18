---
name: Render rollout readback
description: Live deployment metadata does not immediately prove an environment-only policy change reached public traffic.
---
After an environment-only Render release, verify the changed policy through the
public request path, not just the deployment's `live` status or unchanged commit.

**Why:** Immediately after `live`, a request still observed the previous QA write
allowance; the subsequent public request correctly observed its removal.

**How to apply:** Use a bounded wait for the intended policy response after a
rolling release. Do not launch another deployment merely because the first
post-`live` request reached the previous instance.

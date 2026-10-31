---
name: Authentication retry budgets
description: Account-wide retry protection and legitimate Owner continuity.
---
Keep authentication account retry budgets independent of source IP in every
environment, while retaining short retry windows rather than permanent lockouts.

**Why:** An IP/account pair permits a distributed attacker to reset the application
retry budget; the user explicitly prohibits protections that permanently lock out
the legitimate Super Admin.

**How to apply:** Normalize account identifiers before HMAC hashing, preserve
provider and source-side protections, and test IP rotation. Do not claim that
mocked counters prove distributed live enforcement or timed database expiry.

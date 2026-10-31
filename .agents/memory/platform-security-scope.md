---
name: Platform security scope
description: Whole-platform security work requires verified backups, real telemetry and explicit infrastructure approval.
---
Security scope covers the entire platform, not only Super Admin. Use real monitoring data; never present synthetic events as real attacks or application validation as a WAF.

**Why:** The user explicitly expanded the security requirements to layered abuse defense, real monitoring, recovery, and all accessible attack surfaces.

**How to apply:** Preserve Owner access and existing controls, avoid permanent customer lockouts, and obtain approval before paid services, DNS or infrastructure changes. Complete backup and restoration verification is a prerequisite to hardening changes unless the user explicitly approves a narrower Development-only sequence. No destructive Production testing.

The user chose complete external recovery first when offered Development-only hardening in parallel. Keep application hardening paused until that prerequisite is met.

**Why:** This was an explicit sequencing decision, not an assumed preference.

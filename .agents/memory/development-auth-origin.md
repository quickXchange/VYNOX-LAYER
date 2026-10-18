---
name: Development Auth origin
description: Keep Supabase Development Auth callbacks and the browser client pointed at the current Replit preview origin.
---

The configured Development Auth origin must match the current Replit Development HTTPS hostname in both server and browser settings. Treat that hostname as runtime-provided and potentially changeable; never copy a stale host forward or change Production settings to repair Development.

**Why:** API startup rejects a stale server origin, while the client can still load a sign-in page with a stale callback URL and fail later in the login flow.

**How to apply:** Before restarting protected Development previews, verify the server and Vite Development Auth origins agree with the current `REPLIT_DEV_DOMAIN`; update Development-only settings, then restart the affected services.

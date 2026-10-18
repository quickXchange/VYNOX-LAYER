# Hosting decision: retain the current hosts

Keep the Render API and existing shared frontend host. No DNS, domains, hosting
migration, financial activation, or Production deployment is part of this work.

Tenant Release is database data, not a deployment. All websites use one master.
The SPA reads one complete `/api/public/site-config?slug=...` response on startup,
every 15 seconds, on focus and reconnect; HTTP revalidation uses `no-cache` and a
checksum ETag. Widget presentation is taken from that same response, not a second
independent mutable configuration fetch. Published image URLs are immutable hashes.

## One master-code release

The existing approved external release workflow builds the API and both frontends
from the checked-out commit and waits for the exact Render source revision. The
existing frontend build emits that revision too. It does not export tenant JSON.
The shared snapshot version is validated by both API and frontend; unknown future
versions fail explicitly. Existing snapshots have a named v0→v1 mapper.

The additive `0008_tenant_site_releases.sql` migration belongs to this master-code
release, not to each tenant Release. It creates no tenant snapshots and never
publishes existing drafts. The readback supplement records only the newly added
schema and security metadata, retaining the original verified baseline.

`TODO(owner)`: approve the normal protected master release and schema migration
before using this feature outside Development. Review each existing tenant draft
and create its first release deliberately. Do not silently bootstrap existing data.
Production authentication, original Owner credentials/MFA, commercial acceptance,
DNS, financial operations and existing customer data remain unchanged.

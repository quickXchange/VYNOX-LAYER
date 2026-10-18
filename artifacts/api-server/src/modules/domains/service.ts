import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { withDatabase } from "@workspace/db";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { assertOperational, resolveEntitlements } from "../entitlements/resolver";
import { getPublicSite } from "../website/service";
import { hostingObservation } from "./hosting";
import {
  activationApprovalObservation, approvalMatches, approvedDeploymentId, bindingMatches,
  customDomainActivationEnabled, providerBindingObservation,
} from "./approval";
import { customerHostname } from "./hostname";
import { hostingProvider, providerManagementAvailable, providerObservation } from "./provider";

export function newDomainChallenge() { return `wl-core-${randomBytes(24).toString("hex")}`; }
export function listCustomerDomains(p: Principal) {
  requireSuperAdmin(p);
  return withDatabase(contextFor(p), async c => (await c.query(`SELECT t.id AS "tenantId",t.name,t.slug,
    t.status AS "tenantStatus",d.domain,COALESCE(d.status,'unconfigured') AS status,
    COALESCE(w.status,'not_linked') AS "deliveryStatus",w.id AS "requestId"
    FROM tenants t LEFT JOIN tenant_domains d ON d.tenant_id=t.id
    LEFT JOIN LATERAL (SELECT id,status FROM white_label_requests WHERE tenant_id=t.id ORDER BY created_at DESC LIMIT 1) w ON true
    ORDER BY t.updated_at DESC,t.id`)).rows);
}
export function getDomainVerification(principal: Principal, tenantId: string) {
  return withDatabase(contextFor(principal, tenantId), async (client) => {
    const r = await client.query(`SELECT d.domain,d.status,d.verification_token,
      (t.status='active'
        AND EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status='delivered')
        AND NOT EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status<>'delivered')) AS publicly_delivered
      FROM tenant_domains d JOIN tenants t ON t.id=d.tenant_id WHERE d.tenant_id=$1`, [tenantId]);
    const row = r.rows[0];
    const provider = row ? (await providerObservation(client, tenantId, row.verification_token)).rows[0] : null;
    const approval = row ? (await activationApprovalObservation(client, tenantId, row.verification_token)).rows[0] : null;
    const binding = row ? (await providerBindingObservation(client, tenantId, row.verification_token)).rows[0] : null;
    const checked = row?.status === "verified" ? (await hostingObservation(client, tenantId, row.verification_token)).rows[0] : null;
    const deploymentId = approvedDeploymentId();
    const activationApproved = !!row && approvalMatches(approval, row.domain, deploymentId);
    const providerBindingVerified = !!row && bindingMatches(binding, row.domain, deploymentId, approval);
    const connected = !!row?.publicly_delivered && row.status === "verified" && activationApproved &&
      providerBindingVerified && checked?.metadata.domain === row.domain && checked?.metadata.connected === true &&
      Date.now() - new Date(checked.created_at).getTime() < 24 * 60 * 60 * 1000;
    return { domain: row?.domain ?? null, status: row?.status ?? "unconfigured", txtName: row ? `_white-label.${row.domain}` : null,
      txtValue: row?.verification_token ?? null, hostingConnected: connected, httpsReady: connected,
      hostingCheckedAt: checked?.created_at ?? null, hostingError: checked?.metadata.error ?? null,
      websiteUrl: connected ? `https://${row.domain}` : null,
      hostingProvider: hostingProvider(), providerManagementAvailable: providerManagementAvailable(),
      activationAvailable: providerManagementAvailable() && !!deploymentId && customDomainActivationEnabled(),
      activationApproved, approvedDeploymentId: deploymentId,
      activationApprovedAt: activationApproved ? approval.created_at : null,
      siteReleased: row?.publicly_delivered === true, providerBindingVerified,
      providerBindingCheckedAt: providerBindingVerified ? binding.created_at : null,
      providerRegistered: provider?.metadata.registered === true, providerVerified: provider?.metadata.verified === true,
      providerCheckedAt: provider?.created_at ?? null, providerError: provider?.metadata.error ?? null,
      dnsRecords: [
        ...(row ? [{ type: "TXT", name: `_white-label.${row.domain}`, value: row.verification_token, purpose: "Tenant ownership verification" }] : []),
        ...(provider?.metadata.records ?? []),
      ],
      instructions: [
        "Add the exact ownership TXT record shown below at the customer's DNS provider. Then use Check DNS record; VYNOX LAYER never edits customer DNS.",
        row?.publicly_delivered
          ? "The tenant site has an active delivered release."
          : "The hostname stays preview-only until the tenant is active and its approved website release is delivered.",
        deploymentId
          ? `Approved deployment target configured: ${deploymentId}. A Super Admin must approve this exact hostname and target before registration.`
          : "Custom-host activation is unavailable until an exact approved Production deployment is configured server-side.",
        "After approval, the operator registers the hostname with the protected Vercel project. Registration does not bind a deployment; the operator binds the approved release separately.",
        "Apply only the exact A, CNAME and provider-verification TXT records returned below. Never guess an IP address or remove existing mail or DNS records.",
        "Keep the provider verification TXT record for certificate renewal. Apex and www/subdomains are separate hostnames and require separate tenant assignments and approval.",
        "The hostname remains unavailable publicly until ownership, delivered release, approved deployment binding, signed tenant routing and valid HTTPS all pass.",
      ] };
  });
}
export async function verifyTenantDomain(principal: Principal, tenantId: string, lookup = resolveTxt) {
  contextFor(principal, tenantId, true, "domains.manage");
  const challenge = await getDomainVerification(principal, tenantId);
  if (!challenge.domain || !challenge.txtName || !challenge.txtValue) throw new HttpError(400, "Configure a domain first.");
  let records: string[][];
  try { records = await lookup(challenge.txtName); }
  catch { throw new HttpError(400, "DNS TXT challenge is not available yet."); }
  if (!records.some((r) => r.join("") === challenge.txtValue)) throw new HttpError(400, "DNS ownership challenge does not match.");
  await withDatabase(contextFor(principal, tenantId, true, "domains.manage"), async (client) => {
    assertOperational(await resolveEntitlements(client, tenantId));
    const r = await client.query("UPDATE tenant_domains SET status='verified',verified_at=now() WHERE tenant_id=$1 AND domain=$2 AND verification_token=$3 RETURNING domain", [tenantId, challenge.domain, challenge.txtValue]);
    if (!r.rowCount) throw new HttpError(409, "Domain changed during verification. Retry its new challenge.");
    await audit(client, principal, tenantId, "domain.ownership_verified", "Verified DNS ownership; hosting not connected", { domain: challenge.domain });
  });
  return getDomainVerification(principal, tenantId);
}
export async function resolvePublicDomain(hostname: string) {
  if (!/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/.test(hostname) || hostname.length > 253) throw new HttpError(404, "Website not available.");
  let domain: string;
  try { domain = customerHostname(hostname); } catch { throw new HttpError(404, "Website not available."); }
  const slug = await withDatabase({ actorId: "public-domain", publicDomain: domain }, async (client) => {
    const r = await client.query(`SELECT t.id AS tenant_id,t.slug,d.domain,d.verification_token
      FROM tenants t JOIN tenant_domains d ON d.tenant_id=t.id
      WHERE d.domain=$1 AND d.status='verified' AND t.status='active'
      AND EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status='delivered')
      AND NOT EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status<>'delivered')`, [domain]);
    const row = r.rows[0];
    if (!row) return undefined;
    const deploymentId = approvedDeploymentId();
    const approval = (await activationApprovalObservation(client, row.tenant_id, row.verification_token)).rows[0];
    if (!approvalMatches(approval, row.domain, deploymentId)) return undefined;
    const binding = (await providerBindingObservation(client, row.tenant_id, row.verification_token)).rows[0];
    if (!bindingMatches(binding, row.domain, deploymentId, approval)) return undefined;
    const checked = (await hostingObservation(client, row.tenant_id, row.verification_token)).rows[0];
    if (checked?.metadata.domain !== row.domain || checked?.metadata.connected !== true ||
      Date.now() - new Date(checked.created_at).getTime() >= 24 * 60 * 60 * 1000) return undefined;
    return row.slug as string;
  });
  if (!slug) throw new HttpError(404, "Website not available.");
  return getPublicSite(slug);
}
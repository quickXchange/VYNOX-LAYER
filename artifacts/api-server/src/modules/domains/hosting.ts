import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { withDatabase } from "@workspace/db";
import { contextFor, type Principal } from "../authentication/service";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import {
  activationApprovalObservation, approvalMatches, approvedDeploymentId, bindingMatches,
  providerBindingObservation, challengeHash,
} from "./approval";
import { fetchHostingProof } from "./https-probe";
import { providerManagementAvailable, verifyApprovedDeploymentAlias } from "./provider";

export { challengeHash } from "./approval";

export function hostingProof(domain: string, slug: string, nonce: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new HttpError(503, "Domain routing verification is not configured.");
  return createHmac("sha256", secret).update(JSON.stringify(["qxlayer-domain-hosting", domain, slug, nonce])).digest("hex");
}
export async function publicHostingProof(domain: string, nonce: string) {
  if (!/^[a-f0-9]{48}$/.test(nonce)) throw new HttpError(400, "Invalid hosting challenge.");
  const site = await withDatabase({ actorId: "public-domain-proof", publicDomain: domain }, async client => {
    const r = await client.query(`SELECT t.id AS tenant_id,t.slug,d.domain,d.verification_token
      FROM tenants t JOIN tenant_domains d ON d.tenant_id=t.id
      WHERE d.domain=$1 AND d.status='verified' AND t.status='active'
      AND EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status='delivered')
      AND NOT EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status<>'delivered')`, [domain]);
    const row = r.rows[0];
    if (!row) return null;
    const deploymentId = approvedDeploymentId();
    const approval = (await activationApprovalObservation(client, row.tenant_id, row.verification_token)).rows[0];
    if (!approvalMatches(approval, row.domain, deploymentId)) return null;
    const binding = (await providerBindingObservation(client, row.tenant_id, row.verification_token)).rows[0];
    if (!bindingMatches(binding, row.domain, deploymentId, approval)) return null;
    return row as { tenant_id: string; slug: string; domain: string; verification_token: string };
  });
  if (!site) throw new HttpError(404, "Website not available.");
  return { proof: hostingProof(domain, site.slug, nonce) };
}
export function hostingObservation(c: import("@workspace/db").DatabaseClient, tenantId: string, token: string) {
  return c.query(`SELECT metadata,created_at FROM audit_events WHERE tenant_id=$1
    AND event_type='domain.hosting_checked' AND metadata->>'challengeHash'=$2
    ORDER BY created_at DESC,id DESC LIMIT 1`, [tenantId, challengeHash(token)]);
}
export async function checkHosting(
  p: Principal, tenantId: string, probe = fetchHostingProof,
  bindingProbe = verifyApprovedDeploymentAlias,
) {
  contextFor(p, tenantId, true, "domains.manage");
  const row = await withDatabase(contextFor(p, tenantId), async c => {
    const r = await c.query(`SELECT d.*,t.slug,
      (t.status='active'
        AND EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status='delivered')
        AND NOT EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status<>'delivered')) AS site_released
      FROM tenant_domains d JOIN tenants t ON t.id=d.tenant_id WHERE d.tenant_id=$1`, [tenantId]);
    return r.rows[0];
  });
  if (!row || row.status !== "verified") throw new HttpError(409, "Verify domain ownership before checking hosting.");
  if (!row.site_released) throw new HttpError(409, "Deliver the approved tenant website release before activating its hostname.");
  const deploymentId = approvedDeploymentId();
  const approval = (await withDatabase(contextFor(p, tenantId), c => activationApprovalObservation(c, tenantId, row.verification_token))).rows[0];
  if (!approvalMatches(approval, row.domain, deploymentId)) throw new HttpError(409, "A Super Admin must approve this exact hostname and configured deployment first.");
  const binding = (await withDatabase(contextFor(p, tenantId), c => providerBindingObservation(c, tenantId, row.verification_token))).rows[0];
  if (!bindingMatches(binding, row.domain, deploymentId, approval)) throw new HttpError(409, "Bind the approved Production deployment to this hostname before checking HTTPS.");
  if (!providerManagementAvailable()) throw new HttpError(503, "Hosting provider readback is unavailable; Super Admin must restore the protected Vercel project configuration.");
  if (!await bindingProbe(row.domain, deploymentId!))
    throw new HttpError(409, "The hosting provider no longer shows this hostname on the approved deployment. Refresh provider state and bind it again before checking HTTPS.");
  const nonce = randomBytes(24).toString("hex");
  let connected = false;
  let error: string | null = null;
  try {
    const proof = await probe(row.domain, nonce);
    const expected = hostingProof(row.domain, row.slug, nonce);
    connected = /^[a-f0-9]{64}$/.test(proof) && timingSafeEqual(Buffer.from(proof, "hex"), Buffer.from(expected, "hex"));
    if (!connected) error = "HTTPS reached a different website. Check that this exact hostname routes to the approved VYNOX LAYER deployment.";
  } catch {
    error = "HTTPS or tenant routing is not ready. Register the hostname with the hosting provider, bind the approved deployment, apply its exact DNS records and wait for TLS issuance, then retry.";
  }
  await withDatabase(contextFor(p, tenantId, true, "domains.manage"), async c => {
    const current = await c.query("SELECT domain,verification_token FROM tenant_domains WHERE tenant_id=$1 FOR UPDATE", [tenantId]);
    if (current.rows[0]?.domain !== row.domain || current.rows[0]?.verification_token !== row.verification_token) {
      throw new HttpError(409, "Domain changed during the hosting check. Retry its new challenge.");
    }
    await audit(c, p, tenantId, "domain.hosting_checked", connected ? "HTTPS and tenant routing verified" : "Hosting check requires action", {
      domain: row.domain, challengeHash: challengeHash(row.verification_token), connected, error,
    });
  });
}

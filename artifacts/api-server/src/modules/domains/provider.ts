import { withDatabase } from "@workspace/db";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import {
  activationApprovalObservation, approvalMatches, approvedDeploymentId, challengeHash,
  customDomainActivationEnabled,
} from "./approval";
import { getDomainVerification } from "./service";

// Customer DNS is never edited here. Provider writes are limited to an exact
// hostname and a READY Production deployment approved by a Super Admin.
export const hostingProvider = () => process.env.QXLAYER_HOSTING_PROVIDER === "vercel" ||
  !!process.env.QXLAYER_EXTERNAL_ENVIRONMENT ? "vercel" as const : "replit" as const;
export const providerManagementAvailable = () => hostingProvider() === "vercel" && !!process.env.VERCEL_DOMAIN_TOKEN &&
  /^prj_[A-Za-z0-9]+$/.test(process.env.VERCEL_DOMAIN_PROJECT_ID ?? "") &&
  /^team_[A-Za-z0-9]+$/.test(process.env.VERCEL_DOMAIN_TEAM_ID ?? "");
export function providerObservation(c: import("@workspace/db").DatabaseClient, tenantId: string, token: string) {
  return c.query(`SELECT metadata,created_at FROM audit_events WHERE tenant_id=$1 AND event_type='domain.provider_checked'
    AND metadata->>'challengeHash'=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [tenantId, challengeHash(token)]);
}

type VercelResponse = {
  name?: string;
  verified?: boolean;
  misconfigured?: boolean;
  projectId?: string;
  readyState?: string;
  target?: string;
  alias?: string;
  aliases?: { alias: string }[];
  verification?: { type: string; domain: string; value: string }[];
  recommendedCNAME?: { value: string }[];
  recommendedIPv4?: { value: string | string[] }[];
};
type DnsRecord = { type: string; name: string; value: string; purpose: string };

async function vercelRequest(path: string, method = "GET", body?: unknown): Promise<VercelResponse> {
  const team = process.env.VERCEL_DOMAIN_TEAM_ID!;
  const response = await fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.VERCEL_DOMAIN_TOKEN}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const aliasNotReady = method === "POST" && path.includes("/aliases") && (response.status === 400 || response.status === 409);
    const message = aliasNotReady
      ? "The provider cannot bind this hostname yet. Check its exact DNS records, wait for TLS certificate issuance, and retry."
      : response.status === 404
      ? "This hostname or deployment is not available in the configured hosting project."
      : response.status === 401 || response.status === 403
        ? "Hosting management authorization was rejected. Super Admin must check the server token and project scope."
        : "Hosting provider request failed. Check project ownership, hostname availability and deployment state.";
    throw new HttpError(aliasNotReady || response.status === 404 ? 409 : 502, message);
  }
  return await response.json() as VercelResponse;
}

function recordsFor(domain: string, provider: VercelResponse, config: VercelResponse): DnsRecord[] {
  const records: DnsRecord[] = (provider.verification ?? [])
    .filter(v => v.type === "TXT" && typeof v.domain === "string" && typeof v.value === "string")
    .map(v => ({ type: "TXT", name: v.domain, value: v.value, purpose: "Vercel ownership verification" }));
  for (const item of config.recommendedCNAME ?? [])
    if (typeof item.value === "string") records.push({ type: "CNAME", name: domain, value: item.value, purpose: "Hosting routing (provider recommendation)" });
  for (const item of config.recommendedIPv4 ?? [])
    for (const value of Array.isArray(item.value) ? item.value : [item.value])
      if (typeof value === "string") records.push({ type: "A", name: domain, value, purpose: "Hosting routing (provider recommendation)" });
  return records;
}

async function assertApprovedProductionDeployment(deploymentId: string, project: string) {
  const deployment = await vercelRequest(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
  if (deployment.projectId !== project || deployment.readyState !== "READY" || deployment.target !== "production") {
    throw new HttpError(409, "The configured deployment is not a READY Production deployment in the protected Vercel project. No binding was made.");
  }
}

export async function verifyApprovedDeploymentAlias(domain: string, deploymentId: string) {
  const project = process.env.VERCEL_DOMAIN_PROJECT_ID!;
  await assertApprovedProductionDeployment(deploymentId, project);
  const result = await vercelRequest(`/v2/deployments/${encodeURIComponent(deploymentId)}/aliases`);
  return Array.isArray(result.aliases) && result.aliases.some(alias => alias.alias === domain);
}

async function recordProviderCheck(
  p: Principal, tenantId: string, expectedDomain: string, token: string,
  provider: VercelResponse, config: VercelResponse, records: DnsRecord[],
) {
  await withDatabase(contextFor(p, tenantId, true, "domains.manage"), async c => {
    const r = await c.query(`SELECT d.domain,d.verification_token FROM tenant_domains d
      JOIN tenants t ON t.id=d.tenant_id WHERE d.tenant_id=$1 FOR UPDATE OF d,t`, [tenantId]);
    if (r.rows[0]?.domain !== expectedDomain || r.rows[0]?.verification_token !== token)
      throw new HttpError(409, "Domain changed while checking hosting. Refresh and retry; no tenant readiness was changed.");
    await audit(c, p, tenantId, "domain.provider_checked", "Read hosting registration and DNS recommendations; no DNS changed", {
      challengeHash: challengeHash(token), domain: expectedDomain, registered: true,
      verified: provider.verified === true, records,
      error: config.misconfigured ? "Hosting DNS is not correctly configured yet." : null,
    });
  });
}

export async function manageDomainProvider(
  p: Principal, tenantId: string, action: "approve" | "register" | "refresh" | "bind",
) {
  const ctx = contextFor(p, tenantId, true, "domains.manage");
  if (action !== "refresh") requireSuperAdmin(p);
  if (!providerManagementAvailable())
    throw new HttpError(503, "Hosting management is not configured. Super Admin must configure the protected project's server-only Vercel domain token.");

  const domain = await getDomainVerification(p, tenantId);
  if (!domain.domain || domain.status !== "verified")
    throw new HttpError(409, "Verify this tenant's exact domain TXT ownership before contacting the hosting provider.");

  const deploymentId = approvedDeploymentId();
  const project = process.env.VERCEL_DOMAIN_PROJECT_ID!;

  if (action === "refresh") {
    const current = await vercelRequest(`/v9/projects/${project}/domains/${encodeURIComponent(domain.domain)}`);
    if (current.name !== domain.domain)
      throw new HttpError(502, "Hosting provider returned a different hostname. No tenant readiness was changed.");
    const config = await vercelRequest(`/v6/domains/${encodeURIComponent(domain.domain)}/config?projectId=${encodeURIComponent(project)}`);
    const records = recordsFor(domain.domain, current, config);
    await recordProviderCheck(p, tenantId, domain.domain, domain.txtValue!, current, config, records);
    if (deploymentId && domain.activationApproved) {
      let bound = false;
      let error: string | null = null;
      try { bound = await verifyApprovedDeploymentAlias(domain.domain, deploymentId); }
      catch (e) { error = (e as Error).message; }
      await withDatabase(ctx, async c => {
        const r = await c.query("SELECT domain,verification_token FROM tenant_domains WHERE tenant_id=$1 FOR UPDATE", [tenantId]);
        if (r.rows[0]?.domain !== domain.domain || r.rows[0]?.verification_token !== domain.txtValue)
          throw new HttpError(409, "Domain changed while checking its deployment binding. Refresh before continuing.");
        await audit(c, p, tenantId, "domain.provider_binding_checked", "Read back the approved deployment's hostname binding", {
          challengeHash: challengeHash(domain.txtValue!), domain: domain.domain, deploymentId, alias: domain.domain, bound, error,
        });
      });
    }
    return getDomainVerification(p, tenantId);
  }

  if (!domain.siteReleased)
    throw new HttpError(409, "Deliver the approved tenant website release before activating its hostname.");
  if (!deploymentId) throw new HttpError(503, "Super Admin must configure the exact approved Vercel Production deployment before hostname activation.");
  if (!customDomainActivationEnabled())
    throw new HttpError(409, "Custom-domain activation is held by the platform-wide approval switch. No provider or DNS change was made.");

  if (action === "approve") {
    await assertApprovedProductionDeployment(deploymentId, project);
    await withDatabase(ctx, async c => {
      const r = await c.query(`SELECT d.domain,d.status,d.verification_token,t.status AS tenant_status,
        (EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status='delivered')
         AND NOT EXISTS(SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status<>'delivered')) AS released
        FROM tenant_domains d JOIN tenants t ON t.id=d.tenant_id
        WHERE d.tenant_id=$1 FOR UPDATE OF d,t`, [tenantId]);
      const row = r.rows[0];
      if (row?.domain !== domain.domain || row?.verification_token !== domain.txtValue ||
        row?.status !== "verified" || row?.tenant_status !== "active" || row?.released !== true)
        throw new HttpError(409, "The approved hostname, ownership or delivered release changed. Refresh the domain before approving it.");
      await audit(c, p, tenantId, "domain.activation_approved",
        "Super Admin approved the exact owned hostname and protected Production deployment", {
          challengeHash: challengeHash(domain.txtValue!), domain: domain.domain, deploymentId,
        });
    });
    return getDomainVerification(p, tenantId);
  }

  const approval = await withDatabase(ctx, c => activationApprovalObservation(c, tenantId, domain.txtValue!))
    .then(r => r.rows[0]);
  if (!approvalMatches(approval, domain.domain, deploymentId))
    throw new HttpError(409, "A Super Admin must approve this exact hostname and configured Production deployment first.");

  if (action === "register") {
    // Registering adds the exact hostname to the protected project only. It
    // deliberately does not create an alias to any deployment.
    const current = await vercelRequest(`/v10/projects/${project}/domains`, "POST", { name: domain.domain });
    if (current.name !== domain.domain)
      throw new HttpError(502, "Hosting provider returned a different hostname. No tenant readiness was changed.");
    const config = await vercelRequest(`/v6/domains/${encodeURIComponent(domain.domain)}/config?projectId=${encodeURIComponent(project)}`);
    const records = recordsFor(domain.domain, current, config);
    await recordProviderCheck(p, tenantId, domain.domain, domain.txtValue!, current, config, records);
    return getDomainVerification(p, tenantId);
  }

  const current = await vercelRequest(`/v9/projects/${project}/domains/${encodeURIComponent(domain.domain)}`);
  if (current.name !== domain.domain || current.verified !== true)
    throw new HttpError(409, "The provider has not verified this exact hostname yet. Apply its exact DNS records and refresh provider state before binding.");
  const config = await vercelRequest(`/v6/domains/${encodeURIComponent(domain.domain)}/config?projectId=${encodeURIComponent(project)}`);
  if (config.misconfigured === true)
    throw new HttpError(409, "The provider reports that hostname DNS is misconfigured. Apply only the exact recommended records, then retry binding.");
  await assertApprovedProductionDeployment(deploymentId, project);
  const aliasPath = `/v2/deployments/${encodeURIComponent(deploymentId)}/aliases`;
  let alias = (await vercelRequest(aliasPath)).aliases?.some(item => item.alias === domain.domain)
    ? { alias: domain.domain }
    : await vercelRequest(aliasPath, "POST", { alias: domain.domain });
  if (alias.alias !== domain.domain)
    throw new HttpError(502, "Hosting provider did not confirm the exact approved hostname binding.");
  const readback = await vercelRequest(aliasPath);
  if (!Array.isArray(readback.aliases) || !readback.aliases.some(item => item.alias === domain.domain))
    throw new HttpError(502, "The approved hostname alias was not present in deployment readback. HTTPS remains unavailable.");
  const records = recordsFor(domain.domain, current, config);
  await recordProviderCheck(p, tenantId, domain.domain, domain.txtValue!, current, config, records);
  await withDatabase(ctx, async c => {
    const r = await c.query(`SELECT domain,verification_token FROM tenant_domains WHERE tenant_id=$1 FOR UPDATE`, [tenantId]);
    if (r.rows[0]?.domain !== domain.domain || r.rows[0]?.verification_token !== domain.txtValue)
      throw new HttpError(409, "Domain changed while binding the deployment. Refresh before continuing.");
    await audit(c, p, tenantId, "domain.provider_bound", "Bound the approved Production deployment to the exact tenant hostname", {
      challengeHash: challengeHash(domain.txtValue!), domain: domain.domain, deploymentId, alias: alias.alias, bound: true,
    });
  });
  return getDomainVerification(p, tenantId);
}

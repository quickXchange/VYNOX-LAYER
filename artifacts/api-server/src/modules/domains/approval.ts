import { createHash } from "node:crypto";
import type { DatabaseClient } from "@workspace/db";

export const challengeHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function approvedDeploymentId() {
  const value = process.env.VERCEL_DOMAIN_APPROVED_DEPLOYMENT_ID;
  return value && /^dpl_[A-Za-z0-9]+$/.test(value) ? value : null;
}

export const customDomainActivationEnabled = () =>
  process.env.QXLAYER_CUSTOM_DOMAIN_ACTIVATION_APPROVED === "true";

export function activationApprovalObservation(
  client: DatabaseClient, tenantId: string, token: string,
) {
  return client.query(`SELECT metadata,created_at FROM audit_events
    WHERE tenant_id=$1 AND event_type='domain.activation_approved'
      AND metadata->>'challengeHash'=$2
    ORDER BY created_at DESC,id DESC LIMIT 1`, [tenantId, challengeHash(token)]);
}

export function providerBindingObservation(
  client: DatabaseClient, tenantId: string, token: string,
) {
  return client.query(`SELECT metadata,created_at FROM audit_events
    WHERE tenant_id=$1 AND event_type IN ('domain.provider_bound','domain.provider_binding_checked')
      AND metadata->>'challengeHash'=$2
    ORDER BY created_at DESC,id DESC LIMIT 1`, [tenantId, challengeHash(token)]);
}

export function approvalMatches(
  observation: { metadata: Record<string, unknown> } | null | undefined,
  domain: string, deploymentId: string | null,
) {
  return !!deploymentId && customDomainActivationEnabled() &&
    observation?.metadata.domain === domain &&
    observation.metadata.deploymentId === deploymentId;
}

export function bindingMatches(
  observation: { metadata: Record<string, unknown>; created_at: Date | string } | null | undefined,
  domain: string, deploymentId: string | null,
  approval: { metadata: Record<string, unknown>; created_at: Date | string } | null | undefined,
) {
  return !!deploymentId && !!observation && !!approval &&
    observation.metadata.domain === domain &&
    observation.metadata.deploymentId === deploymentId &&
    observation.metadata.bound === true &&
    new Date(observation.created_at).getTime() >= new Date(approval.created_at).getTime();
}

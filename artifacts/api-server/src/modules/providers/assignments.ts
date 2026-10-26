import { withDatabase } from "@workspace/db";
import { CreateProviderAssignmentBody, UpdateProviderAssignmentBody } from "@workspace/api-zod";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { enforceLimit, lockTenant, requireFeature, resolveEntitlements } from "../entitlements/resolver";
import { audit } from "../../lib/audit";
import { HttpError } from "../../lib/errors";
import { rejectSecrets, validateConfiguration } from "./security";
import { capabilityAllowed } from "./validation";
import { assignmentView, readProvider } from "./read";

export function createProviderAssignment(principal: Principal, tenantId: string, input: unknown) {
  requireSuperAdmin(principal);
  rejectSecrets(input);
  const body = CreateProviderAssignmentBody.parse(input);
  return withDatabase(contextFor(principal, tenantId, true), async client => {
    await lockTenant(client, tenantId);
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('provider-catalog',0))");
    const effective = await resolveEntitlements(client, tenantId);
    requireFeature(effective, "crypto_exchange");
    const provider = await readProvider(client, body.providerId);
    if (!capabilityAllowed(provider, body.capability, body.environment, effective.features)) throw new HttpError(403, "Provider capability/environment or entitlement is unavailable.");
    // Plan provider limit counts distinct convert providers; eligibility is enforced by capabilityAllowed.
    if (body.capability === "convert" && "max_convert_providers" in effective.limits) {
      const used = (await client.query("SELECT count(DISTINCT provider_id)::int AS n FROM provider_assignments WHERE tenant_id=$1 AND capability='convert' AND provider_id<>$2", [tenantId, body.providerId])).rows[0].n as number;
      enforceLimit(effective, "max_convert_providers", String(used + 1));
    }
    const result = await client.query(`INSERT INTO provider_assignments(tenant_id,provider_id,capability,environment)
      VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,provider_id,capability,environment) DO NOTHING RETURNING *`,
    [tenantId, body.providerId, body.capability, body.environment]);
    if (!result.rowCount) throw new HttpError(409, "That provider capability/environment is already assigned.");
    await audit(client, principal, tenantId, "provider.assignment.created", `Provider capability assigned (${body.providerId}); not connected`, { providerId: body.providerId, capability: body.capability, environment: body.environment });
    return assignmentView(result.rows[0]);
  });
}
export function updateProviderAssignment(principal: Principal, tenantId: string, assignmentId: string, input: unknown) {
  rejectSecrets(input);
  const { configuration } = UpdateProviderAssignmentBody.parse(input);
  return withDatabase(contextFor(principal, tenantId, true), async client => {
    await lockTenant(client, tenantId);
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('provider-catalog',0))");
    const effective = await resolveEntitlements(client, tenantId);
    requireFeature(effective, "crypto_exchange");
    const result = await client.query("SELECT * FROM provider_assignments WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [assignmentId, tenantId]);
    if (!result.rowCount) throw new HttpError(404, "Tenant provider assignment not found.");
    const record = result.rows[0], provider = await readProvider(client, record.provider_id);
    if (principal.role !== "super_admin" && !provider.tenantConfigurable) throw new HttpError(403, "This provider configuration is controlled by Super Admin.");
    if (!capabilityAllowed(provider, record.capability, record.environment, effective.features)) throw new HttpError(403, "Provider configuration is not allowed by current entitlements or availability.");
    validateConfiguration(provider.configurationSchema, configuration);
    await client.query("UPDATE provider_assignments SET configuration=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2", [assignmentId, tenantId, JSON.stringify(configuration)]);
    await audit(client, principal, tenantId, "provider.configuration.saved", `Non-secret provider configuration saved (${record.provider_id}); no connection tested`, {
      providerId: record.provider_id, assignmentId, fieldCount: Object.keys(configuration).length,
    });
    const updated = await client.query("SELECT * FROM provider_assignments WHERE id=$1 AND tenant_id=$2", [assignmentId, tenantId]);
    return assignmentView(updated.rows[0]);
  });
}
export function removeProviderAssignment(principal: Principal, tenantId: string, assignmentId: string) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal, tenantId, true), async client => {
    await lockTenant(client, tenantId);
    const result = await client.query("SELECT * FROM provider_assignments WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [assignmentId, tenantId]);
    if (!result.rowCount) throw new HttpError(404, "Tenant provider assignment not found.");
    const record = result.rows[0];
    const used = await client.query(`SELECT id FROM provider_policies WHERE tenant_id=$1 AND capability=$2
      AND definition->>'environment'=$3 AND (definition->>'providerId'=$4 OR definition->>'secondaryProviderId'=$4)`,
    [tenantId, record.capability, record.environment, record.provider_id]);
    if (used.rowCount) throw new HttpError(409, "Remove future policies referencing this assignment before unassigning it.");
    await client.query("DELETE FROM provider_assignments WHERE id=$1 AND tenant_id=$2", [assignmentId, tenantId]);
    await audit(client, principal, tenantId, "provider.assignment.removed", `Provider assignment removed (${record.provider_id})`, { assignmentId, providerId: record.provider_id });
  });
}

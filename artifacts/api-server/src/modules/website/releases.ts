import { withDatabase, type DatabaseClient } from "@workspace/db";
import { migrateSiteSnapshot } from "@workspace/api-zod";
import { contextFor, type Principal } from "../authentication/service";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import { changedFields, configChecksum, draftConfig, releaseChecklist } from "./release-config";
import { publishAssets } from "./release-assets";
import { testProvider } from "../integrations/adapters";
import { open } from "../integrations/vault";

function releaseContext(p: Principal, tenantId: string, write = false) {
  const ctx = contextFor(p, tenantId, write);
  if (write && (p.demo || p.role !== "super_admin" && p.memberships.find(m => m.tenantId === tenantId)?.role !== "client_admin"))
    throw new HttpError(403, "Only this tenant's administrator or the platform operator can release or roll back.");
  return ctx;
}
function metadata(row: Record<string, any>, previous?: Record<string, any>) {
  return { id: row.id as string, version: Number(row.version), checksum: row.checksum as string,
    createdBy: row.created_by as string, createdAt: new Date(row.created_at).toISOString(),
    diff: changedFields(previous?.config ?? null, row.config) };
}
export async function tenantReleaseState(p: Principal, tenantId: string) {
  return withDatabase(releaseContext(p, tenantId), async c => {
    const draft = await draftConfig(c, tenantId);
    const rows = await c.query("SELECT * FROM tenant_releases WHERE tenant_id=$1 ORDER BY version DESC", [tenantId]);
    const pointer = await c.query("SELECT live_release_id FROM tenants WHERE id=$1", [tenantId]);
    const live = rows.rows.find(r => r.id === pointer.rows[0]?.live_release_id);
    const draftHash = configChecksum(draft);
    return { liveReleaseId: live?.id ?? null, liveChecksum: live?.checksum ?? null,
      draftChecksum: live?.draft_checksum === draftHash ? live.checksum : draftHash,
      checklist: await releaseChecklist(c, tenantId, draft),
      history: rows.rows.map((row, i) => metadata(row, rows.rows[i + 1])) };
  });
}
export async function releaseInTransaction(c: DatabaseClient, p: Principal, tenantId: string) {
  // The caller owns one REPEATABLE READ transaction. Snapshot every presentation
  // field at one DB revision, not a sequence of independent read transactions.
  const tenant = await c.query("SELECT id,live_release_id,status FROM tenants WHERE id=$1 FOR UPDATE", [tenantId]);
  if (!tenant.rowCount || tenant.rows[0].status === "suspended") throw new HttpError(409, "A suspended or missing tenant cannot be released.");
  const draft = await draftConfig(c, tenantId);
  const failures = (await releaseChecklist(c, tenantId, draft)).filter(item => !item.ready);
  if (failures.length) throw new HttpError(409, `Ready to release: ${failures.map(f => `${f.label}: ${f.message}`).join(" ")}`);
  const providers = await c.query("SELECT * FROM tenant_integrations WHERE tenant_id=$1 AND enabled=true FOR UPDATE", [tenantId]);
  for (const provider of providers.rows) {
    if (provider.provider_key === "telegram_mini_app") continue; // Verified linked Bot is checked independently.
    if (!provider.encrypted_credentials) throw new HttpError(409, "An enabled provider is missing its required credentials.");
    try {
      const nonce = Math.max(Number(provider.last_nonce ?? 0) + 1, Date.now() * 1000);
      const secrets = open({ tenantId, providerKey: provider.provider_key, environment: "sandbox" }, provider.encrypted_credentials);
      const health = await testProvider(provider.provider_key, provider.settings, secrets, nonce);
      if (!["connected", "ready"].includes(String(health.state))) throw new Error("Unverified provider");
      await c.query("UPDATE tenant_integrations SET last_nonce=$3,health=$4 WHERE tenant_id=$1 AND id=$2", [tenantId, provider.id, nonce,
        { ...health, checkedAt: new Date().toISOString() }]);
    } catch { throw new HttpError(409, "An enabled provider failed its read-only connection test. Review its credentials in Integrations; nothing was released."); }
  }
  const config = await publishAssets(c, tenantId, draft), checksum = configChecksum(config);
  const history = await c.query("SELECT * FROM tenant_releases WHERE tenant_id=$1 ORDER BY version DESC LIMIT 1", [tenantId]);
  const old = history.rows[0];
  const r = await c.query(`INSERT INTO tenant_releases(tenant_id,version,config,checksum,draft_checksum,created_by)
    VALUES($1,$2,$3::jsonb,$4,$5,$6) RETURNING *`, [tenantId, (old?.version ?? 0) + 1, JSON.stringify(config), checksum, configChecksum(draft), p.userId]);
  await c.query("UPDATE tenants SET live_release_id=$2,updated_at=now() WHERE id=$1", [tenantId, r.rows[0].id]);
  await audit(c, p, tenantId, "website.released", "Published immutable website presentation; no deployment or financial activation",
    { releaseId: r.rows[0].id, version: r.rows[0].version, checksum, changedFields: changedFields(old?.config ?? null, config) });
  return metadata(r.rows[0], old);
}
export async function releaseTenant(p: Principal, tenantId: string) {
  try {
    return await withDatabase({ ...releaseContext(p, tenantId, true), repeatableRead: true }, c => releaseInTransaction(c, p, tenantId));
  } catch (error) {
    if ((error as { code?: string }).code === "40001") throw new HttpError(409, "The draft changed concurrently. Review the latest checklist and release again.");
    throw error;
  }
}
export async function rollbackTenant(p: Principal, tenantId: string, releaseId: string) {
  return withDatabase(releaseContext(p, tenantId, true), async c => {
    await c.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [tenantId]);
    const r = await c.query("SELECT * FROM tenant_releases WHERE tenant_id=$1 AND id=$2", [tenantId, releaseId]);
    if (!r.rowCount) throw new HttpError(404, "Release not found for this tenant.");
    if (configChecksum(r.rows[0].config) !== r.rows[0].checksum) throw new HttpError(409, "This historical release failed its checksum.");
    migrateSiteSnapshot(r.rows[0].config);
    await c.query("UPDATE tenants SET live_release_id=$2,updated_at=now() WHERE id=$1", [tenantId, releaseId]);
    await audit(c, p, tenantId, "website.rolled_back", "Changed website release pointer only; draft and orders unchanged", { releaseId });
    return metadata(r.rows[0]);
  });
}

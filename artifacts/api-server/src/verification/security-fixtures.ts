import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { resolvePrincipal } from "../modules/authentication/service";
import { getTenant } from "../modules/tenants/service";
import { prepareCustomerFixtures, cleanCustomerFixtures } from "./customer-fixtures";
import { setTenantAddons, setTenantOverrides } from "../modules/entitlements/subscriptions";
import { saveAddon, getPlan } from "../modules/entitlements/catalog";
import { createResource } from "../modules/entitlements/resources";
import { appendNote, submitRequest } from "../modules/customer/service";
import { uploadAttachment, deleteFixtureFiles } from "../modules/customer/order-files";
import { exchangeConfiguration, sandboxQuote, sandboxOrder } from "../products/exchange/service";

export type SecurityFixture = Awaited<ReturnType<typeof prepareSecurityFixtures>>;
export async function prepareSecurityFixtures(actors: string[]) {
  if (process.env.NODE_ENV === "production") throw new Error("Development security fixtures refused in production.");
  assert.equal(actors.length, 3);
  assert.equal(new Set(actors).size, 3);
  assert.ok(actors.every(a => /^user_[a-zA-Z0-9]+$/.test(a)));
  const existing = await pool.query(
    "SELECT clerk_user_id FROM platform_admins WHERE clerk_user_id=ANY($1::text[]) UNION SELECT clerk_user_id FROM tenant_memberships WHERE clerk_user_id=ANY($1::text[])", [actors],
  );
  assert.equal(existing.rowCount, 0, "Use newly generated test identities, never existing customer/operator assignments.");
  const suffix = randomUUID().slice(0, 8);
  await pool.query("INSERT INTO platform_admins(clerk_user_id) VALUES($1)", [actors[2]]);
  const op = await resolvePrincipal(actors[2]);
  const base = await prepareCustomerFixtures(op, suffix);
  const addon = await saveAddon(op, { name: `Security fixture ${suffix}`, description: "Disposable", enabled: true, entitlements: [],
    monthlyPrice: "0", yearlyPrice: "0", setupFee: "0", currency: "USD" });
  const members: string[] = [];
  const data: any[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const tenant = base.tenants[i], actor = actors[i], staff = `user_securityStaff${suffix}${i}`;
      members.push(staff);
      await pool.query("INSERT INTO tenant_memberships(tenant_id,clerk_user_id,role) VALUES($1,$2,'client_admin')", [tenant.id, actor]);
      await pool.query("UPDATE tenants SET completed_steps=array_append(completed_steps,'exchange_provisioned') WHERE id=$1", [tenant.id]);
      await setTenantOverrides(op, tenant.id, [
        { key: "crypto_payments", value: true, reason: "Disposable audit fixture" },
        { key: "webhooks", value: true, reason: "Disposable audit fixture" },
      ]);
      const p = await resolvePrincipal(actor);
      const resources: Record<string, string> = {};
      for (const type of ["staff", "api_keys", "webhooks", "payment_methods"] as const) {
        const r = await createResource(p, tenant.id, type, { label: `Security ${i} ${type}`,
          reference: type === "staff" ? staff : type === "webhooks" ? "https://example.invalid/security-audit" : null });
        resources[type] = r.item!.id;
      }
      const file = await uploadAttachment(p, `security-${i}.txt`, "text/plain", "requirement", Buffer.from(`Private security audit fixture ${i}.`));
      const input = { projectName: `Security project ${i}`, brandName: `Security brand ${i}`, preferredDomain: `security-${i}.example.test`,
        actions: ["swap" as const], details: "Disposable security audit", attachmentIds: [file.id], idempotencyKey: randomUUID() };
      const request = await submitRequest(p, input);
      await appendNote(op, request.id, { message: `INTERNAL SECURITY FIXTURE ${i}`, visibility: "internal" });
      const config = (await exchangeConfiguration(p, tenant.id)).configuration;
      const route = config.routes.find(r => r.action === "swap" && r.enabled)!;
      const quoteInput = { action: "swap" as const, source: route.source, destination: route.destination, amount: route.minimum === "0" ? "1" : route.minimum };
      const quote = await sandboxQuote(tenant.slug, quoteInput);
      const created = await sandboxOrder(tenant.slug, { quoteToken: quote.token, idempotencyKey: randomUUID() });
      // Tracking/quote secrets are deliberately not written to disk or logged.
      data.push({ tenant: await getTenant(p, tenant.id), config, resources, requestId: request.id, attachmentId: file.id,
        exchangeOrderId: created.order.id, quoteInput, requestInput: { ...input, attachmentIds: [], idempotencyKey: randomUUID() } });
    }
    await setTenantAddons(op, base.tenants[0].id, [addon.id]);
    return { actors, members, planId: base.planId, addonId: addon.id, plan: await getPlan(op, base.planId), data };
  } catch (error) {
    await cleanSecurityFixtures({ actors, members, planId: base.planId, addonId: addon.id, data: base.tenants.map(tenant => ({ tenant })) } as SecurityFixture);
    throw error;
  }
}
export async function cleanSecurityFixtures(f: SecurityFixture) {
  if (process.env.NODE_ENV === "production") throw new Error("Development cleanup refused in production.");
  const tenantIds = f.data.map(d => d.tenant.id);
  await deleteFixtureFiles(pool, f.actors.slice(0, 2));
  await pool.query("DELETE FROM white_label_attachments WHERE owner_user_id=ANY($1::text[])", [f.actors.slice(0, 2)]);
  for (const table of ["api_keys", "webhook_endpoints", "tenant_addons"]) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`, [tenantIds]);
  }
  await cleanCustomerFixtures(tenantIds, f.planId, [...f.actors, ...f.members]);
  await pool.query("DELETE FROM addon_entitlements WHERE addon_id=$1", [f.addonId]);
  await pool.query("DELETE FROM addons WHERE id=$1", [f.addonId]);
}
// Only the verification runner can create these fixtures. No HTTP test/backdoor route.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...actors] = process.argv.slice(2), path = ".local/security-audit-fixtures.json";
  try {
    if (command === "setup") {
      const f = await prepareSecurityFixtures(actors);
      await mkdir(".local", { recursive: true });
      await writeFile(path, JSON.stringify(f));
      console.log("Disposable development fixture manifest: artifacts/api-server/.local/security-audit-fixtures.json");
    } else if (command === "cleanup") {
      await cleanSecurityFixtures(JSON.parse(await readFile(path, "utf8")));
      await unlink(path);
      console.log("Disposable security fixture data and files removed.");
    } else throw new Error("Use setup NEW_CUSTOMER_A_ID NEW_CUSTOMER_B_ID NEW_OPERATOR_ID, or cleanup.");
  } finally { await pool.end(); }
}

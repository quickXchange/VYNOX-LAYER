import { withDatabase, type DatabaseClient } from "@workspace/db";
import { CreatePlanBody, CreateAddonBody } from "@workspace/api-zod";
import type { z } from "zod";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/catalog-audit";
import { acceptanceCatalog, catalogTable, historicalCatalogTable } from "../../lib/catalog-scope";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { isInteger, normalizeDecimal } from "./decimal";
import { discountBasisPoints, pricingTriple } from "./commercial-pricing";
import { freezePricingBeforeEdit } from "../commerce/pricing-publication";
import { assertRevision, assertSlugAvailable, billingError, normalizeProfile, type PlanProfile } from "../plan-management/profile";

export type PlanInput = z.infer<typeof CreatePlanBody>;
export type AddonInput = z.infer<typeof CreateAddonBody>;
export type Entry = PlanInput["entitlements"][number];
export interface Definition { key: string; label: string; kind: "feature" | "limit"; valueType: "boolean" | "integer" | "decimal"; }
export async function catalogLock(client: DatabaseClient, key: string, exclusive: boolean) {
  // Advisory locking coordinates catalog readers without requiring write access
  // from client admins. Advisory locks coordinate versions without write access.
  await client.query(exclusive
    ? "SELECT pg_advisory_xact_lock(hashtextextended($1,0))"
    : "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))", [key]);
}

export async function definitions(client: DatabaseClient): Promise<Definition[]> {
  const r = await client.query("SELECT key,label,kind,value_type AS \"valueType\" FROM entitlement_definitions ORDER BY kind,key");
  return r.rows;
}
export async function validateEntries(client: DatabaseClient, entries: Entry[]) {
  const defs = new Map((await definitions(client)).map((d) => [d.key, d]));
  const seen = new Set<string>();
  return entries.map((entry) => {
    const def = defs.get(entry.key);
    if (!def || seen.has(entry.key)) throw new HttpError(400, "Unknown or duplicate entitlement key.");
    seen.add(entry.key);
    if (def.kind === "feature") {
      if (typeof entry.value !== "boolean") throw new HttpError(400, `${def.label} must be boolean.`);
      return { ...entry };
    }
    if (typeof entry.value !== "string" || (def.valueType === "integer" && !isInteger(entry.value))) throw new HttpError(400, `${def.label} must be a nonnegative ${def.valueType}.`);
    return { ...entry, value: normalizeDecimal(entry.value) };
  });
}
export async function readPlan(client: DatabaseClient, id: string, historical = false) {
  const table = historical ? historicalCatalogTable : catalogTable;
  await catalogLock(client, `plan:${id}`, false);
  const r = await client.query(`SELECT * FROM ${table("plans")} WHERE id=$1`, [id]);
  const p = r.rows[0];
  if (!p) throw new HttpError(404, "Plan not found.");
  const e = await client.query(`SELECT key,value FROM ${table("plan_entitlements")} WHERE plan_id=$1 ORDER BY key`, [id]);
  const period = (await client.query(`SELECT monthly,yearly FROM ${table("offer_settings")} WHERE plan_id=$1`, [id])).rows[0];
  return {
    id: p.id as string, name: p.name as string, description: p.description as string,
    featureRows: (p.feature_rows ?? []) as NonNullable<PlanInput["featureRows"]>,
    monthlyPrice: p.pricing_configured ? p.monthly_price as string : null, yearlyPrice: p.pricing_configured ? p.yearly_price as string : null,
    setupFee: p.pricing_configured ? p.setup_fee as string : null, pricingConfigured: p.pricing_configured as boolean,
    discountPercent: p.discount_percent as string, currency: p.currency as string, billingLabel: p.billing_label as string,
    billingPeriods: [(!period || period.monthly) && "monthly", (!period || period.yearly) && "yearly"].filter(Boolean) as ("monthly" | "yearly")[],
    displayOrder: p.display_order as number, status: p.status as "enabled" | "disabled" | "archived",
    entitlements: e.rows as Entry[], createdAt: p.created_at as Date, updatedAt: p.updated_at as Date,
    profile: (p.profile ?? {}) as NonNullable<PlanInput["profile"]>, revision: (p.revision ?? 0) as number,
  };
}
export async function readAddon(client: DatabaseClient, id: string, historical = false) {
  const table = historical ? historicalCatalogTable : catalogTable;
  await catalogLock(client, `addon:${id}`, false);
  const r = await client.query(`SELECT * FROM ${table("addons")} WHERE id=$1`, [id]);
  const a = r.rows[0];
  if (!a) throw new HttpError(404, "Add-on not found.");
  const configured = a.pricing_configured && a.pricing_confirmed;
  const e = await client.query(`SELECT key,value FROM ${table("addon_entitlements")} WHERE addon_id=$1 ORDER BY key`, [id]);
  return { id: a.id as string, name: a.name as string, description: a.description as string, enabled: a.enabled as boolean, entitlements: e.rows as Entry[],
    monthlyPrice: configured ? a.monthly_price as string : null, yearlyPrice: configured ? a.yearly_price as string : null,
    setupFee: configured ? a.setup_fee as string : null, currency: a.currency as string, pricingConfigured: configured as boolean,
    discountPercent: a.discount_percent as string };
}
export async function listDefinitions(principal: Principal) {
  if (principal.role === "unassigned") throw new HttpError(403, "Administrator access required.");
  return withDatabase({ actorId: principal.userId, isSuperAdmin: principal.role === "super_admin" }, async c =>
    (await definitions(c)).filter(d => !["buy","sell"].includes(d.key)));
}
export function listPlans(principal: Principal) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal), async (client) => {
    const ids = await client.query(`SELECT id FROM ${catalogTable("plans")} ORDER BY display_order,name,id`);
    const plans = [];
    for (const row of ids.rows) plans.push(await readPlan(client, row.id));
    return plans;
  });
}
export function getPlan(principal: Principal, id: string) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal), (client) => readPlan(client, id));
}
export function listAddons(principal: Principal) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal), async (client) => {
    const ids = await client.query(`SELECT id FROM ${catalogTable("addons")} ORDER BY name,id`);
    const addons = [];
    for (const row of ids.rows) addons.push(await readAddon(client, row.id));
    return addons;
  });
}
async function writePlan(client: DatabaseClient, input: PlanInput, id?: string, actor?: string) {
  if (!id && input.currency !== "EUR") throw new HttpError(400, "New plans must be priced in EUR.");
  if (input.name.trim().length < 2) throw new HttpError(400, "Plan name must contain at least two non-whitespace characters.");
  // Validate direct service callers as well as HTTP requests. Bound the raw
  // strings first, then normalize display text without interpreting it as HTML.
  const featureRows = CreatePlanBody.shape.featureRows.parse(input.featureRows)?.map(row => {
    const label = row.label.trim(), value = row.value.trim();
    if (!label || !value) throw new HttpError(400, "Plan feature row label and value must contain non-whitespace text.");
    return { label, value };
  });
  const entries = await validateEntries(client, input.entitlements);
  const profile = input.profile !== undefined ? normalizeProfile(input.profile) : undefined;
  // Every update is bound to the revision the editor read; no silent overwrite.
  if (id) await assertRevision(client, id, input.expectedRevision);
  const stored = id ? (await client.query(`SELECT profile FROM ${catalogTable("plans")} WHERE id=$1`, [id])).rows[0]?.profile as PlanProfile | undefined : undefined;
  const effective = profile ?? stored ?? {};
  await assertSlugAvailable(client, effective.slug, input.status, id);
  const configured = pricingTriple([input.monthlyPrice, input.yearlyPrice, input.setupFee]);
  discountBasisPoints(input.discountPercent);
  // New plans derive billing availability from the chosen interval; existing plans use their stored periods.
  const iv = effective.billingInterval;
  const derived = { monthly: iv !== "yearly", yearly: iv !== "monthly" };
  const periods = id ? ((await client.query(`SELECT monthly,yearly FROM ${catalogTable("offer_settings")} WHERE plan_id=$1`, [id])).rows[0] ?? { monthly: true, yearly: true }) : derived;
  const bErr = billingError(effective, configured, { monthlyPrice: input.monthlyPrice, yearlyPrice: input.yearlyPrice, setupFee: input.setupFee, discountPercent: input.discountPercent }, periods);
  if (bErr) throw new HttpError(400, bErr);
  const args = [input.name.trim(), input.description, input.monthlyPrice ?? "0", input.yearlyPrice ?? "0", input.setupFee ?? "0", input.currency, input.billingLabel, input.displayOrder, input.status];
  const r = id
    ? await client.query(`UPDATE ${catalogTable("plans")} SET name=$1,description=$2,monthly_price=CASE WHEN $11 THEN $3 ELSE monthly_price END,yearly_price=CASE WHEN $11 THEN $4 ELSE yearly_price END,setup_fee=CASE WHEN $11 THEN $5 ELSE setup_fee END,currency=$6,billing_label=$7,display_order=$8,status=$9,updated_at=now() WHERE id=$10 RETURNING id`, [...args, id, configured])
    : await client.query(`INSERT INTO ${catalogTable("plans")} (name,description,monthly_price,yearly_price,setup_fee,currency,billing_label,display_order,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, args);
  const planId = r.rows[0].id as string;
  if (!id && iv && iv !== "monthly_and_yearly") await client.query(`INSERT INTO ${catalogTable("offer_settings")}(plan_id,monthly,yearly) VALUES($1,$2,$3) ON CONFLICT(plan_id) DO UPDATE SET monthly=$2,yearly=$3`, [planId, derived.monthly, derived.yearly]);
  // Omission preserves rows on updates; [] explicitly clears them. New plans
  // use the database default. These display strings never enter entitlements.
  if (profile !== undefined) await client.query(`UPDATE ${catalogTable("plans")} SET profile=$2::jsonb WHERE id=$1`, [planId, JSON.stringify(profile)]);
  await client.query(`UPDATE ${catalogTable("plans")} SET revision=revision+1,updated_by=$2 WHERE id=$1`, [planId, actor ?? null]);
  if (featureRows !== undefined) await client.query(`UPDATE ${catalogTable("plans")} SET feature_rows=$2::jsonb WHERE id=$1`, [planId, JSON.stringify(featureRows)]);
  await client.query(`UPDATE ${catalogTable("plans")} SET pricing_configured=$2,discount_percent=COALESCE($3,discount_percent) WHERE id=$1`, [planId, configured, input.discountPercent ?? null]);
  await client.query(`DELETE FROM ${catalogTable("plan_entitlements")} WHERE plan_id=$1`, [planId]);
  for (const e of entries) await client.query(`INSERT INTO ${catalogTable("plan_entitlements")} (plan_id,key,value) VALUES ($1,$2,$3::jsonb)`, [planId, e.key, JSON.stringify(e.value)]);
  return readPlan(client, planId);
}
export function savePlan(principal: Principal, input: PlanInput, id?: string) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal, undefined, true), async (client) => {
    await freezePricingBeforeEdit(client);
    if (id) { await catalogLock(client, `plan:${id}`, true); await client.query(`SELECT id FROM ${catalogTable("plans")} WHERE id=$1 FOR UPDATE`, [id]); }
    const before = id ? await readPlan(client, id) : null;
    const after = await writePlan(client, input, id, principal.userId);
    await audit(client, principal, null, id ? "plan.updated" : "plan.created", `${id ? "Updated" : "Created"} plan ${after.name}; pricing is metadata only`, { planId: after.id, before, after });
    return after;
  });
}
export function duplicatePlan(principal: Principal, id: string) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal, undefined, true), async (client) => {
    await freezePricingBeforeEdit(client);
    const source = await readPlan(client, id);
    const { slug: _slug, ...profileWithoutSlug } = source.profile ?? {};
    const { revision: _r, ...rest } = source;
    const after = await writePlan(client, { ...rest, name: `${source.name.slice(0, 110)} copy`, status: "disabled", profile: { ...profileWithoutSlug, badgeType: "none", featured: false } }, undefined, principal.userId);
    await audit(client, principal, null, "plan.duplicated", `Duplicated plan ${source.name}`, { sourceId: id, after });
    return after;
  });
}
export function changePlanStatus(principal: Principal, id: string, status: PlanInput["status"], expectedRevision: number | undefined) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal, undefined, true), async (client) => {
    await freezePricingBeforeEdit(client);
    await catalogLock(client, `plan:${id}`, true);
    await client.query(`SELECT id FROM ${catalogTable("plans")} WHERE id=$1 FOR UPDATE`, [id]);
    await assertRevision(client, id, expectedRevision);
    const before = await readPlan(client, id);
    await assertSlugAvailable(client, before.profile?.slug, status, id);
    await client.query(`UPDATE ${catalogTable("plans")} SET status=$2,updated_at=now(),revision=revision+1,updated_by=$3 WHERE id=$1`, [id, status, principal.userId]);
    const after = await readPlan(client, id);
    await audit(client, principal, null, `plan.${status}`, `Set plan ${after.name} to ${status}; existing subscriptions retained`, { planId: id, before: before.status, after: status });
    return after;
  });
}
export function saveAddon(principal: Principal, input: AddonInput, id?: string) {
  requireSuperAdmin(principal);
  if (!id && input.currency !== "EUR") throw new HttpError(400, "New add-ons must be priced in EUR.");
  if (input.name.trim().length < 2) throw new HttpError(400, "Add-on name must contain at least two non-whitespace characters.");
  return withDatabase(contextFor(principal, undefined, true), async (client) => {
    await freezePricingBeforeEdit(client);
    if (id) { await catalogLock(client, `addon:${id}`, true); await client.query(`SELECT id FROM ${catalogTable("addons")} WHERE id=$1 FOR UPDATE`, [id]); }
    const before = id ? await readAddon(client, id) : null;
    const entries = await validateEntries(client, input.entitlements);
    if (entries.some((e) => e.value === false)) throw new HttpError(400, "Add-ons grant features; use tenant overrides to revoke a feature.");
    const r = id
      ? await client.query(`UPDATE ${catalogTable("addons")} SET name=$1,description=$2,enabled=$3 WHERE id=$4 RETURNING id`, [input.name.trim(), input.description, input.enabled, id])
      : await client.query(`INSERT INTO ${catalogTable("addons")} (name,description,enabled) VALUES ($1,$2,$3) RETURNING id`, [input.name.trim(), input.description, input.enabled]);
    const hasPrices = ["monthlyPrice", "yearlyPrice", "setupFee"].some(key => key in input);
    const configured = hasPrices ? pricingTriple([input.monthlyPrice, input.yearlyPrice, input.setupFee]) : before?.pricingConfigured ?? false;
    discountBasisPoints(input.discountPercent ?? before?.discountPercent);
    await client.query(`UPDATE ${catalogTable("addons")} SET monthly_price=CASE WHEN $6 THEN $2 ELSE monthly_price END,yearly_price=CASE WHEN $6 THEN $3 ELSE yearly_price END,setup_fee=CASE WHEN $6 THEN $4 ELSE setup_fee END,currency=$5,pricing_configured=$6,pricing_confirmed=$6,discount_percent=$7 WHERE id=$1`, [
      r.rows[0].id, hasPrices ? input.monthlyPrice ?? "0" : before?.monthlyPrice ?? "0",
      hasPrices ? input.yearlyPrice ?? "0" : before?.yearlyPrice ?? "0",
      hasPrices ? input.setupFee ?? "0" : before?.setupFee ?? "0", input.currency ?? before?.currency ?? "USD",
      configured, input.discountPercent ?? before?.discountPercent ?? "0",
    ]);
    const addonId = r.rows[0].id as string;
    await client.query(`DELETE FROM ${catalogTable("addon_entitlements")} WHERE addon_id=$1`, [addonId]);
    for (const e of entries) await client.query(`INSERT INTO ${catalogTable("addon_entitlements")} (addon_id,key,value) VALUES ($1,$2,$3::jsonb)`, [addonId, e.key, JSON.stringify(e.value)]);
    const after = await readAddon(client, addonId);
    await audit(client, principal, null, id ? "addon.updated" : "addon.created", `Saved add-on ${after.name}`, { before, after });
    return after;
  });
}

/** Keep every historical order reference and live subscription; only truly unused records may be deleted. */
export function deleteCatalogRecord(principal: Principal, id: string, kind: "plan" | "addon", expectedRevision?: number) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal, undefined, true), async client => {
    await freezePricingBeforeEdit(client);
    await catalogLock(client, `${kind}:${id}`, true);
    if (kind === "plan") await assertRevision(client, id, expectedRevision);
    const before = kind === "plan" ? await readPlan(client, id) : await readAddon(client, id);
    // Retained IDs do not make a public subscription a private assignment.
    // Only sandbox request references can belong to the Acceptance catalog.
    const refs = acceptanceCatalog()
      ? await client.query(`SELECT 1 FROM white_label_requests
        WHERE configuration->'sandboxOnly'='true'::jsonb AND
        (($2='plan' AND (configuration->>'requestedPlanId'=$1::text
          OR configuration->'catalogSnapshot'->'plan'->>'id'=$1::text))
        OR ($2='addon' AND (COALESCE(configuration->'requestedAddonIds','[]'::jsonb) ? $1::text
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(configuration->'catalogSnapshot'->'addons')='array'
            THEN configuration->'catalogSnapshot'->'addons' ELSE '[]'::jsonb END) a WHERE a->>'id'=$1::text))))
        LIMIT 1`, [id, kind])
      : kind === "plan"
      ? await client.query(`SELECT 1 FROM tenant_subscriptions WHERE plan_id=$1 UNION ALL
        SELECT 1 FROM white_label_requests WHERE configuration->>'requestedPlanId'=$1::text
        OR configuration->'catalogSnapshot'->'plan'->>'id'=$1::text OR approved_configuration->'plan'->>'id'=$1::text LIMIT 1`, [id])
      : await client.query(`SELECT 1 FROM tenant_addons WHERE addon_id=$1 UNION ALL
        SELECT 1 FROM white_label_requests WHERE COALESCE(configuration->'requestedAddonIds','[]'::jsonb) ? $1::text
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(configuration->'catalogSnapshot'->'addons')='array' THEN configuration->'catalogSnapshot'->'addons' ELSE '[]'::jsonb END) a WHERE a->>'id'=$1::text)
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(approved_configuration->'addons')='array' THEN approved_configuration->'addons' ELSE '[]'::jsonb END) a WHERE a->>'id'=$1::text) LIMIT 1`, [id]);
    if (refs.rowCount) throw new HttpError(409, `This ${kind === "plan" ? "plan" : "add-on"} is referenced by a subscription or order. Disable${kind === "plan" ? " or archive" : ""} it instead; customer records must be preserved.`);
    await client.query(kind === "plan" ? `DELETE FROM ${catalogTable("plan_entitlements")} WHERE plan_id=$1` : `DELETE FROM ${catalogTable("addon_entitlements")} WHERE addon_id=$1`, [id]);
    await client.query(kind === "plan" ? `DELETE FROM ${catalogTable("plans")} WHERE id=$1` : `DELETE FROM ${catalogTable("addons")} WHERE id=$1`, [id]);
    await audit(client, principal, null, `${kind}.deleted`, `Deleted unused ${kind}; no customer records removed`, { id, before });
    return { ok: true };
  });
}
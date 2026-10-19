import { HttpError } from "./errors";
import { ACCEPTANCE_AUTH_ORIGIN, productionAcceptance } from "../modules/supabase-auth/config";

/** Server configuration only. Never accept a host/header/request-selected schema.
 * Partial Acceptance configuration fails closed, rather than selecting Live. */
export function acceptanceCatalog(env = process.env): boolean {
  const marked = env.QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION === "true" ||
    env.QXLAYER_EXTERNAL_CANDIDATE === "true" ||
    env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED === "true" ||
    env.QXLAYER_PLATFORM_URL === ACCEPTANCE_AUTH_ORIGIN ||
    env.QXLAYER_PRODUCTION_SUPABASE_AUTH_URL === ACCEPTANCE_AUTH_ORIGIN;
  if (!marked) return false;
  if (!productionAcceptance(env) || env.NODE_ENV !== "production" ||
      env.QXLAYER_PUBLIC_PREPARATION_APPROVED === "true" ||
      env.QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION !== "true" ||
      env.PRODUCTION_ACCESS_GATE_ENABLED !== "true" ||
      env.QXLAYER_DATABASE_PROVIDER !== "supabase" ||
      env.QXLAYER_AUTH_PROVIDER !== "supabase" ||
      env.QXLAYER_PLATFORM_URL !== ACCEPTANCE_AUTH_ORIGIN ||
      env.QXLAYER_PRODUCTION_SUPABASE_AUTH_URL !== ACCEPTANCE_AUTH_ORIGIN)
    throw new HttpError(503, "Acceptance catalog configuration is incomplete; shared catalog access denied.");
  return true;
}

const sharedTables = {
  plans: "public.plans",
  addons: "public.addons",
  plan_entitlements: "public.plan_entitlements",
  addon_entitlements: "public.addon_entitlements",
  offer_settings: "qxlayer_commerce.offer_settings",
  pricing_publication: "qxlayer_commerce.pricing_publication",
  catalog_audit_events: "public.audit_events",
} as const;
export type CatalogTable = keyof typeof sharedTables;
export function catalogTable(table: CatalogTable): string {
  if (!Object.hasOwn(sharedTables, table)) throw new Error("Unknown catalog identifier.");
  return acceptanceCatalog() ? `qxlayer_acceptance_catalog.${table}` : sharedTables[table];
}
/** Only the historical entitlement resolver uses this non-runtime-selected map. */
export function historicalCatalogTable(table: CatalogTable): string {
  if (!Object.hasOwn(sharedTables, table)) throw new Error("Unknown catalog identifier.");
  return sharedTables[table];
}
export function assertCatalogOperationAllowed(operation: string) {
  if (acceptanceCatalog())
    throw new HttpError(403, `Acceptance catalog isolation: ${operation} is unavailable; no operational changes were made.`);
}

/** Narrow allowlist; ordinary route authentication, MFA and CSRF still apply. */
export function privateCatalogWriteRoute(method: string, path: string): boolean {
  const id = "[0-9a-f-]{36}";
  return (method === "POST" && /^\/api\/(?:plans|add-ons|commerce\/pricing-publication)$/.test(path)) ||
    (["PUT", "DELETE"].includes(method) && new RegExp(`^/api/(?:plans|add-ons)/${id}$`).test(path)) ||
    (method === "POST" && new RegExp(`^/api/plans/${id}/duplicate$`).test(path)) ||
    (method === "PUT" && new RegExp(`^/api/plans/${id}/status$`).test(path)) ||
    (method === "PUT" && new RegExp(`^/api/operator/phase1/plans/${id}/periods$`).test(path)) ||
    (method === "POST" && new RegExp(`^/api/operator/phase1/proposals/(?:plan|addon)/${id}/approve$`).test(path));
}

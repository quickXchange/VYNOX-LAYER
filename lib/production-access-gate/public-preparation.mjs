// Public website approval never grants financial execution or identity migration.
export const PUBLIC_PREPARATION_ORIGIN = "https://qxlayer-staging.vercel.app";
export const OFFICIAL_PRODUCTION_ORIGIN = "https://vynoxlayer.com";
/** Browser-safe metadata validation, shared with packaging before deployment. */
export function productionBrowserAuthMetadataValid({ projectRef, origin, acceptance, preparation, official }) {
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? "") ||
      ["nktstksmfpcsjnjbeqsk", "muvedavhbpgpdrrnjrih"].includes(projectRef)) return false;
  if (official === "true" && (preparation !== "true" || acceptance === "true")) return false;
  const expected = acceptance === "true" ? "https://qxlayer-acceptance-vynox3.vercel.app" :
    preparation === "true" ? official === "true" ? OFFICIAL_PRODUCTION_ORIGIN :
      origin === "https://www.quicklychan.xyz" ? "https://www.quicklychan.xyz" : PUBLIC_PREPARATION_ORIGIN :
      "https://www.quicklychan.xyz";
  return origin === expected;
}
export function publicPreparation(env = process.env) {
  if (env.QXLAYER_PUBLIC_PREPARATION_APPROVED !== "true") return false;
  const origin = env.QXLAYER_VYNOX_DOMAIN_CONNECTION_APPROVED === "true" ?
    OFFICIAL_PRODUCTION_ORIGIN : env.QXLAYER_OFFICIAL_DOMAIN_CONNECTION_APPROVED === "true" ?
    "https://www.quicklychan.xyz" : PUBLIC_PREPARATION_ORIGIN;
  if (env.QXLAYER_VYNOX_DOMAIN_CONNECTION_APPROVED === "true" &&
      env.QXLAYER_OFFICIAL_DOMAIN_CONNECTION_APPROVED !== "true")
    throw new Error("Official primary-domain approval requires the existing domain-connection approval.");
  if (env.QXLAYER_EXTERNAL_ENVIRONMENT !== "production" ||
      env.QXLAYER_EXTERNAL_CANDIDATE === "true" ||
      env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED === "true" ||
      env.QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED !== "false" ||
      env.QXLAYER_PUBLIC_PRODUCTION_ORIGIN !== origin ||
      env.QXLAYER_PLATFORM_URL !== origin ||
      env.PRODUCTION_ACCESS_GATE_ENABLED !== "false" ||
      env.QXLAYER_FINANCIAL_EXECUTION_ENABLED !== "false")
    throw new Error("Public preparation requires its exact isolated temporary origin, disabled financial execution and an unchanged domain-cutover hold.");
  return true;
}

/** Exact legacy hosts remain usable; acceptance has its own isolated runtime. */
export function publicAuthOriginAllowed(origin, configured, env = process.env) {
  if (origin === configured) return true;
  if (!publicPreparation(env)) return false;
  const legacy = [PUBLIC_PREPARATION_ORIGIN, "https://www.quicklychan.xyz"];
  if (configured === OFFICIAL_PRODUCTION_ORIGIN)
    return legacy.includes(origin);
  return configured === "https://www.quicklychan.xyz" && origin === PUBLIC_PREPARATION_ORIGIN;
}

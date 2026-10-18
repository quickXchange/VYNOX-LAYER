// Explicit pre-DNS Production mode. This is not public-domain cutover authority.
export const PUBLIC_PREPARATION_ORIGIN = "https://qxlayer-staging.vercel.app";
export function publicPreparation(env = process.env) {
  if (env.QXLAYER_PUBLIC_PREPARATION_APPROVED !== "true") return false;
  const origin = env.QXLAYER_OFFICIAL_DOMAIN_CONNECTION_APPROVED === "true" ?
    "https://www.quicklychan.xyz" : PUBLIC_PREPARATION_ORIGIN;
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

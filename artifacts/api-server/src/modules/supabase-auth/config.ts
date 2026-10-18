// Explicitly scoped providers only; never activate authentication from storage settings.
// Never infer Supabase Auth from the database/storage provider.
import { publicPreparation, PUBLIC_PREPARATION_ORIGIN } from "../../../../../lib/production-access-gate/public-preparation.mjs";
export const STAGING_AUTH_PROJECT = "muvedavhbpgpdrrnjrih";
export const DEVELOPMENT_AUTH_PROJECT = "nktstksmfpcsjnjbeqsk";
export const PRODUCTION_AUTH_ORIGIN = "https://www.quicklychan.xyz";
export const ACCEPTANCE_AUTH_ORIGIN = "https://qxlayer-acceptance-vynox3.vercel.app";
export function productionAcceptance(env = process.env) {
  return env.QXLAYER_EXTERNAL_ENVIRONMENT === "production" &&
    env.QXLAYER_EXTERNAL_CANDIDATE === "true" &&
    env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED === "true" &&
    env.QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED === "false";
}

export function productionSupabaseAuth(env = process.env): boolean {
  return env.QXLAYER_EXTERNAL_ENVIRONMENT === "production" && env.QXLAYER_AUTH_PROVIDER === "supabase";
}

/** Email first factor is always followed by the existing verified authenticator. */
export function supabaseEmailLoginEnabled(env = process.env): boolean {
  return supabaseAuthEnabled(env);
}

export function developmentSupabaseAuth(env = process.env): boolean {
  return env.QXLAYER_EXTERNAL_ENVIRONMENT === "development" &&
    (env.QXLAYER_AUTH_PROVIDER === "supabase" || env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_TRIAL_ENABLED === "true");
}

export function supabaseAuthEnabled(env = process.env): boolean {
  const enabled = env.QXLAYER_AUTH_PROVIDER === "supabase" ||
    env.QXLAYER_SUPABASE_AUTH_TRIAL_ENABLED === "true" ||
    env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_TRIAL_ENABLED === "true";
  if (!enabled) return false;
  if (developmentSupabaseAuth(env)) {
    if (!["development", "test"].includes(env.NODE_ENV ?? "") ||
        !["", "replit"].includes(env.QXLAYER_DATABASE_PROVIDER ?? "") ||
        !env.REPLIT_DEV_DOMAIN?.endsWith(".replit.dev"))
      throw new Error("Development Supabase Auth requires the Replit Development runtime and existing local business database.");
    return true;
  }
  if (env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_TRIAL_ENABLED === "true")
    throw new Error("Development authentication cannot be enabled outside Development.");
  if (productionSupabaseAuth(env)) {
    if (env.NODE_ENV !== "production" ||
        (env.QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED !== "true" && !productionAcceptance(env) && !publicPreparation(env)) ||
        env.QXLAYER_SUPABASE_AUTH_TRIAL_ENABLED === "true")
      throw new Error("Production Supabase Auth requires explicit approved cutover and a Production runtime, never trial settings.");
    return true;
  }
  if (env.QXLAYER_EXTERNAL_ENVIRONMENT !== "staging")
    throw new Error("Supabase authentication trials are Staging-only; Production cutover is not approved.");
  return true;
}

export function supabaseAuthConfiguration(env = process.env) {
  if (!supabaseAuthEnabled(env)) throw new Error("Supabase authentication trial is not enabled.");
  if (productionSupabaseAuth(env)) {
    const project = env.QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF;
    if (!project || !/^[a-z0-9]{20}$/.test(project) ||
        [DEVELOPMENT_AUTH_PROJECT, STAGING_AUTH_PROJECT].includes(project))
      throw new Error("Production requires its own isolated Supabase Auth project.");
    const origin = productionAcceptance(env) ? ACCEPTANCE_AUTH_ORIGIN :
      publicPreparation(env) ? PUBLIC_PREPARATION_ORIGIN : PRODUCTION_AUTH_ORIGIN;
    if (env.QXLAYER_PRODUCTION_SUPABASE_AUTH_URL !== origin)
      throw new Error("Production authentication must use the exact canonical Live HTTPS origin.");
    const apiKey = env.QXLAYER_PRODUCTION_SUPABASE_AUTH_SERVER_KEY;
    if (!apiKey?.startsWith("sb_secret_") ||
        [env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_SERVER_KEY, env.QXLAYER_SUPABASE_AUTH_SERVER_KEY].includes(apiKey))
      throw new Error("Production requires an independent server-only Supabase secret key.");
    supabaseSessionSecret(env);
    return { origin, providerOrigin: `https://${project}.supabase.co`,
      apiKey, mailReady: env.QXLAYER_PRODUCTION_SUPABASE_AUTH_MAIL_READY === "true" };
  }
  if (developmentSupabaseAuth(env)) {
    const origin = new URL(env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_URL ?? "");
    if (origin.origin !== `https://${env.REPLIT_DEV_DOMAIN}` || origin.pathname !== "/" ||
        origin.username || origin.password || origin.search || origin.hash)
      throw new Error("Development authentication requires the exact Replit Development HTTPS origin.");
    if (env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_PROJECT_REF !== DEVELOPMENT_AUTH_PROJECT)
      throw new Error("Development authentication must use its isolated pinned project, never Staging.");
    const apiKey = env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_SERVER_KEY;
    if (!apiKey?.startsWith("sb_secret_"))
      throw new Error("Development authentication requires its server-only secret key, not a publishable or Staging key.");
    supabaseSessionSecret(env);
    return { origin: origin.origin, providerOrigin: `https://${DEVELOPMENT_AUTH_PROJECT}.supabase.co`,
      apiKey, mailReady: env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_MAIL_READY === "true" };
  }
  const url = new URL(env.QXLAYER_SUPABASE_AUTH_URL ?? "");
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash)
    throw new Error("An exact HTTPS Staging authentication origin is required.");
  const project = env.QXLAYER_SUPABASE_AUTH_PROJECT_REF;
  if (project !== STAGING_AUTH_PROJECT)
    throw new Error("Supabase authentication must use the pinned Staging project.");
  const apiKey = env.QXLAYER_SUPABASE_AUTH_SERVER_KEY;
  if (!apiKey) throw new Error("A server-only Staging Supabase Auth key is required.");
  return {
    origin: url.origin,
    providerOrigin: `https://${project}.supabase.co`,
    apiKey,
    mailReady: env.QXLAYER_SUPABASE_AUTH_MAIL_READY === "true",
  };
}

export function supabaseSessionSecret(env = process.env): string {
  if (productionSupabaseAuth(env)) {
    const key = env.QXLAYER_PRODUCTION_SUPABASE_AUTH_SESSION_SECRET;
    if (!key || key.length < 32 ||
        [env.SESSION_SECRET, env.QXLAYER_SUPABASE_AUTH_SESSION_SECRET,
          env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_SESSION_SECRET].includes(key))
      throw new Error("Production requires independent session encryption, never a Development/Staging key.");
    return key;
  }
  const development = developmentSupabaseAuth(env);
  const key = development ? env.QXLAYER_DEVELOPMENT_SUPABASE_AUTH_SESSION_SECRET : env.QXLAYER_SUPABASE_AUTH_SESSION_SECRET;
  if (!key || (development && (key.length < 32 || key === env.QXLAYER_SUPABASE_AUTH_SESSION_SECRET || key === env.SESSION_SECRET)))
    throw new Error("Independent environment-scoped Supabase session encryption is required.");
  return key;
}

/** Supabase is the only runtime provider; configuration never implies activation. */
export function supabaseDefaultProvider(env = process.env) {
  return env.QXLAYER_AUTH_PROVIDER === "supabase" && supabaseAuthEnabled(env);
}

export function supabaseBusinessId(subject: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(subject))
    throw new Error("Invalid Supabase identity.");
  // Existing identities must be linked with explicit proof, never email matching.
  // This namespace cannot collide with existing Clerk or Better Auth business IDs.
  return `supabase:${subject.toLowerCase()}`;
}

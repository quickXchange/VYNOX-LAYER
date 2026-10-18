import { supabaseAuthConfiguration, supabaseDefaultProvider, productionAcceptance } from "../modules/supabase-auth/config";
import { publicPreparation } from "../../../../lib/production-access-gate/public-preparation.mjs";

/** External startup is opt-in; neither Replit runtime nor Production is switched. */
export function assertExternalEnvironment(env = process.env) {
  if (env.QXLAYER_DATABASE_PROVIDER !== "supabase") return;
  const preparingPublic = publicPreparation(env);
  if (env.QXLAYER_EXTERNAL_ENVIRONMENT &&
      !["staging", "production"].includes(env.QXLAYER_EXTERNAL_ENVIRONMENT))
    throw new Error("Invalid external environment; authentication selection must be explicit.");
  if (env.QXLAYER_EXTERNAL_STARTUP_APPROVED !== "true")
    throw new Error("External startup is disabled until the isolated target is approved.");
  if (productionAcceptance(env) && (env.QXLAYER_PRODUCTION_SCHEMA_VERIFIED !== "true" ||
      !env.QXLAYER_PRODUCTION_AUTH_DATABASE_URL))
    throw new Error("Protected acceptance requires verified schema and a separate restricted Auth login");
  for (const key of ["SESSION_SECRET", ...(!preparingPublic ? ["PRODUCTION_ACCESS_CODE"] : []), "QXLAYER_PLATFORM_URL",
    "SUPABASE_STORAGE_URL", "SUPABASE_STORAGE_BUCKET", "SUPABASE_STORAGE_SERVICE_KEY"])
    if (!env[key]) throw new Error(`External configuration missing: ${key}.`);
  if (env.QXLAYER_STORAGE_PROVIDER !== "supabase" || env.QXLAYER_HEALTH_MONITOR_MODE !== "disabled" ||
      env.PRODUCTION_ACCESS_GATE_ENABLED !== (preparingPublic ? "false" : "true"))
    throw new Error("External API requires private storage, an enabled access gate and a separate worker.");
  const platform = new URL(env.QXLAYER_PLATFORM_URL!);
  let db: URL;
  try { db = new URL(env.DATABASE_URL!); }
  catch { throw new Error("Invalid external database configuration; credentials are not logged."); }
  const ref = db.hostname.startsWith("db.") ? db.hostname.split(".")[1] : decodeURIComponent(db.username).split(".")[1];
  if (!ref || env.SUPABASE_STORAGE_URL !== `https://${ref}.supabase.co`)
    throw new Error("Private storage must use the same pinned Supabase project as the database.");
  if (platform.protocol !== "https:" || !supabaseDefaultProvider(env) ||
      supabaseAuthConfiguration(env).origin !== platform.origin)
    throw new Error("External hosting requires approved, origin-pinned Supabase authentication; Production migration is not approved.");
}

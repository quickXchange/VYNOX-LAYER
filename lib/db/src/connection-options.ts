import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";
import { publicPreparation } from "../../../lib/production-access-gate/public-preparation.mjs";

/** Replit defaults stay unchanged. External mode must be explicit and pinned. */
export function connectionOptions(env = process.env): PoolConfig {
  return restrictedConnectionOptions(env, publicPreparation(env) ? "qxlayer_public_app" : "qxlayer_app");
}

export function authConnectionOptions(env = process.env): PoolConfig {
  if (env.QXLAYER_DATABASE_PROVIDER !== "supabase")
    throw new Error("External private Auth support requires the isolated Supabase provider");
  return restrictedConnectionOptions({ ...env, DATABASE_URL: env.QXLAYER_PRODUCTION_AUTH_DATABASE_URL },
    publicPreparation(env) ? "qxlayer_public_auth" : "qxlayer_auth_app");
}

function restrictedConnectionOptions(env: NodeJS.ProcessEnv, login: "qxlayer_app" | "qxlayer_auth_app" | "qxlayer_public_app" | "qxlayer_public_auth"): PoolConfig {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!env.QXLAYER_DATABASE_PROVIDER || env.QXLAYER_DATABASE_PROVIDER === "replit")
    return { connectionString: env.DATABASE_URL };
  if (env.QXLAYER_DATABASE_PROVIDER !== "supabase") throw new Error("Unknown database provider.");
  let url: URL;
  try { url = new URL(env.DATABASE_URL); }
  catch { throw new Error("External database connection URL is invalid; credentials are not logged."); }
  if (!env.DB_EXPECTED_HOST || url.hostname !== env.DB_EXPECTED_HOST ||
      !/^(?:db\.[a-z0-9]+\.supabase\.co|[a-z0-9.-]+\.pooler\.supabase\.com)$/.test(url.hostname) ||
      !(new RegExp(`^${login}(?:\\.[a-z0-9]+)?$`)).test(decodeURIComponent(url.username)) ||
      url.pathname !== "/postgres" || !["", "5432"].includes(url.port))
    throw new Error("External runtime requires the pinned Supabase direct/session connection and restricted application login.");
  if (!env.DB_TLS_CA_FILE) throw new Error("DB_TLS_CA_FILE is required for verified external TLS.");
  // pg URL SSL parameters override explicit TLS options; do not allow that.
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(name);
  const max = Number(env.DB_POOL_MAX ?? "6");
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error("DB_POOL_MAX must be 1–20.");
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ca: readFileSync(env.DB_TLS_CA_FILE, "utf8") },
    max, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
  };
}

export function runtimeRole(env = process.env) {
  if (env.QXLAYER_DATABASE_PROVIDER === "supabase") return "qxlayer_runtime";
  if (!env.QXLAYER_DATABASE_PROVIDER || env.QXLAYER_DATABASE_PROVIDER === "replit") return "pg_database_owner";
  throw new Error("Unknown database provider.");
}

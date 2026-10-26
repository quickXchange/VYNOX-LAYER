import { readFile } from "node:fs/promises";

const blocked = () => new Error("Target-scope preflight blocked: configuration incomplete, ambiguous, or outside approved scope; private details withheld.");
const fail = () => { throw blocked(); };

// Compare database identity, not credentials, runtime hostname, or connection role.
// Unknown endpoint formats are deliberately not guessed to be isolated.
export function databaseIdentity(value) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash) fail();
    // libpq connection overrides can change the target independently of the URL.
    if ([...url.searchParams.keys()].some(k => !["sslmode", "sslrootcert", "sslcert", "sslkey", "channel_binding", "application_name", "connect_timeout"].includes(k))) fail();
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!database || database.includes("/")) fail();
    const direct = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
    const pool = /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(url.hostname);
    const project = direct?.[1] ?? (pool ? decodeURIComponent(url.username).match(/\.([a-z0-9]+)$/)?.[1] : null);
    if (!project || (direct && !["", "5432"].includes(url.port)) ||
        (pool && !["", "5432", "6543"].includes(url.port))) fail();
    return `${project}/${database}`;
  } catch { throw blocked(); }
}

function variables(rows) {
  if (!Array.isArray(rows)) fail();
  const result = {};
  for (const row of rows) {
    const v = row.envVar ?? row;
    if (typeof v.key !== "string" || typeof v.value !== "string" || Object.hasOwn(result, v.key)) fail();
    result[v.key] = v.value;
  }
  return result;
}

export function effectiveEnvironment(groups, serviceId, overrides) {
  const direct = variables(overrides), inherited = {};
  for (const group of groups) {
    if (!Array.isArray(group.serviceLinks)) fail();
    if (!group.serviceLinks.some(link => link.id === serviceId)) continue;
    for (const [key, value] of Object.entries(variables(group.envVars))) {
      if (Object.hasOwn(direct, key)) continue;
      if (Object.hasOwn(inherited, key) && inherited[key] !== value) fail();
      inherited[key] = value;
    }
  }
  return { ...inherited, ...direct };
}

export async function targetScopePreflight({
  connectionString, serviceId, scope = "acceptance-only", publicWriteApproved = false,
  token = process.env.RENDER_API_KEY, fetchImpl = fetch,
  config,
} = {}) {
  try {
    config ??= JSON.parse(await readFile(new URL("../../deploy/public-preparation.json", import.meta.url), "utf8"));
    const policy = config.operatorTargetScope;
    if (!token || !policy || !Array.isArray(policy.publicServiceIds) || !policy.publicServiceIds.length ||
        !policy.publicServiceIds.includes(config.renderServiceId) ||
        !policy.publicServiceIds.every(id => /^srv-[a-z0-9]+$/.test(id))) fail();
    serviceId ??= policy.acceptanceServiceId;
    if (!/^srv-[a-z0-9]+$/.test(serviceId) ||
        !["acceptance-only", "public", "isolated"].includes(scope) ||
        (scope === "acceptance-only" && serviceId !== policy.acceptanceServiceId) ||
        (scope === "public" && publicWriteApproved !== true)) fail();
    const get = async path => {
      const response = await fetchImpl(`https://api.render.com/v1/${path}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) fail();
      return response.json();
    };
    const list = async path => {
      const result = [], seen = new Set();
      let cursor;
      for (;;) {
        const rows = await get(`${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        if (!Array.isArray(rows)) fail();
        result.push(...rows);
        if (rows.length < 100) return result;
        cursor = rows.at(-1)?.cursor;
        if (!cursor || seen.has(cursor)) fail();
        seen.add(cursor);
      }
    };
    const summaries = await list("env-groups");
    const groups = [];
    const ids = new Set();
    for (const row of summaries) {
      const id = (row.envGroup ?? row).id;
      if (!/^evg-[a-z0-9]+$/.test(id) || ids.has(id)) fail();
      ids.add(id);
      const group = await get(`env-groups/${id}`);
      if (group.id !== id) fail();
      groups.push(group);
    }
    const target = databaseIdentity(connectionString);
    let targetEnv;
    const sharedPublicServices = [];
    for (const id of new Set([serviceId, ...policy.publicServiceIds])) {
      const env = effectiveEnvironment(groups, id, await list(`services/${id}/env-vars`));
      const runtime = databaseIdentity(env.DATABASE_URL);
      if (id === serviceId) {
        if (runtime !== target) fail();
        targetEnv = env;
      }
      if (policy.publicServiceIds.includes(id) && runtime === target) sharedPublicServices.push(id);
    }
    if (sharedPublicServices.length && scope !== "public") fail();
    // Never return or print the canonical database identity or provider payloads in a receipt.
    return { env: targetEnv, receipt: { scope, sharedPublicServices, targetVerified: true } };
  } catch { throw blocked(); }
}

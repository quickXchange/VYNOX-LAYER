import { Storage } from "@google-cloud/storage";
import { Readable } from "node:stream";
import { HttpError } from "./errors";

const sidecar = "http://127.0.0.1:1106";
const replitStorage = new Storage({
  projectId: "",
  credentials: {
    audience: "replit", subject_token_type: "access_token", token_url: `${sidecar}/token`, type: "external_account",
    credential_source: { url: `${sidecar}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
});
type SaveOptions = { resumable?: boolean; metadata?: { contentType?: string; cacheControl?: string }; preconditionOpts?: { ifGenerationMatch?: number } };

/** Backend-only private bucket. Authorization stays in the existing callers. */
export function supabaseObject(key: string, env = process.env, fetcher: typeof fetch = fetch) {
  const origin = new URL(env.SUPABASE_STORAGE_URL ?? "https://unconfigured.invalid");
  const bucket = env.SUPABASE_STORAGE_BUCKET;
  const credential = env.SUPABASE_STORAGE_SERVICE_KEY;
  if (origin.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(origin.hostname) ||
      origin.pathname !== "/" || !bucket || !/^[a-z0-9-]+$/.test(bucket) || !credential)
    throw new HttpError(503, "External private storage is not configured.");
  if (!key || key.split("/").some(s => !s || s === "." || s === ".." || /[\\\x00-\x1f]/.test(s)))
    throw new HttpError(400, "Invalid object key.");
  const object = `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  async function request(method: string, operation: string, body?: Uint8Array, contentType?: string) {
    const response = await fetcher(`${origin.origin}/storage/v1/${operation}/${object}`, {
      method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${credential}`, apikey: credential, "x-upsert": "false",
        ...(contentType ? { "Content-Type": contentType } : {}) },
      ...(body ? { body: body as NonNullable<Parameters<typeof fetch>[1]>["body"] } : {}),
    });
    // Never return raw provider errors, URLs, headers or credentials.
    return response;
  }
  async function download(): Promise<[Buffer]> {
    const result = await request("GET", "object/authenticated");
    if (!result.ok) throw new HttpError(result.status === 404 ? 404 : 503, "Private object is unavailable.");
    return [Buffer.from(await result.arrayBuffer())];
  }
  return {
    async save(bytes: Buffer, options: SaveOptions = {}) {
      const result = await request("POST", "object", bytes, options.metadata?.contentType ?? "application/octet-stream");
      if (!result.ok) throw new HttpError(result.status === 409 ? 409 : 503, "Private upload could not be saved.");
    },
    async delete(options: { ignoreNotFound?: boolean } = {}) {
      const result = await fetcher(`${origin.origin}/storage/v1/object/${encodeURIComponent(bucket!)}`, {
        method: "DELETE", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${credential}`, apikey: credential, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [key] }),
      });
      if (!result.ok && !(options.ignoreNotFound && result.status === 404))
        throw new HttpError(503, "Private object could not be removed.");
    },
    async exists(): Promise<[boolean]> {
      const result = await request("GET", "object/info/authenticated");
      if (result.status === 404) return [false];
      if (!result.ok) throw new HttpError(503, "Private object availability could not be checked.");
      return [true];
    },
    download,
    createReadStream() { return Readable.from((async function* () { yield (await download())[0]; })()); },
  };
}

let testObjectFactory: ((key: string) => ReturnType<typeof supabaseObject>) | undefined;
/** Explicit dependency injection for disposable CI only, never a runtime fallback. */
export function installDisposableTestObjectStore(factory: NonNullable<typeof testObjectFactory>) {
  if (process.env.NODE_ENV !== "test" || process.env.QXLAYER_MIGRATION_TEST !== "true")
    throw new Error("Disposable test storage is forbidden outside CI tests.");
  testObjectFactory = factory;
}
export function privateObject(key: string) {
  if (testObjectFactory) return testObjectFactory(key);
  const provider = process.env.QXLAYER_STORAGE_PROVIDER ?? "replit";
  if (provider === "supabase") return supabaseObject(key);
  if (provider !== "replit") throw new HttpError(503, "Unknown storage provider.");
  const segments = process.env.PRIVATE_OBJECT_DIR?.split("/").filter(Boolean);
  if (!segments || segments.length < 2) throw new HttpError(503, "Private upload storage is not configured.");
  return replitStorage.bucket(segments[0]).file(`${segments.slice(1).join("/")}/${key}`);
}

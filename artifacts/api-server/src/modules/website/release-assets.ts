import { createHash, randomUUID } from "node:crypto";
import { resolve4 } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import sanitizeHtml from "sanitize-html";
import { withDatabase, type DatabaseClient } from "@workspace/db";
import type { SiteSnapshotConfig } from "@workspace/api-zod";
import { contextFor, type Principal } from "../authentication/service";
import { privateFile } from "../customer/order-files";
import { HttpError } from "../../lib/errors";

const MAX = 2 * 1024 * 1024;
const types: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico" };
type Asset = { id: string; tenant_id: string; object_key: string; checksum: string; extension: string; content_type: string; size: number };
export function safeImage(input: Buffer, type: string) {
  if (!types[type] || input.length === 0 || input.length > MAX) throw new HttpError(400, "Use a PNG, JPEG, WebP, GIF, ICO or sanitized SVG image up to 2 MB.");
  let bytes = input;
  if (type === "image/svg+xml") {
    const text = input.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new HttpError(400, "SVG entities and document types are not allowed.");
    const sanitized = sanitizeHtml(text, { allowedTags: ["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "title", "desc"],
      allowedAttributes: { svg: ["xmlns", "viewBox", "width", "height"], "*": ["d", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "points", "fill", "stroke", "stroke-width", "opacity", "transform", "fill-rule"] },
      allowedSchemes: [], parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
      transformTags: { "*": (tagName, attributes) => ({ tagName, attribs: Object.fromEntries(Object.entries(attributes).filter(([, v]) => !/url\s*\(|javascript:|data:|https?:|[<>&]/i.test(v))) }) },
    });
    if (!/<svg(?:\s|>)/.test(sanitized)) throw new HttpError(400, "An SVG root is required.");
    bytes = Buffer.from(sanitized);
  } else {
    const hex = bytes.subarray(0, 12).toString("hex");
    const valid = type === "image/png" ? hex.startsWith("89504e470d0a1a0a") :
      type === "image/jpeg" ? hex.startsWith("ffd8ff") :
      type === "image/webp" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" :
      type === "image/gif" ? /GIF8[79]a/.test(bytes.subarray(0, 6).toString()) : hex.startsWith("00000100");
    if (!valid) throw new HttpError(400, "The image bytes do not match the declared type.");
  }
  return { bytes, contentType: type, extension: types[type], checksum: createHash("sha256").update(bytes).digest("hex") };
}
async function store(c: DatabaseClient, tenantId: string, bytes: Buffer, contentType: string): Promise<Asset> {
  const image = safeImage(bytes, contentType), key = `draft-assets/${tenantId}/${randomUUID()}.${image.extension}`;
  const old = await c.query("SELECT * FROM tenant_release_assets WHERE tenant_id=$1 AND checksum=$2", [tenantId, image.checksum]);
  if (old.rowCount) return old.rows[0];
  await privateFile(key).save(image.bytes, { resumable: false, metadata: { contentType: image.contentType, cacheControl: "private, no-store" }, preconditionOpts: { ifGenerationMatch: 0 } });
  const saved = await c.query(`INSERT INTO tenant_release_assets(tenant_id,object_key,checksum,extension,content_type,size)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,checksum) DO UPDATE SET checksum=EXCLUDED.checksum RETURNING *`,
    [tenantId, key, image.checksum, image.extension, image.contentType, image.bytes.length]);
  if (saved.rows[0].object_key !== key) await privateFile(key).delete({ ignoreNotFound: true });
  return saved.rows[0];
}
export async function uploadDraftAsset(p: Principal, tenantId: string, bytes: Buffer, contentType: string) {
  return withDatabase(contextFor(p, tenantId, true, "branding.manage"), async c => {
    await c.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [tenantId]);
    const asset = await store(c, tenantId, bytes, contentType);
    return { url: `/api/tenants/${tenantId}/release-assets/${asset.id}` };
  });
}
export async function draftAsset(p: Principal, tenantId: string, assetId: string) {
  return withDatabase(contextFor(p, tenantId), async c => {
    const r = await c.query("SELECT * FROM tenant_release_assets WHERE tenant_id=$1 AND id=$2", [tenantId, assetId]);
    if (!r.rowCount) throw new HttpError(404, "Draft asset not found.");
    return { file: privateFile(r.rows[0].object_key), contentType: r.rows[0].content_type as string };
  });
}
function publicV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return isIP(ip) === 4 && a > 0 && a !== 10 && a !== 127 && a < 224 && a !== 169 &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19));
}
/** No browser-selected credentials, private hosts, redirects, DNS rebinding or unbounded downloads. */
async function remoteImage(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || isIP(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) throw new HttpError(400, "Upload a logo or use a public HTTPS image without credentials.");
  const ips = await resolve4(url.hostname);
  if (!ips.length || !ips.every(publicV4)) throw new HttpError(400, "Private image hosts are not allowed.");
  return new Promise<{ bytes: Buffer; type: string }>((resolve, reject) => {
    const req = request(url, { family: 4, lookup: (_host, _opts, cb) => cb(null, ips[0], 4), timeout: 10_000 }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new HttpError(400, "The logo URL could not be loaded. Upload the image instead.")); return; }
      const parts: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX) res.destroy(new HttpError(400, "Logo exceeds 2 MB.")); else parts.push(chunk); });
      res.on("error", reject);
      res.on("end", () => resolve({ bytes: Buffer.concat(parts), type: String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() }));
    });
    req.on("timeout", () => req.destroy(new HttpError(400, "Logo download timed out.")));
    req.on("error", () => reject(new HttpError(400, "The logo URL could not be loaded. Upload the image instead.")));
    req.end();
  });
}
async function selectedAsset(c: DatabaseClient, tenantId: string, slug: string, url: string): Promise<Asset> {
  const privateMatch = /^\/api\/tenants\/([a-f0-9-]{36})\/release-assets\/([a-f0-9-]{36})$/.exec(url);
  const releasedMatch = /^\/api\/public\/release-assets\/([a-f0-9-]{36})\/([a-f0-9]{64})\.[a-z]+$/.exec(url);
  if (privateMatch || releasedMatch) {
    const match = (privateMatch ?? releasedMatch)!;
    if (match[1] !== tenantId) throw new HttpError(400, "A logo cannot be borrowed from another tenant.");
    const r = await c.query(`SELECT * FROM tenant_release_assets WHERE tenant_id=$1 AND ${privateMatch ? "id" : "checksum"}=$2`, [tenantId, match[2]]);
    if (!r.rowCount) throw new HttpError(400, "The selected logo is missing.");
    return r.rows[0];
  }
  const curated = new RegExp(`^/api/public/sites/${slug}/branding/(logo|favicon)$`).exec(url);
  if (curated) {
    const field = curated[1] === "logo" ? "logoAttachmentId" : "faviconAttachmentId";
    const r = await c.query(`SELECT a.object_key,a.content_type FROM white_label_requests w JOIN white_label_attachments a
      ON a.id::text=w.configuration->'design'->>$2 AND a.request_id=w.id AND a.owner_user_id=w.customer_user_id
      WHERE w.tenant_id=$1 AND a.category=$3`, [tenantId, field, curated[1]]);
    if (!r.rowCount) throw new HttpError(400, "The selected branding attachment is missing.");
    return store(c, tenantId, (await privateFile(r.rows[0].object_key).download())[0], r.rows[0].content_type);
  }
  const image = await remoteImage(url);
  return store(c, tenantId, image.bytes, image.type);
}
export async function publishAssets(c: DatabaseClient, tenantId: string, config: SiteSnapshotConfig) {
  const copy = structuredClone(config);
  // Only asset URL fields in this strictly public schema are visited.
  const visit = async (value: unknown): Promise<void> => {
    if (Array.isArray(value)) { for (const entry of value) await visit(entry); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if ((key === "logoUrl" || key === "faviconUrl") && typeof item === "string" && item) {
        const asset = await selectedAsset(c, tenantId, config.site.tenantSlug, item);
        const bytes = (await privateFile(asset.object_key).download())[0];
        if (createHash("sha256").update(bytes).digest("hex") !== asset.checksum)
          throw new HttpError(409, "The selected asset failed its checksum. Upload it again; nothing was released.");
        const objectKey = `public-assets/${tenantId}/${asset.checksum}.${asset.extension}`;
        try { await privateFile(objectKey).save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: asset.content_type, cacheControl: "public,max-age=31536000,immutable" } }); }
        catch (error) {
          // An existing immutable object is acceptable only if its authenticated bytes match.
          const stored = (await privateFile(objectKey).download())[0];
          if (createHash("sha256").update(stored).digest("hex") !== asset.checksum) throw error;
        }
        await c.query("UPDATE tenant_release_assets SET published_at=coalesce(published_at,now()) WHERE id=$1 AND tenant_id=$2", [asset.id, tenantId]);
        (value as Record<string, unknown>)[key] = `/api/public/release-assets/${tenantId}/${asset.checksum}.${asset.extension}`;
      } else await visit(item);
    }
  };
  await visit(copy);
  return copy;
}
export async function releasedAsset(tenantId: string, name: string) {
  if (!/^[a-f0-9-]{36}$/.test(tenantId) || !/^[a-f0-9]{64}\.(png|jpg|svg|webp|gif|ico)$/.test(name)) throw new HttpError(404, "Asset not found.");
  return withDatabase({ actorId: "public-release-asset", tenantId }, async c => {
    const r = await c.query("SELECT content_type FROM tenant_release_assets WHERE tenant_id=$1 AND checksum=$2 AND extension=$3 AND published_at IS NOT NULL", [tenantId, name.split(".")[0], name.split(".")[1]]);
    if (!r.rowCount) throw new HttpError(404, "Asset not found.");
    return { file: privateFile(`public-assets/${tenantId}/${name}`), contentType: r.rows[0].content_type as string };
  });
}

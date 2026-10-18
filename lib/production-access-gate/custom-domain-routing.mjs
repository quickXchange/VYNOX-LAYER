/**
 * Only an authoritative public API read may authorize a customer hostname.
 * Never trust a slug, tenant id or "verified" header supplied by the visitor.
 * Private/platform administration remains on the platform hostname.
 */
export function requestHostname(req) {
  const raw = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
  const host = (Array.isArray(raw) ? raw[0] : raw).split(",")[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(?::[0-9]+)?$/.test(host)) return null;
  return host.split(":")[0].replace(/\.$/, "");
}
export function isPublicDomainLookup(pathname) {
  return /^\/api\/public\/domains\/[a-z0-9.-]+(?:\/hosting-proof\/[a-f0-9]{48})?$/.test(pathname);
}
export function customWebsitePathAllowed(pathname, slug) {
  return pathname === "/" || pathname === `/private-label-website/${slug}` ||
    pathname.startsWith(`/private-label-website/${slug}/`) ||
    pathname.startsWith("/private-label-website/assets/") ||
    pathname === "/api/public/site-config" || /^\/api\/public\/release-assets\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(png|jpg|svg|webp|gif|ico)$/.test(pathname) ||
    pathname === `/api/public/sites/${slug}` || pathname.startsWith(`/api/public/sites/${slug}/`) ||
    pathname.startsWith("/api/public/domains/");
}
export async function resolveCustomerHost(req, env, fetcher = fetch) {
  if (!env.QXLAYER_PLATFORM_URL) return null;
  let platform;
  try { platform = new URL(env.QXLAYER_PLATFORM_URL); } catch { return null; }
  if (platform.protocol !== "https:") return null;
  const hostname = requestHostname(req);
  const platformHosts = new Set([platform.hostname, ...(env.QXLAYER_PLATFORM_HOSTS ?? "").split(",").map(s => s.trim())]);
  if (!hostname || platformHosts.has(hostname) || hostname.endsWith(".replit.dev") || hostname === "localhost" ||
    /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostname)) return null;
  try {
    const result = await fetcher(`${platform.origin}/api/public/domains/${encodeURIComponent(hostname)}`,
      { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(4000) });
    if (!result.ok) return null;
    const site = await result.json();
    if (site.domain !== hostname || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site.tenantSlug) || site.tenantSlug.length > 48) return null;
    return { hostname, slug: site.tenantSlug };
  } catch { return null; } // No authority means no bypass.
}

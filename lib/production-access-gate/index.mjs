import { createHash, createHmac, randomBytes, timingSafeEqual, scryptSync } from "node:crypto";
import { resolveCustomerHost, customWebsitePathAllowed, isPublicDomainLookup } from "./custom-domain-routing.mjs";
import { deliveredSiteSlug, isDeliveryLookup, isWebsiteAsset, resolveDeliveredSite } from "./delivered-site-routing.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ACCESS_PAGE_SCRIPT, renderAccessPage } from "./page.mjs";

const SESSION_COOKIE = "__Host-qxlayer-access";
const CSRF_COOKIE = "__Host-qxlayer-access-form";
const WINDOW_MS = 15 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;
const hash = (s) => createHash("sha256").update(s).digest();
const equal = (a, b) => timingSafeEqual(hash(a), hash(b));

function logo(mode = "light") {
  for (const root of [process.cwd(), path.resolve(process.cwd(), "../..")]) {
    try {
      return `data:image/png;base64,${readFileSync(path.join(root, `artifacts/private-label-console/public/qxlayer-logo-${mode}.png`)).toString("base64")}`;
    } catch { /* Try the workspace root next. */ }
  }
  return "";
}
function embeddedFont(file) {
  for (const root of [process.cwd(), path.resolve(process.cwd(), "../..")]) {
    try {
      return `data:font/woff2;base64,${readFileSync(path.join(root, "lib/production-access-gate/assets", file)).toString("base64")}`;
    } catch { /* Use the same safe system fallback if assets are unavailable. */ }
  }
  return "";
}

export function gateEnabled(env = process.env) {
  return env.PRODUCTION_ACCESS_GATE_ENABLED !== "false" &&
    (env.NODE_ENV === "production" || env.PRODUCTION_ACCESS_GATE_ENABLED === "true");
}

function safeReturn(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") &&
    !/[\u0000-\u0020\\]/.test(value) && !/^\/__qx_access(?:\/|$)/.test(value)
    ? value : "/";
}

/** Shared by both web servers and the API. Never import into browser code. */
export function createAccessGate({ env = process.env, basePath = "/", healthPath, now = Date.now, deliveredSite } = {}) {
  const enabled = gateEnabled(env);
  const staging = env.QXLAYER_EXTERNAL_ENVIRONMENT === "staging";
  // The stable, exact runtime origin identifies acceptance on both hosts.
  // The build-time approval flag is intentionally not a Vercel runtime secret.
  const acceptance = env.QXLAYER_EXTERNAL_ENVIRONMENT === "production" &&
    env.QXLAYER_PLATFORM_URL === "https://qxlayer-acceptance-vynox3.vercel.app";
  // Staging never falls back to the Production credential or signing realm.
  const code = staging
    ? (/^[A-Za-z0-9_-]{43,128}$/.test(env.QXLAYER_STAGING_ACCESS_CODE ?? "") ? env.QXLAYER_STAGING_ACCESS_CODE : undefined)
    : env.PRODUCTION_ACCESS_CODE;
  // Explicit Staging-only password verification; never use a Production fallback.
  // The strong Staging code remains the independent cookie-signing secret.
  const ownerPassword = staging && env.QXLAYER_STAGING_ACCESS_MODE === "owner-password";
  const verifier = ownerPassword &&
    /^scrypt-v1\$[A-Za-z0-9_-]{43}\$[A-Za-z0-9_-]{43}$/.test(env.QXLAYER_STAGING_OWNER_PASSWORD_VERIFIER ?? "")
    ? env.QXLAYER_STAGING_OWNER_PASSWORD_VERIFIER.split("$") : null;
  const authReady = !!code && (!staging || !env.QXLAYER_STAGING_ACCESS_MODE ||
    (ownerPassword && !!verifier));
  const passwordMatches = (candidate) => ownerPassword
    ? !!verifier && timingSafeEqual(scryptSync(candidate, Buffer.from(verifier[1], "base64url"), 32),
      Buffer.from(verifier[2], "base64url"))
    : equal(candidate, code);
  const sessionMs = staging ? 7 * 24 * 60 * 60 * 1000 : SESSION_MS;
  const sessionCookie = staging ? "__Host-qxlayer-staging-access" : SESSION_COOKIE;
  const csrfCookie = staging ? "__Host-qxlayer-staging-form" : CSRF_COOKIE;
  // Domain-separated signing key: changing the code revokes all existing access.
  const key = authReady ? createHmac("sha256", code)
    .update(staging ? "qxlayer-staging-access-v1" : "qxlayer-production-access-v1")
    // Bind Staging sessions to the selected password verifier, so changing
    // authentication mode/password revokes earlier sessions without touching Replit.
    .update(ownerPassword ? `\0${env.QXLAYER_STAGING_OWNER_PASSWORD_VERIFIER}` : "")
    .digest() : null;
  const brandLogo = logo();
  const darkBrandLogo = logo("dark");
  const fontSans = embeddedFont("bricolage-grotesque.woff2");
  const fontMono = embeddedFont("spline-sans-mono.woff2");
  const pageScriptHash = createHash("sha256").update(ACCESS_PAGE_SCRIPT).digest("base64");
  const endpoint = `${basePath.replace(/\/$/, "")}/__qx_access/enter`;
  const attempts = new Map();
  let globalAttempts = { count: 0, until: 0 };
  const sign = (payload) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
  };
  const verify = (token, purpose) => {
    if (!key || typeof token !== "string" || token.length > 2048) return null;
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra || !equal(signature, createHmac("sha256", key).update(body).digest("base64url"))) return null;
    try {
      const data = JSON.parse(Buffer.from(body, "base64url").toString());
      return data.purpose === purpose && Number.isFinite(data.exp) && data.exp > now() &&
        data.exp <= now() + (purpose === "access" ? sessionMs : WINDOW_MS) ? data : null;
    } catch { return null; }
  };
  const cookies = (req) => Object.fromEntries(
    (req.headers.cookie ?? "").split(";").map((s) => s.trim().split(/=(.*)/s).slice(0, 2)),
  );
  const cookie = (name, value) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict`;
  const headers = (res) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    // Chrome navigation/form POSTs can send Origin:null under no-referrer.
    // Keep same-origin attribution without leaking referrers to other sites.
    res.setHeader("Referrer-Policy", staging || acceptance ? "same-origin" : "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Only the immutable theme script may execute; no scripts from user input,
    // inline handlers, external origins or access-code interpolation are allowed.
    res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'sha256-${pageScriptHash}'; style-src 'unsafe-inline'; font-src data:; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'self'`);
  };
  const screen = (req, res, status = 200, message = "", returnTo = req.url) => {
    headers(res);
    res.statusCode = status;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Mobile back/forward and another tab must not invalidate a still-valid form.
    // Production keeps its original per-page, session-cookie behavior.
    const existing = staging ? cookies(req)[csrfCookie] : undefined;
    const existingData = staging ? verify(existing, "form") : null;
    const csrf = existingData ? existing :
      key ? sign({ purpose: "form", exp: now() + WINDOW_MS, nonce: randomBytes(24).toString("base64url") }) : "";
    if (csrf) {
      const expiry = existingData?.exp ?? now() + WINDOW_MS;
      res.setHeader("Set-Cookie", cookie(csrfCookie, csrf) +
        (staging ? `; Max-Age=${Math.max(1, Math.floor((expiry - now()) / 1000))}` : ""));
    }
    res.end(renderAccessPage({
      logoLight: brandLogo, logoDark: darkBrandLogo, fontSans, fontMono, endpoint, csrf,
      returnTo: safeReturn(returnTo), message, staging, ownerPassword,
    }));
  };
  const reject = (req, res, status) => {
    headers(res);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Production access required." }));
  };
  return async function accessGate(req, res, next) {
    const pathname = new URL(req.url ?? "/", "https://local.invalid").pathname;
    // Authoritative verified/delivered-domain reads reveal public branding only.
    // They never reveal drafts, account records, permissions or private previews.
    if (["GET", "HEAD"].includes(req.method) && isPublicDomainLookup(pathname)) return next();
    if (["GET", "HEAD"].includes(req.method) && isDeliveryLookup(pathname)) return next();
    if (isWebsiteAsset(pathname, req.method)) return next();
    const customerHost = await resolveCustomerHost(req, env);
    if (customerHost) {
      if (pathname === "/api/public/site-config") {
        const q = new URL(req.url, "https://local.invalid").searchParams;
        if (q.get("slug") !== customerHost.slug && q.get("host") !== customerHost.hostname) {
          res.statusCode = 404; res.end("Website not available."); return;
        }
      }
      if (!customWebsitePathAllowed(pathname, customerHost.slug)) {
        res.statusCode = 404; res.end("Website not available."); return;
      }
      if (pathname === "/" && ["GET", "HEAD"].includes(req.method)) {
        res.statusCode = 303;
        res.setHeader("Location", `/private-label-website/${customerHost.slug}`);
        res.setHeader("Cache-Control", "no-store");
        res.end(); return;
      }
      // Public routes still enforce state, entitlements and tracking tokens.
      // Platform authentication and tenant administration are never bypassed.
      return next();
    }
    const configSlug = pathname === "/api/public/site-config" ? new URL(req.url, "https://local.invalid").searchParams.get("slug") : null;
    const publicSlug = deliveredSiteSlug(pathname) || (configSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configSlug) && configSlug.length <= 48 ? configSlug : null);
    // This narrow immutable-image route independently checks publication,
    // operational state and customer delivery in the API. Never draft uploads.
    if (["GET", "HEAD"].includes(req.method) && /^\/api\/public\/release-assets\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(png|jpg|svg|webp|gif|ico)$/.test(pathname)) return next();
    if (enabled && publicSlug &&
      (["GET", "HEAD"].includes(req.method) || (req.method === "POST" && pathname.startsWith(`/api/public/sites/${publicSlug}/`))) &&
      await (deliveredSite ? deliveredSite(publicSlug) : resolveDeliveredSite(publicSlug, env))) return next();
    if (!enabled) return next();
    // An exact, minimal liveness response only; never expose application health data.
    if (healthPath && pathname === healthPath && (req.method === "GET" || req.method === "HEAD")) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.end('{"status":"ok"}');
      return;
    }
    const jar = cookies(req);
    // Acceptance form POSTs must terminate here even with an existing session.
    // Falling through sends the form into unrelated account-authentication routes.
    const entering = pathname === endpoint && req.method === "POST";
    if (verify(jar[sessionCookie], "access") && !(acceptance && entering)) {
      if (staging && pathname === endpoint && req.method === "POST") {
        headers(res);
        res.statusCode = 303; res.setHeader("Location", "/"); res.end(); return;
      }
      res.setHeader("Cache-Control", "no-store, private");
      return next();
    }
    if (entering && key) {
      // Use the actual peer, not attacker-supplied forwarded IP headers.
      // Limits are intentionally process-local and include an aggregate safety cap.
      for (const [ip, entry] of attempts) if (entry.until <= now()) attempts.delete(ip);
      if (globalAttempts.until <= now()) globalAttempts = { count: 0, until: now() + WINDOW_MS };
      const ip = req.socket.remoteAddress ?? "unknown";
      let entry = attempts.get(ip);
      if (!entry) { entry = { count: 0, until: now() + WINDOW_MS }; attempts.set(ip, entry); }
      if (entry.count >= 10 || globalAttempts.count >= 100 || attempts.size > 10000) {
        res.setHeader("Retry-After", String(Math.ceil((entry.until - now()) / 1000)));
        return screen(req, res, 429, "Too many attempts. Please try again later.", "/");
      }
      entry.count++; globalAttempts.count++;
      const origin = req.headers.origin;
      if (staging || acceptance) {
        // The protected form posts to its own Vercel function. Use the pinned
        // provider origin, never an external rewrite or attacker-forwarded host.
        try {
          const expected = new URL(env.QXLAYER_PLATFORM_URL);
          if (!origin || origin === "null" || expected.protocol !== "https:" ||
              origin !== expected.origin || req.headers["sec-fetch-site"] === "cross-site")
            return screen(req, res, 403, "Please try again from this website.");
        } catch { return screen(req, res, 403, "Please try again from this website."); }
      }
      // A sandboxed Development preview can send an opaque ("null") origin.
      // Such forms still MUST pass the signed double-submit token below.
      if (!staging && !acceptance && origin && origin !== "null") {
        try {
          // Replit's ingress uses an internal Host header; the original public
          // domain is forwarded. CSRF is independently enforced by the signed,
          // HttpOnly double-submit token below (not by trusting this header).
          const forwarded = req.headers["x-forwarded-host"];
          const publicHost = env.QXLAYER_DATABASE_PROVIDER === "supabase"
            ? new URL(env.QXLAYER_PLATFORM_URL).host
            : (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || req.headers.host;
          if (new URL(origin).host !== publicHost) return screen(req, res, 403, "Please try again from this website.");
        } catch { return screen(req, res, 403, "Please try again from this website."); }
      }
      if (!req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) return screen(req, res, 400, "Invalid access code");
      let body = "";
      try {
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 8192) { return screen(req, res, 413, "Invalid access code"); }
        }
      } catch { return reject(req, res, 400); }
      const form = new URLSearchParams(body);
      const csrf = form.get("csrf");
      const returnTo = safeReturn(form.get("returnTo"));
      if (!csrf || !jar[csrfCookie] || !equal(csrf, jar[csrfCookie]) || !verify(csrf, "form")) {
        return screen(req, res, 403, "Please try again from this website.", returnTo);
      }
      if (!passwordMatches(form.get("accessCode") ?? "")) return screen(req, res, 401,
        ownerPassword ? "Invalid access password" : "Invalid access code", returnTo);
      headers(res);
      res.setHeader("Set-Cookie", [
        cookie(sessionCookie, sign({ purpose: "access", exp: now() + sessionMs, nonce: randomBytes(24).toString("base64url") })) +
          (staging ? `; Max-Age=${sessionMs / 1000}` : ""),
        `${cookie(csrfCookie, "")}; Max-Age=0`,
      ]);
      res.statusCode = 303;
      res.setHeader("Location", returnTo);
      res.end();
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && req.headers.accept?.includes("text/html")) {
      return screen(req, res, key ? 200 : 503, key ? "" : "Private access is temporarily unavailable.");
    }
    return reject(req, res, key ? 403 : 503);
  };
}

export function accessGateVitePlugin() {
  return {
    name: "qxlayer-server-access-gate",
    configureServer(server) {
      const gate = createAccessGate({ basePath: server.config.base });
      server.middlewares.use((req, res, next) => {
        // Development-only visual preview, with no access-granting endpoint.
        if (!gateEnabled() && req.url === "/__qx_access/preview") {
          const preview = createAccessGate({ env: { NODE_ENV: "production" } });
          req.headers.accept = "text/html";
          return preview(req, res, next);
        }
        return gate(req, res, next);
      });
    },
  };
}

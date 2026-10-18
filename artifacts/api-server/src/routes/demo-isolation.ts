import { Router } from "express";
import { createHash } from "node:crypto";
import {
  CreateSandboxQuoteBody, CreateSandboxQuoteResponse, CreateSandboxOrderBody, CreateSandboxOrderResponse,
  TrackSandboxOrderResponse, GetCurrentPrincipalResponse, GetTenantSubscriptionResponse,
  GetTenantProviderFoundationResponse, ListExchangeOrdersQueryParams,
  GetDomainVerificationResponse, GetExchangePreviewIntegrationsResponse,
  ListEntitlementDefinitionsResponse,
} from "@workspace/api-zod";
import { DEMO_SLUG } from "../modules/demo/identity";
import { DEMO_TENANT_ID, DEMO_DATE, demoSite, demoTenant, demoSettings, demoCatalog, demoPublicExchange, demoConfiguration, demoOrders, demoFeatures } from "../modules/demo/fixture";
import { demoPrincipal, assertDemoRequest } from "../modules/demo/session";
import { signProof, readProof } from "../lib/scoped-proof";
import { calculateQuote } from "../products/exchange/calculation";
import { statusesForOrderView } from "../products/exchange/order-views";
import { HttpError } from "../lib/errors";
import { sameOriginMutation } from "../middlewares/authentication";

const router = Router();
const publicRoot = `/public/sites/${DEMO_SLUG}`;
const bursts = new Map<string, { count: number; until: number }>();
function boundDemoTraffic(ip: string) {
  const now = Date.now();
  for (const [key, v] of bursts) if (v.until <= now) bursts.delete(key);
  const b = bursts.get(ip) ?? { count: 0, until: now + 60000 };
  if (++b.count > 150 || (!bursts.has(ip) && bursts.size >= 5000)) throw new HttpError(429, "Demo traffic limit reached. Please try again in a minute.");
  bursts.set(ip, b);
}
// Terminal isolation layer BEFORE all database-backed routes. No demo request
// can fall through into a real tenant, customer, credential or provider service.
router.use(async (req, res, next) => {
  let path: string;
  try { path = decodeURIComponent(req.path); } catch { throw new HttpError(400, "Invalid demo path."); }
  if (path === "/demo/session") { next(); return; }
  const isPublic = path === publicRoot || path.startsWith(`${publicRoot}/`);
  const isDemo = req.get("x-qx-demo") === "read-only";
  if (!isPublic && !isDemo) { next(); return; }
  boundDemoTraffic(req.ip ?? "unknown");
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (isDemo) {
    const principal = await demoPrincipal(req);
    if (!principal) throw new HttpError(401, "Open the Admin Demo first.");
    assertDemoRequest(principal, req);
  }
  if (isPublic) {
    if (req.method === "GET" && path === publicRoot) { res.json(demoSite); return; }
    if (req.method === "GET" && path === `${publicRoot}/exchange`) { res.json(demoPublicExchange); return; }
    if (req.method === "POST") {
      if (req.get("x-qx-website-preview") !== undefined || req.query.preview !== undefined) {
        throw new HttpError(403, "Private website previews are read-only. Quotes and orders are disabled.");
      }
      let admitted = false;
      sameOriginMutation(req, res, () => { admitted = true; });
      if (!admitted) return;
      if (path === `${publicRoot}/exchange/quotes`) {
        const calculated = calculateQuote(demoSettings, demoCatalog, CreateSandboxQuoteBody.parse(req.body));
        const expiresAt = Date.now() + 120000;
        const token = signProof("fictional-demo-quote", { quote: calculated.quote, paymentMethod: calculated.paymentMethod,
          createdAt: new Date().toISOString(), expiresAt, tenantId: DEMO_TENANT_ID });
        res.json(CreateSandboxQuoteResponse.parse({ ...calculated.quote, token, expiresAt: new Date(expiresAt).toISOString() })); return;
      }
      if (path === `${publicRoot}/exchange/orders`) {
        const input = CreateSandboxOrderBody.parse(req.body);
        const frozen = readProof("fictional-demo-quote", input.quoteToken);
        if (!frozen || frozen.tenantId !== DEMO_TENANT_ID || typeof frozen.expiresAt !== "number" ||
          frozen.expiresAt <= Date.now() || frozen.expiresAt > Date.now() + 120000) throw new HttpError(409, "Demo quote expired. Request another quote.");
        const hex = createHash("sha256").update(`${input.quoteToken}:${input.idempotencyKey}`).digest("hex");
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
        const order = { ...(frozen.quote as object), id, status: "pending", paymentMethod: frozen.paymentMethod,
          createdAt: frozen.createdAt, history: [{ status: "pending", at: frozen.createdAt,
            note: "Browser-held demo snapshot only. Never saved; no provider or financial execution." }] };
        const trackingToken = signProof("fictional-demo-tracking", { order, expiresAt: Date.now() + 30 * 60000 });
        res.status(201).json(CreateSandboxOrderResponse.parse({ order, trackingToken })); return;
      }
    }
    if (req.method === "GET" && path.startsWith(`${publicRoot}/exchange/orders/`)) {
      const tracked = readProof("fictional-demo-tracking", req.get("trackingToken"));
      const order = tracked?.order as { id?: string } | undefined;
      if (!order || order.id !== path.split("/").at(-1) || typeof tracked?.expiresAt !== "number" ||
        tracked.expiresAt <= Date.now() || tracked.expiresAt > Date.now() + 30 * 60000) throw new HttpError(404, "Demo snapshot expired or unavailable.");
      res.json(TrackSandboxOrderResponse.parse(order)); return;
    }
    throw new HttpError(403, "This isolated demo cannot access account data or persistent operations.");
  }
  const principal = await demoPrincipal(req);
  if (!principal) throw new HttpError(401, "Open the Admin Demo first.");
  assertDemoRequest(principal, req);
  // Public, curated visual assets are the ONLY allowed fall-through.
  if (path === "/exchange/visual-catalog" || /^\/exchange\/visual-assets\/[a-zA-Z0-9_.-]+$/.test(path)) { next(); return; }
  const root = `/tenants/${DEMO_TENANT_ID}`;
  if (path === "/asset-networks") { res.json(demoCatalog); return; }
  if (path === "/entitlement-definitions") {
    res.json(ListEntitlementDefinitionsResponse.parse(Object.keys(demoFeatures).map(key => ({
      key, label: key.replaceAll("_", " "), kind: "feature", valueType: "boolean",
    })))); return;
  }
  if (path === "/me") {
    res.json(GetCurrentPrincipalResponse.parse({ ...principal, tenantId: DEMO_TENANT_ID, email: null, sandboxOnly: true })); return;
  }
  if (path === "/tenants") { res.json([demoTenant]); return; }
  if (path === root) { res.json(demoTenant); return; }
  if (path === `${root}/exchange`) { res.json(demoConfiguration); return; }
  if (path === `${root}/domain-verification`) {
    res.json(GetDomainVerificationResponse.parse({ domain: null, status: "unconfigured",
      txtName: null, txtValue: null, hostingConnected: false, httpsReady: false,
      hostingCheckedAt: null, hostingError: null, websiteUrl: null, instructions: [],
      hostingProvider: "replit", providerManagementAvailable: false,
      activationAvailable: false, activationApproved: false, approvedDeploymentId: null,
      activationApprovedAt: null, siteReleased: false, providerBindingVerified: false,
      providerBindingCheckedAt: null, providerRegistered: false, providerVerified: false,
      providerCheckedAt: null, providerError: null, dnsRecords: [] })); return;
  }
  if (path === `${root}/exchange/preview-integrations`) {
    res.json(GetExchangePreviewIntegrationsResponse.parse({ sandboxOnly: true, executionStatus: "configuration_only",
      settings: { api: { enabled: false, label: "", baseUrl: "" },
        webhooks: { enabled: false, label: "", endpointUrl: "", events: [] },
        rpc: { enabled: false, label: "", endpointUrl: "", networkName: "" } } })); return;
  }
  if (path === `${root}/subscription`) {
    res.json(GetTenantSubscriptionResponse.parse({
      tenantId: DEMO_TENANT_ID, tenantStatus: "active", status: "active",
      plan: { id: "da000000-0000-4000-8000-000000000020", name: "Fictional sandbox demo", description: "No billing or execution",
        status: "enabled", currency: "USD", monthlyPrice: "0", yearlyPrice: "0", setupFee: "0",
        displayOrder: 0, billingLabel: "Demo only", entitlements: [], createdAt: DEMO_DATE, updatedAt: DEMO_DATE },
      addons: [], overrides: [], features: demoFeatures, limits: {}, sources: {}, usage: [], enabledModules: demoTenant.enabledModules, overLimit: false,
    })); return;
  }
  if (path === `${root}/exchange/dashboard`) {
    res.json({ enabled: true, total: 4, pending: 1, processing: 1, completed: 1, cancelled: 1, failed: 0,
      assets: 3, networks: 2, routes: 18, customers: 0, paymentMethods: 2, volume: [], recentOrders: demoOrders }); return;
  }
  if (path === `${root}/exchange/orders`) {
    const query = ListExchangeOrdersQueryParams.parse(req.query);
    for (const date of [query.from, query.to]) if (date && (!Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)) throw new HttpError(400, "Use valid calendar dates in YYYY-MM-DD format.");
    if (query.from && query.to && query.from > query.to) throw new HttpError(400, "Start date must not be after end date.");
    const group = statusesForOrderView(query.view);
    const orders = demoOrders.filter(o => (!query.action || o.action === query.action) && (!query.status || o.status === query.status) &&
      (!group || group.includes(o.status)) && (!query.from || o.createdAt.toISOString().slice(0, 10) >= query.from) &&
      (!query.to || o.createdAt.toISOString().slice(0, 10) <= query.to) &&
      (!query.search || [o.id, o.sourceSymbol, o.destinationSymbol].some(v => v.toLowerCase().includes(query.search!.toLowerCase()))));
    const page = query.page ?? 1, pageSize = 25;
    res.json({ orders: orders.slice((page - 1) * pageSize, page * pageSize), total: orders.length, page, pageSize }); return;
  }
  if (path.startsWith(`${root}/exchange/orders/`)) {
    const order = demoOrders.find(o => o.id === path.split("/").at(-1));
    if (!order) throw new HttpError(404, "Showcase order not found.");
    res.json(order); return;
  }
  if (path === `${root}/exchange/customers` || path === `${root}/resources/staff` || path === "/activity") { res.json([]); return; }
  if (path === `${root}/exchange/audit`) { res.json({ events: [], total: 0, page: 1, pageSize: 50 }); return; }
  if (path === `${root}/provider-foundation`) {
    res.json(GetTenantProviderFoundationResponse.parse({ providers: [], assignments: [], policies: [], activity: [],
      categories: [], capabilities: [], credentialStorageAvailable: false, executionEnabled: false })); return;
  }
  throw new HttpError(403, "Demo access is limited to fictional NovaX configuration. No customer, staff identity, secret or platform-owner data.");
});
export default router;

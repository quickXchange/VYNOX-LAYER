import { GetPublicSiteResponse, GetPublicExchangeResponse, GetTenantResponse, GetExchangeConfigurationResponse, SaveExchangeConfigurationBody, GetExchangeOrderResponse } from "@workspace/api-zod";
import { websiteSettings } from "../website/settings";
import { projectPublicExchangeConfiguration } from "../../products/exchange/public-configuration";
import { PROVIDER_CATALOG } from "../../products/exchange/providers";
import { calculateQuote } from "../../products/exchange/calculation";
import { DEMO_SLUG } from "./identity";

// Deliberately authored fictional presentation configuration, NOT a database
// export. The same schemas, projection, calculation and UI serve real tenants.
export const DEMO_TENANT_ID = "da000000-0000-4000-8000-000000000001";
export const DEMO_DATE = "2026-01-01T12:00:00.000Z";
export const demoFeatures = { website: true, crypto_exchange: true, swap: true, convert: true, buy: true, sell: true,
  merchant_api: false, api_keys: false, webhooks: false, crypto_payments: false };
export const demoCatalog = [
  { assetNetworkId: "btc:bitcoin-testnet", assetId: "btc", symbol: "BTC", name: "Bitcoin", networkId: "bitcoin-testnet", networkName: "Bitcoin Testnet", testnet: true },
  { assetNetworkId: "eth:ethereum-sepolia", assetId: "eth", symbol: "ETH", name: "Ethereum", networkId: "ethereum-sepolia", networkName: "Ethereum Sepolia", testnet: true },
  { assetNetworkId: "usdt:ethereum-sepolia", assetId: "usdt", symbol: "USDT", name: "Tether", networkId: "ethereum-sepolia", networkName: "Ethereum Sepolia", testnet: true },
];
const methods = ["da000000-0000-4000-8000-000000000011", "da000000-0000-4000-8000-000000000012"];
const rates: Record<string, number> = { "fiat:USD": 1, "btc:bitcoin-testnet": 60000, "eth:ethereum-sepolia": 3000, "usdt:ethereum-sepolia": 1 };
const routes = (["swap", "convert", "buy", "sell"] as const).flatMap(action => {
  const endpoints = demoCatalog.map(a => a.assetNetworkId);
  const sources = action === "swap" ? [...endpoints, "fiat:USD"] : action === "buy" ? ["fiat:USD"] : endpoints;
  const destinations = action === "swap" ? [...endpoints, "fiat:USD"] : action === "sell" ? ["fiat:USD"] : endpoints;
  return sources.flatMap(source => destinations.filter(d => d !== source &&
    (action !== "swap" || source.startsWith("fiat:") !== d.startsWith("fiat:"))).map(destination => ({
    action, source, destination, enabled: true, rate: (rates[source] / rates[destination]).toFixed(18),
    minimum: source === "fiat:USD" ? "20" : source.startsWith("usdt") ? "25" : "0.001",
    maximum: source === "fiat:USD" ? "5000" : source.startsWith("usdt") ? "10000" : "10",
    feeBps: 35, spreadBps: 50, fixedFee: "0", paymentMethodIds: ["swap", "buy", "sell"].includes(action) ? methods : [],
  })));
});
export const demoSettings = SaveExchangeConfigurationBody.parse({
  enabled: true, defaultAction: "swap", publicNote: "Isolated fictional demo. Illustrative rates only; no wallets, funds or connected providers.",
  fiatCurrency: "USD", fiatPlanRate: "1", actions: { swap: true, convert: true, buy: true, sell: true },
  assets: demoCatalog.map((c, i) => ({ assetId: c.assetId, symbol: c.symbol, enabled: true, decimals: c.symbol === "USDT" ? 6 : 8,
    displayOrder: i, logoUrl: null, sandboxPlanRate: String(rates[c.assetNetworkId]) })),
  networks: demoCatalog.map(c => ({ assetNetworkId: c.assetNetworkId, enabled: true, available: true,
    minimum: "0.00000001", maximum: "1000000", fee: "0", information: "Simulation only. No addresses or blockchain execution." })),
  routes: routes.map((r, i) => ({ ...r, id: `da000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}` })),
  paymentMethods: methods.map((id, i) => ({ id, label: i ? "Sandbox card simulation" : "Sandbox bank transfer",
    currency: "USD", enabled: true, buy: true, sell: true })),
});
export const demoPublicExchange = GetPublicExchangeResponse.parse(projectPublicExchangeConfiguration(demoSettings, demoCatalog, { features: demoFeatures, overLimit: false }, true));
export const demoSite = GetPublicSiteResponse.parse({
  tenantSlug: DEMO_SLUG, brandName: "NovaX Exchange", logoUrl: null, primaryColor: "#18263c", accentColor: "#5b7df6",
  themeMode: "system", domain: null, sandboxOnly: true, features: demoFeatures, assets: demoPublicExchange.assets,
  websiteSettings: websiteSettings("NovaX Exchange", {
    templateKey: "standard-exchange", sandboxLabel: "Sandbox Demo", heroTitle: "Your next exchange starts here.",
    heroSubtitle: "Swap, convert, buy and sell using the shared Master Exchange. No funds move and no customer records are used.",
    footerText: "NovaX · isolated fictional demo. No real payments, wallets or providers.",
    faq: [{ question: "Are these real transactions?", answer: "No. Calculations use the real sandbox engine, but demo orders are signed browser-held snapshots and never saved to the database." }],
  }),
});
export const demoTenant = GetTenantResponse.parse({
  id: DEMO_TENANT_ID, name: "NovaX Exchange", slug: DEMO_SLUG, brandName: demoSite.brandName, domain: null,
  status: "active", enabledModules: Object.keys(demoFeatures).filter(k => demoFeatures[k as keyof typeof demoFeatures]),
  provisioningStep: "ready", environment: "sandbox", createdAt: DEMO_DATE, logoUrl: null,
  primaryColor: demoSite.primaryColor, accentColor: demoSite.accentColor, themeMode: "system",
  defaultLanguage: "en", supportedLanguages: ["en"], assetNetworkIds: demoCatalog.map(c => c.assetNetworkId),
  exchangeEnabled: true, paymentsEnabled: false, allowGuestCheckout: false, configurationComplete: true,
  activationBlockers: [], exchangeProvisioned: true, websiteSettings: demoSite.websiteSettings,
});
export const demoConfiguration = GetExchangeConfigurationResponse.parse({
  configuration: demoSettings, catalog: demoCatalog, effectiveEnabled: true, providerCatalog: PROVIDER_CATALOG,
});
export const demoOrders = (["swap", "convert", "buy", "sell"] as const).map((action, i) => {
  const r = demoSettings.routes.find(r => r.action === action)!;
  const { quote, paymentMethod } = calculateQuote(demoSettings, demoCatalog, {
    action, source: r.source, destination: r.destination, amount: action === "buy" ? "250" : "0.025",
    ...(r.paymentMethodIds.length ? { paymentMethodId: r.paymentMethodIds[0] } : {}),
  });
  const status = ["completed", "processing", "pending", "cancelled"][i];
  return GetExchangeOrderResponse.parse({ ...quote, id: `da000000-0000-4000-8000-${String(i + 200).padStart(12, "0")}`,
    status, paymentMethod, createdAt: DEMO_DATE, history: [{ status, at: DEMO_DATE, note: "Fictional showcase; no execution or customer data." }] });
});

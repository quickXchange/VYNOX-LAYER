import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { SaveExchangeConfigurationBody } from "@workspace/api-zod";
import type { ExchangeSettings } from "@workspace/api-zod";
import type { Principal } from "../modules/authentication/service";
import { createTenant, getTenant, saveAssets, saveBrand, saveConfiguration, saveDomain, saveWebsiteSettings } from "../modules/tenants/service";
import { listPlans, savePlan } from "../modules/entitlements/catalog";
import { exchangeConfiguration } from "../products/exchange/service";
import { masterWebsiteDefaults } from "../products/exchange/master-template";
import { getTenantWebsitePreview, openTenantWebsitePreview } from "../modules/website/preview-service";
import { verifyPreview } from "../modules/website/operator-preview";

const APPROVAL_FLAG = "--approve-abracadabra-sandbox";
const ACTOR = "development-abracadabra-provisioner";
const TENANT_NAME = "Abracadabra Development Sandbox";
const BRAND_NAME = "Abracadabra";
const SLUG = "abracadabra-sandbox";
const PLAN_NAME = "Abracadabra Development Sandbox (Unpriced)";
const TEMPLATE_KEY = "standard-exchange";

if (process.env.NODE_ENV !== "development" || process.env.QXLAYER_EXTERNAL_ENVIRONMENT !== "development") {
  throw new Error("Abracadabra provisioning requires explicit Development mode and the Development data environment.");
}
if (!process.argv.includes(APPROVAL_FLAG)) {
  throw new Error(`Provisioning requires the explicit ${APPROVAL_FLAG} confirmation flag.`);
}

const operator: Principal = { userId: ACTOR, role: "super_admin", memberships: [] };

function sameEntitlements(actual: Array<{ key: string; value: boolean | string }>, expected: Array<{ key: string; value: boolean | string }>) {
  const normalize = (items: typeof actual) => items.map(({ key, value }) => [key, value] as const).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

const entitlements: Array<{ key: string; value: boolean | string }> = [
  { key: "website", value: true },
  { key: "crypto_exchange", value: true },
  { key: "swap", value: true },
  { key: "convert", value: true },
  { key: "buy", value: false },
  { key: "sell", value: false },
  { key: "crypto_payments", value: false },
  { key: "merchant_api", value: false },
  { key: "api_keys", value: false },
  { key: "webhooks", value: false },
  { key: "max_supported_assets", value: "2" },
  { key: "max_supported_networks", value: "2" },
  { key: "max_payment_methods", value: "1" },
  { key: "max_staff", value: "0" },
  { key: "max_api_keys", value: "0" },
  { key: "max_webhooks", value: "0" },
  { key: "max_monthly_transactions", value: "100" },
  { key: "max_monthly_volume", value: "10000" },
];

async function availablePlan() {
  const plans = await listPlans(operator);
  const existing = plans.find((plan) => plan.name === PLAN_NAME);
  if (existing) {
    if (existing.status !== "enabled" || existing.pricingConfigured || existing.currency !== "EUR" ||
        !sameEntitlements(existing.entitlements, entitlements)) {
      throw new Error("An Abracadabra Development plan exists with different or priced terms; refusing to change it.");
    }
    return existing;
  }
  return savePlan(operator, {
    name: PLAN_NAME,
    description: "Development-only Sandbox entitlements. No commercial price or billing is configured.",
    monthlyPrice: null,
    yearlyPrice: null,
    setupFee: null,
    currency: "EUR",
    billingLabel: "Development Sandbox · no billing",
    displayOrder: 9999,
    status: "enabled",
    entitlements,
  });
}

async function reviewedInputs() {
  const fiat = await pool.query(
    `SELECT id FROM global_exchange_catalog
      WHERE kind='currencies' AND id='EUR' AND status='enabled'`,
  );
  if (!fiat.rowCount) throw new Error("EUR is not enabled in the reviewed Exchange catalog.");

  const assets = await pool.query(
    `SELECT a.id AS "assetId",a.code AS symbol,a.name AS "assetName",
            n.id AS "networkId",n.name AS "networkName",
            l.metadata->>'legacyAssetNetworkId' AS "assetNetworkId",
            NULLIF(l.metadata->>'decimals','')::integer AS decimals
       FROM global_exchange_catalog_links l
       JOIN global_exchange_catalog a ON a.kind='assets' AND a.id=l.source_id
       JOIN global_exchange_catalog n ON n.kind='networks' AND n.id=l.target_id
       JOIN asset_network_catalog pair
         ON pair.id=l.metadata->>'legacyAssetNetworkId'
        AND pair.asset_id=a.id AND pair.network_id=n.id
      WHERE l.kind='asset_network' AND l.enabled AND l.verified
        AND a.status='enabled' AND n.status='enabled'
        AND n.metadata->>'testnet'='true'
      ORDER BY CASE a.code WHEN 'BTC' THEN 0 WHEN 'ETH' THEN 1 ELSE 2 END,a.code,n.name`,
  );
  const selected: typeof assets.rows = [];
  const usedAssets = new Set<string>();
  for (const row of assets.rows) {
    if (!row.assetNetworkId || usedAssets.has(row.assetId)) continue;
    selected.push(row);
    usedAssets.add(row.assetId);
    if (selected.length === 2) break;
  }
  if (selected.length !== 2) throw new Error("Two distinct, verified testnet assets are required; no tenant changes were made.");

  const methods = await pool.query(
    `SELECT m.id,m.name,m.metadata
       FROM global_exchange_catalog m
       JOIN global_exchange_catalog_links l
         ON l.kind='payment_fiat' AND l.source_id=m.id AND l.target_id='EUR'
        AND l.enabled AND l.verified
       JOIN global_exchange_catalog currency
         ON currency.kind='currencies' AND currency.id=l.target_id AND currency.status='enabled'
      WHERE m.kind='payment_methods' AND m.status='enabled' AND m.metadata->>'verified'='true'
      ORDER BY m.id`,
  );
  const method = methods.rows[0];
  if (!method) throw new Error("No verified, enabled payment method is mapped to EUR; no tenant changes were made.");
  return { selected, method, currency: "EUR" as const };
}

async function tenantHasOnlySandboxRecords(tenantId: string) {
  const counts = await pool.query(
    `SELECT
       EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=$1) AS has_memberships,
       EXISTS(SELECT 1 FROM white_label_requests WHERE tenant_id=$1) AS has_requests,
       EXISTS(SELECT 1 FROM exchange_orders WHERE tenant_id=$1) AS has_orders`,
    [tenantId],
  );
  const state = counts.rows[0];
  if (state.has_memberships || state.has_requests || state.has_orders) {
    throw new Error("Abracadabra has an account, request, or order attached; refusing to modify or deliver it.");
  }
  const ownerChanges = await pool.query(
    `SELECT 1 FROM audit_events
      WHERE tenant_id=$1 AND actor_id<>$2
        AND (event_type LIKE 'tenant.%' OR event_type LIKE 'exchange.%')
      LIMIT 1`,
    [tenantId, ACTOR],
  );
  if (ownerChanges.rowCount) {
    throw new Error("A separate operator has changed Abracadabra; refusing to overwrite their configuration.");
  }
}

function existingTenantReady(tenant: Awaited<ReturnType<typeof getTenant>>, config: ExchangeSettings, settings: ReturnType<typeof masterWebsiteDefaults>) {
  const actionsOnly = config.actions.swap && config.actions.convert && !config.actions.buy && !config.actions.sell;
  const routesOnly = config.routes.length === 2 &&
    config.routes.some((route) => route.action === "swap" && route.enabled) &&
    config.routes.some((route) => route.action === "convert" && route.enabled);
  return tenant.name === TENANT_NAME && tenant.brandName === BRAND_NAME && tenant.slug === SLUG &&
    tenant.status === "draft" && tenant.environment === "sandbox" && tenant.domain === null &&
    tenant.configurationComplete && actionsOnly && routesOnly && config.providers?.length === 0 &&
    config.paymentMethods.length === 1 &&
    tenant.websiteSettings.templateKey === settings.templateKey &&
    tenant.websiteSettings.heroSubtitle === settings.heroSubtitle;
}

async function verifyProtectedPreview(tenantId: string) {
  const link = await getTenantWebsitePreview(operator, tenantId);
  if (!link.url.endsWith(`/tenants/${tenantId}/website-preview/open`)) {
    throw new Error("The protected operator website-preview endpoint returned an unexpected URL.");
  }
  const opened = await openTenantWebsitePreview(operator, tenantId);
  const grant = verifyPreview(opened.token, SLUG, operator.userId);
  if (!grant || grant.tenantId !== tenantId || verifyPreview(opened.token, SLUG, "different-operator")) {
    throw new Error("The website preview token did not remain bound to the Abracadabra tenant and operator.");
  }
}

async function main() {
  const inputs = await reviewedInputs();
  const existing = await pool.query("SELECT id,name,status FROM tenants WHERE slug=$1", [SLUG]);
  let tenantId: string;
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.name !== TENANT_NAME || row.status !== "draft") {
      throw new Error("The Abracadabra Sandbox slug belongs to a different or activated tenant; refusing to modify it.");
    }
    const marker = await pool.query(
      "SELECT 1 FROM audit_events WHERE tenant_id=$1 AND actor_id=$2 AND event_type='tenant.created' LIMIT 1",
      [row.id, ACTOR],
    );
    if (!marker.rowCount) throw new Error("The Abracadabra slug was not created by this Development-only provisioning flow.");
    await tenantHasOnlySandboxRecords(row.id);
    tenantId = row.id;
  } else {
    const plan = await availablePlan();
    const tenant = await createTenant(operator, { name: TENANT_NAME, slug: SLUG, planId: plan.id });
    tenantId = tenant.id;
  }

  const current = await getTenant(operator, tenantId);
  const existingConfig = await exchangeConfiguration(operator, tenantId);
  const existingWebsite = masterWebsiteDefaults(BRAND_NAME);
  if (existingTenantReady(current, existingConfig.configuration, existingWebsite)) {
    await verifyProtectedPreview(tenantId);
    process.stdout.write(JSON.stringify({ tenantId, slug: SLUG, status: current.status, environment: current.environment, reused: true, customerAccountAssigned: false, protectedWebsitePreviewVerified: true, liveExecution: false }) + "\n");
    return;
  }

  // Never overwrite a partial Development tenant after another actor has changed it.
  await tenantHasOnlySandboxRecords(tenantId);
  const plan = await availablePlan();
  const selectedIds = inputs.selected.map((asset) => asset.assetNetworkId as string);
  await saveBrand(operator, tenantId, {
    brandName: BRAND_NAME,
    logoUrl: null,
    primaryColor: "#332b37",
    accentColor: "#cfad69",
    themeMode: "dark",
    defaultLanguage: "en",
    supportedLanguages: ["en"],
  });
  await saveDomain(operator, tenantId, null);
  const website = {
    ...existingWebsite,
    websiteName: BRAND_NAME,
    heroTitle: "Move between worlds.",
    heroSubtitle: "Swap crypto and fiat, or convert between supported digital assets. This protected Development preview uses the shared NovaX Exchange master.",
    footerText: "Abracadabra · Development Sandbox only. No real funds, payments, wallets, provider connections or blockchain execution.",
    termsContent: "Development Sandbox only. Swap and Convert rates and orders are simulations. Do not send funds or enter real financial credentials.",
    privacyContent: "This protected preview is for operator review. Do not enter personal information or real financial credentials.",
    faq: [
      { question: "Is Abracadabra live?", answer: "No. This protected Development Sandbox is not a public or Production exchange. It does not accept or transfer funds." },
      { question: "Which products are configured?", answer: "Crypto/Fiat Swap and Crypto/Crypto Convert only. Buy, Sell, payments and live provider connections are off." },
    ],
  };
  await saveWebsiteSettings(operator, tenantId, website);
  await saveDomain(operator, tenantId, null);
  await saveAssets(operator, tenantId, selectedIds);
  await saveConfiguration(operator, tenantId, {
    environment: "sandbox",
    exchangeEnabled: true,
    paymentsEnabled: false,
    allowGuestCheckout: false,
  });

  const catalog = (await exchangeConfiguration(operator, tenantId)).catalog;
  const pairByNetwork = new Map(catalog.map((asset) => [asset.assetNetworkId, asset]));
  const [firstId, secondId] = selectedIds;
  const first = pairByNetwork.get(firstId);
  const second = pairByNetwork.get(secondId);
  if (!first || !second || first.assetId === second.assetId) {
    throw new Error("The selected Exchange assets did not resolve to two distinct tenant catalog entries.");
  }
  const metadata = inputs.method.metadata as { requiredFields?: unknown };
  const requiredFields = Array.isArray(metadata.requiredFields) ? metadata.requiredFields.map(String) : [];
  const paymentMethodId = randomUUID();
  const paymentMethod: ExchangeSettings["paymentMethods"][number] = {
    id: paymentMethodId,
    label: "Sandbox-only manual review",
    instructions: "Development Sandbox only. Do not send funds. No payment provider is connected.",
    enabled: true,
    currency: inputs.currency,
    currencies: [inputs.currency],
    catalogId: inputs.method.id,
    accountFields: Object.fromEntries(requiredFields.map((field) => [field, "Development Sandbox only — not real account details"])),
    buy: false,
    sell: false,
    logoUrl: null,
    methodType: "manual",
    minimum: "0.01",
    maximum: "100",
    feeBps: 0,
    fixedFee: "0",
  };
  const swap = {
    id: randomUUID(),
    action: "swap" as const,
    source: firstId,
    destination: `fiat:${inputs.currency}`,
    enabled: true,
    rate: "1",
    minimum: "0.01",
    maximum: "100",
    feeBps: 0,
    spreadBps: 0,
    fixedFee: "0",
    paymentMethodIds: [paymentMethodId],
  };
  const convert = {
    id: randomUUID(),
    action: "convert" as const,
    source: firstId,
    destination: secondId,
    enabled: true,
    rate: "1",
    minimum: "0.01",
    maximum: "100",
    feeBps: 0,
    spreadBps: 0,
    fixedFee: "0",
    paymentMethodIds: [],
  };
  const config = SaveExchangeConfigurationBody.parse({
    enabled: true,
    defaultAction: "swap",
    publicNote: "Development Sandbox only. The 1:1 reference rates are illustrative, not live market quotes. No funds or payments are processed.",
    fiatCurrency: inputs.currency,
    fiatCurrencies: [inputs.currency],
    fiatPlanRate: "1",
    actions: { swap: true, convert: true, buy: false, sell: false },
    assets: [first, second].map((asset, displayOrder) => ({
      assetId: asset.assetId,
      symbol: asset.symbol,
      decimals: asset.decimals ?? 8,
      displayOrder,
      enabled: true,
      logoUrl: null,
      sandboxPlanRate: "1",
    })),
    networks: [first, second].map((asset) => ({
      assetNetworkId: asset.assetNetworkId,
      enabled: true,
      available: true,
      minimum: "0.01",
      maximum: "100",
      fee: "0",
      information: "Development Sandbox only. No deposits, wallets or blockchain execution.",
    })),
    routes: [swap, convert],
    defaultPairs: {
      swap: { source: swap.source, destination: swap.destination, paymentMethodId },
      convert: { source: convert.source, destination: convert.destination },
    },
    paymentMethods: [paymentMethod],
    providers: [],
  });
  await exchangeConfiguration(operator, tenantId, config);

  const ready = await getTenant(operator, tenantId);
  const saved = (await exchangeConfiguration(operator, tenantId)).configuration;
  if (!ready.configurationComplete || ready.status !== "draft" || !existingTenantReady(ready, saved, website)) {
    throw new Error(`Abracadabra was provisioned but did not pass readiness verification: ${ready.activationBlockers.join(" ") || "saved configuration differs from the approved two-product scope"}`);
  }
  const orderCount = await pool.query("SELECT count(*)::int AS count FROM exchange_orders WHERE tenant_id=$1", [tenantId]);
  if (Number(orderCount.rows[0].count) !== 0) throw new Error("Unexpected Exchange orders exist; manual review is required.");
  await verifyProtectedPreview(tenantId);
  process.stdout.write(JSON.stringify({
    tenantId,
    slug: SLUG,
    status: ready.status,
    environment: ready.environment,
    enabledActions: ["swap", "convert"],
    testnetAssets: [first.symbol, second.symbol],
    websiteTemplate: TEMPLATE_KEY,
    domain: null,
    customerAccountAssigned: false,
    requestLinked: false,
    ordersCreated: false,
    liveExecution: false,
    previewRequiresOperatorSession: true,
    protectedWebsitePreviewVerified: true,
  }) + "\n");
}

try {
  await main();
} finally {
  await pool.end();
}

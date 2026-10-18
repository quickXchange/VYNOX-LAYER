import { pool } from "@workspace/db";
import type { Principal } from "../modules/authentication/service";
import { createTenant, getTenant, saveAssets, saveBrand, saveConfiguration, saveWebsiteSettings } from "../modules/tenants/service";
import { listTenantAdministrators } from "../modules/tenants/administrators";
import { getPlan, savePlan, type PlanInput } from "../modules/entitlements/catalog";
import { getDomainVerification } from "../modules/domains/service";
import { websiteSettings } from "../modules/website/settings";

const TENANT_NAME = "Abracadabra";
const TENANT_SLUG = "abracadabra-demo";
const PLAN_NAME = "Abracadabra Internal Sandbox (No Commercial Pricing)";
const PLAN_DESCRIPTION =
  "Development-only review fixture. Not a customer offer or commercial price plan.";
const ASSET_NETWORKS = [
  "btc:bitcoin-mainnet",
  "eth:ethereum-mainnet",
  "imported-usdc:ethereum-mainnet",
];
const PLAN_ENTITLEMENTS = [
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
  { key: "max_supported_assets", value: "3" },
  { key: "max_supported_networks", value: "2" },
  { key: "max_payment_methods", value: "0" },
  { key: "max_staff", value: "0" },
  { key: "max_api_keys", value: "0" },
  { key: "max_webhooks", value: "0" },
  { key: "max_monthly_transactions", value: "0" },
  { key: "max_monthly_volume", value: "0" },
];

function requireDevelopmentWorkspace() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.QXLAYER_EXTERNAL_ENVIRONMENT !== "development" ||
    (process.env.QXLAYER_DATABASE_PROVIDER !== undefined &&
      process.env.QXLAYER_DATABASE_PROVIDER !== "replit")
  ) {
    throw new Error("Abracadabra provisioning is restricted to the Replit Development database.");
  }

  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  const matchesWorkspaceDatabase =
    databaseUrl.hostname === process.env.PGHOST &&
    decodeURIComponent(databaseUrl.pathname.slice(1)) === process.env.PGDATABASE &&
    decodeURIComponent(databaseUrl.username) === process.env.PGUSER;
  if (!matchesWorkspaceDatabase) {
    throw new Error("The configured database does not match the current Development workspace.");
  }
}

async function main() {
  requireDevelopmentWorkspace();
  const operator: Principal = {
    userId: "development-abracadabra-sandbox-bootstrap",
    role: "super_admin",
    memberships: [],
  };

  const planInput: PlanInput = {
    name: PLAN_NAME,
    description: PLAN_DESCRIPTION,
    monthlyPrice: null,
    yearlyPrice: null,
    setupFee: null,
    discountPercent: "0",
    currency: "EUR",
    billingLabel: "Internal Sandbox only — no commercial pricing",
    displayOrder: 99990,
    status: "enabled",
    entitlements: PLAN_ENTITLEMENTS,
  };
  const existingPlanRow = await pool.query("SELECT id FROM plans WHERE name=$1", [PLAN_NAME]);
  if (existingPlanRow.rowCount) {
    const previousPlan = await getPlan(operator, existingPlanRow.rows[0].id as string);
    if (
      previousPlan.name !== PLAN_NAME ||
      previousPlan.description !== PLAN_DESCRIPTION ||
      previousPlan.status !== "enabled" ||
      previousPlan.pricingConfigured
    ) {
      throw new Error(`Refusing to change the existing "${PLAN_NAME}" plan.`);
    }
  }
  const plan = await savePlan(
    operator,
    planInput,
    existingPlanRow.rows[0]?.id as string | undefined,
  );
  if (plan.pricingConfigured) {
    throw new Error("The internal Sandbox plan must not have commercial pricing configured.");
  }

  const existingTenant = await pool.query(
    `SELECT t.id,t.name,t.status,t.environment,t.live_release_id,s.plan_id,d.domain
     FROM tenants t
     LEFT JOIN tenant_subscriptions s ON s.tenant_id=t.id
     LEFT JOIN tenant_domains d ON d.tenant_id=t.id
     WHERE t.slug=$1`,
    [TENANT_SLUG],
  );
  let tenant: Awaited<ReturnType<typeof createTenant>>;
  if (existingTenant.rowCount) {
    const row = existingTenant.rows[0];
    const request = await pool.query(
      "SELECT 1 FROM white_label_requests WHERE tenant_id=$1 LIMIT 1",
      [row.id],
    );
    const administrators = await listTenantAdministrators(operator, row.id as string);
    if (
      row.name !== TENANT_NAME ||
      row.status !== "draft" ||
      row.environment !== "sandbox" ||
      row.live_release_id !== null ||
      row.domain !== null ||
      row.plan_id !== plan.id ||
      request.rowCount > 0 ||
      administrators.length > 0
    ) {
      throw new Error(`Refusing to alter tenant "${TENANT_SLUG}" outside its isolated draft setup.`);
    }
    tenant = await getTenant(operator, row.id as string);
  } else {
    tenant = await createTenant(operator, {
      name: TENANT_NAME,
      slug: TENANT_SLUG,
      planId: plan.id,
    });
  }

  await saveBrand(operator, tenant.id, {
    brandName: TENANT_NAME,
    logoUrl: null,
    primaryColor: "#211d2b",
    accentColor: "#cfad69",
    themeMode: "system",
    defaultLanguage: "en",
    supportedLanguages: ["en"],
  });
  await saveAssets(operator, tenant.id, ASSET_NETWORKS);
  await saveConfiguration(operator, tenant.id, {
    environment: "sandbox",
    exchangeEnabled: false,
    paymentsEnabled: false,
    allowGuestCheckout: false,
  });
  await saveWebsiteSettings(
    operator,
    tenant.id,
    websiteSettings(TENANT_NAME, {
      sandboxLabel: "Protected Sandbox Preview",
      heroTitle: "Move between worlds.",
      heroSubtitle:
        "Review the proposed Crypto / Fiat Swap and Crypto / Crypto Convert experience. No rates, quotes, payments, or orders are configured.",
      footerText:
        "Private Sandbox review only. No financial execution, real deposits, wallet connections, or payments.",
      termsContent:
        "Internal Development preview only. This tenant is a draft, and no Exchange transactions or payments are available.",
      privacyContent:
        "Do not enter personal, payment, or wallet information in this protected Sandbox preview.",
    }),
  );

  const verifiedTenant = await getTenant(operator, tenant.id);
  const domain = await getDomainVerification(operator, tenant.id);
  const administrators = await listTenantAdministrators(operator, tenant.id);
  if (
    verifiedTenant.status !== "draft" ||
    verifiedTenant.environment !== "sandbox" ||
    verifiedTenant.domain !== null ||
    verifiedTenant.exchangeEnabled ||
    verifiedTenant.paymentsEnabled ||
    verifiedTenant.allowGuestCheckout ||
    domain.status !== "unconfigured" ||
    administrators.length > 0
  ) {
    throw new Error("Abracadabra did not pass its draft, private, no-domain, no-payment safety checks.");
  }

  console.log(
    JSON.stringify({
      tenant: verifiedTenant.slug,
      environment: verifiedTenant.environment,
      status: verifiedTenant.status,
      hostname: "none",
      domainStatus: domain.status,
      exchangeEnabled: verifiedTenant.exchangeEnabled,
      paymentsEnabled: verifiedTenant.paymentsEnabled,
      guestCheckout: verifiedTenant.allowGuestCheckout,
      commercialPricingConfigured: plan.pricingConfigured,
      administratorAssignments: administrators.length,
      selectedAssetNetworks: verifiedTenant.assetNetworkIds.length,
      publicRelease: false,
    }),
  );
}

try {
  await main();
} finally {
  await pool.end();
}

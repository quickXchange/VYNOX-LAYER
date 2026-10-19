import { withDatabase, type DatabaseClient } from "@workspace/db";
import { UpdateLandingProductBody } from "@workspace/api-zod";
import type { z } from "zod";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { audit } from "../../lib/audit";
import { assertCatalogOperationAllowed, catalogTable } from "../../lib/catalog-scope";
import { HttpError } from "../../lib/errors";
import { discountedRecurring } from "../entitlements/commercial-pricing";
import { cents } from "../commerce/pricing";
import { publishedOffers } from "../commerce/pricing-publication";
import { defaultExploreContent, assertPublicArtworkUrl } from "./explore-content";

export type LandingProductInput = z.infer<typeof UpdateLandingProductBody>;
const projection = `key,visible,name,description,icon,starting_price AS "startingPrice",
  setup_fee AS "setupFee",currency,billing_period AS "billingPeriod",status,
  cta_label AS "ctaLabel",display_order AS "displayOrder",
  CASE WHEN key='crypto_exchange' THEN 'sandbox_only' ELSE 'planned' END AS readiness,
  (SELECT definition->'publicMarketing' FROM module_catalog WHERE module_catalog.key=landing_products.key) AS explore`;

function withExplore(product: any) {
  const defaults = defaultExploreContent(product.key, product.name, product.description);
  const stored = product.explore ?? {};
  const explore = { ...defaults, ...stored };
  // Upgrade the old generated presentation, not owner-authored copy. Once the
  // current editor saves explicit visibility/concept data, all choices win.
  if (!("sectionVisibility" in stored) && !("conceptVisual" in stored)) {
    if (product.key === "crypto_exchange") {
      const existing = stored.gallery ?? [];
      explore.gallery = [...existing, ...defaults.gallery.filter(m => !existing.some((x: {imageUrl:string}) => x.imageUrl === m.imageUrl))].slice(0,12);
    }
    if (Array.isArray(stored.features)) explore.features = stored.features.map((f: {title:string;body:string}) => {
      const old = product.key === "crypto_exchange"
        ? `${f.title} is presented in the branded Exchange sandbox. Availability is governed by the assigned plan and operator configuration; live financial execution remains disabled.`
        : `${f.title} is part of the planned ${product.name} experience. The interface is illustrative; delivery and integration are subject to implementation and operator review.`;
      return f.body === old ? defaults.features.find(x => x.title === f.title) ?? f : f;
    });
    if (product.key === "crypto_exchange" && stored.customerExperience === "A customer arrives on your branded domain, chooses an enabled exchange action, reviews a sandbox quote, creates an illustrative order and follows its status through payment instructions, completion and a branded invoice. This preview never moves funds.")
      explore.customerExperience = defaults.customerExperience;
  }
  // Parse only the public content contract; never expose the registry definition.
  const parsed = UpdateLandingProductBody.parse({ ...product, explore });
  return { ...product, explore: parsed.explore };
}

// Explicit public projection; execution readiness is server-owned, never marketing-editable.
export function publicProductCatalog() {
  return withDatabase({ actorId: "public:product-catalog" }, async (client) => {
    const products = (await client.query(`SELECT ${projection} FROM landing_products WHERE visible=true ORDER BY display_order,key`)).rows;
    // Marketing remains database-owned; no hardcoded commercial fallback.
    const published = await publishedOffers(client);
    const configured = published.plans.filter((p: any) => p.currency === "EUR").map((p: any) => ({monthly_price:p.monthlyPrice,yearly_price:p.yearlyPrice,setup_fee:p.setupFee,discount_percent:p.discountPercent,currency:p.currency,monthly:p.billingPeriods.includes("monthly")}));
    const offers = configured.map((p: any) => ({ ...p, price: discountedRecurring(p.monthly ? p.monthly_price : p.yearly_price, p.discount_percent), period: p.monthly ? "monthly" : "yearly" }))
      .sort((a: any,b: any) => BigInt(a.price.replace(".", "")) < BigInt(b.price.replace(".", "")) ? -1 :
        BigInt(a.price.replace(".", "")) > BigInt(b.price.replace(".", "")) ? 1 : 0);
    for (const product of products) if (product.key === "crypto_exchange") {
      const offer = offers[0];
      product.startingPrice = offer?.price ?? null; product.setupFee = offer?.setup_fee ?? null;
      product.currency = offer?.currency ?? "EUR"; product.billingPeriod = offer?.period ?? "on_request";
    }
    const catalog = { source: "database" as const, products: products.map(withExplore) };
    return catalog;
  });
}
export async function publicProducts() {
  return (await publicProductCatalog()).products;
}
export function listProducts(principal: Principal) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal), async (client) =>
    (await client.query(`SELECT ${projection} FROM landing_products ORDER BY display_order,key`)).rows.map(withExplore));
}
async function readProduct(client: DatabaseClient, key: string) {
  const result = await client.query(`SELECT ${projection} FROM landing_products WHERE key=$1`, [key]);
  if (!result.rows[0]) throw new HttpError(404, "Catalog product not found.");
  return withExplore(result.rows[0]);
}
export function saveProduct(principal: Principal, key: string, input: LandingProductInput) {
  assertCatalogOperationAllowed("shared marketing catalog changes");
  requireSuperAdmin(principal);
  const parsed = UpdateLandingProductBody.parse(input);
  const name = parsed.name.trim(), description = parsed.description.trim(), ctaLabel = parsed.ctaLabel.trim();
  if (parsed.explore) {
    assertPublicArtworkUrl(parsed.explore.heroImageUrl);
    for (const image of parsed.explore.gallery) assertPublicArtworkUrl(image.imageUrl);
  }
  if (name.length < 2 || description.length < 10 || ctaLabel.length < 2) {
    throw new HttpError(400, "Product name, description and CTA cannot be blank.");
  }
  return withDatabase(contextFor(principal, undefined, true), async (client) => {
    await client.query("SELECT key FROM landing_products WHERE key=$1 FOR UPDATE", [key]);
    const before = await readProduct(client, key);
    const selectedPlans = parsed.explore?.pricingTiers?.flatMap(t => t.planId ? [t.planId] : []) ?? [];
    if (new Set(selectedPlans).size !== selectedPlans.length)
      throw new HttpError(400, "Select a different existing plan for each pricing tier.");
    if (selectedPlans.length) {
      const found = await client.query(`SELECT id FROM ${catalogTable("plans")} WHERE id=ANY($1::uuid[])`, [selectedPlans]);
      if (found.rowCount !== selectedPlans.length) throw new HttpError(400, "One selected pricing plan no longer exists.");
    }
    const samePrice = (a: string | null, b: string | null) => a == null || b == null ? a == null && b == null : cents(a) === cents(b);
    if (key === "crypto_exchange" && (!samePrice(parsed.startingPrice, before.startingPrice) ||
      !samePrice(parsed.setupFee, before.setupFee) || parsed.currency !== before.currency || parsed.billingPeriod !== before.billingPeriod))
      throw new HttpError(409, "Exchange prices, currency and billing periods are managed in Plans, not independent marketing fields.");
    await client.query(`UPDATE landing_products SET visible=$2,name=$3,description=$4,icon=$5,
      starting_price=$6,setup_fee=$7,currency=$8,billing_period=$9,status=$10,
      cta_label=$11,display_order=$12 WHERE key=$1`,
    [key, parsed.visible, name, description, parsed.icon, parsed.startingPrice, parsed.setupFee,
      parsed.currency, parsed.billingPeriod, parsed.status, ctaLabel, parsed.displayOrder]);
    if (parsed.explore) await client.query(
      "UPDATE module_catalog SET definition=jsonb_set(definition,'{publicMarketing}',$2::jsonb,true) WHERE key=$1",
      [key, JSON.stringify(parsed.explore)]);
    const after = await readProduct(client, key);
    await audit(client, principal, null, "landing_catalog.updated", `Updated marketing catalog: ${name}`, { key, before, after });
    return after;
  });
}
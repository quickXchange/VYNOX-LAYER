import { withDatabase, type DatabaseClient } from "@workspace/db";
import { definitions, readPlan, readAddon } from "../entitlements/catalog";
import type { Principal } from "../authentication/service";
import { HttpError } from "../../lib/errors";
import { requestContext } from "./order-model";
import { DEMO_PLAN_NAME } from "../demo/identity";
import { demoEnabled } from "../demo/session";
import { catalogTable } from "../../lib/catalog-scope";

export async function catalogSelection(c: DatabaseClient, planId: string | null, addonIds: string[], approvedPrivateOffer=false) {
  const plan = planId ? await readPlan(c, planId) : null;
  if (plan && ((demoEnabled() && plan.name === DEMO_PLAN_NAME) || plan.status !== "enabled" || !["website", "crypto_exchange"].every(k => plan.entitlements.some(e => e.key === k && e.value === true)))) {
    throw new HttpError(400, "Choose an enabled White Label Exchange plan.");
  }
  const addons = [];
  for (const id of new Set(addonIds)) addons.push(await readAddon(c, id));
  if (addons.some(a => !a.enabled)) throw new HttpError(400, "One of the requested add-ons is no longer available.");
  if (addons.length && !plan) throw new HttpError(400, "Select a plan before choosing add-ons.");
  if (addons.some(a => a.currency !== plan?.currency)) throw new HttpError(400, "Requested add-ons must use the plan's currency. No automatic currency conversion is performed.");
  if(approvedPrivateOffer) return {plan,addons};
  const {publishedOffers}=await import("../commerce/pricing-publication");
  const published=await publishedOffers(c);
  const publishedPlan=plan ? published.plans.find(p=>p.id===plan.id) : null;
  const publishedAddons=addons.map(a=>{
    const publishedAddon=published.addons.find(x=>x.id===a.id);
    if(!publishedAddon) throw new HttpError(409,"This add-on is not published. Refresh the public catalog or request an approved private quotation.");
    return publishedAddon;
  });
  if(plan&&!publishedPlan)
    throw new HttpError(409,"This plan or add-on is not published. Refresh the public catalog or request an approved private quotation.");
  return {plan:publishedPlan??null,addons:publishedAddons};
}
export function whiteLabelCatalog(p: Principal) {
  return withDatabase(requestContext(p), async c=>{
    const {publishedOffers}=await import("../commerce/pricing-publication");
    const published=await publishedOffers(c);
    return {plans:published.plans,addons:published.addons,definitions:await definitions(c)};
  });
}
export async function whiteLabelCatalogForClient(c: DatabaseClient) {
    const ids = await c.query(`SELECT id FROM ${catalogTable("plans")} WHERE status='enabled' ORDER BY display_order,name,id`);
    const candidates = [];
    for (const r of ids.rows) candidates.push(await readPlan(c, r.id));
    const plans = candidates.filter(p => p.billingPeriods.length && !(demoEnabled() && p.name === DEMO_PLAN_NAME) && ["website", "crypto_exchange"].every(k => p.entitlements.some(e => e.key === k && e.value === true)));
    const ai = await c.query(`SELECT id FROM ${catalogTable("addons")} WHERE enabled ORDER BY name,id`);
    const addons = [];
    for (const r of ai.rows) addons.push(await readAddon(c, r.id));
    return { plans, addons, definitions: await definitions(c) };
}
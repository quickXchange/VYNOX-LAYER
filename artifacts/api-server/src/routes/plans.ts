import { Router } from "express";
import * as v from "@workspace/api-zod";
import { principalFrom, requireAuthentication, sameOriginMutation } from "../middlewares/authentication";
import * as catalog from "../modules/entitlements/catalog";
import * as sub from "../modules/entitlements/subscriptions";
import * as resource from "../modules/entitlements/resources";
import { getSubscription } from "../modules/entitlements/resolver";
import { saveWebsiteSettings } from "../modules/tenants/service";

const router = Router();
router.use(requireAuthentication, sameOriginMutation);
router.get("/entitlement-definitions", async (_req, res) => res.json(v.ListEntitlementDefinitionsResponse.parse(await catalog.listDefinitions(principalFrom(res)))));
router.get("/plans", async (_req, res) => res.json(v.ListPlansResponse.parse(await catalog.listPlans(principalFrom(res)))));
router.post("/plans", async (req, res) => res.status(201).json(v.CreatePlanResponse.parse(await catalog.savePlan(principalFrom(res), v.CreatePlanBody.parse(req.body)))));
router.get("/plans/:planId", async (req, res) => {
  const { planId } = v.GetPlanParams.parse(req.params);
  res.json(v.GetPlanResponse.parse(await catalog.getPlan(principalFrom(res), planId)));
});
router.put("/plans/:planId", async (req, res) => {
  const { planId } = v.UpdatePlanParams.parse(req.params);
  res.json(v.UpdatePlanResponse.parse(await catalog.savePlan(principalFrom(res), v.UpdatePlanBody.parse(req.body), planId)));
});
router.delete("/plans/:planId", async (req, res) => {
  const { planId } = v.DeletePlanParams.parse(req.params);
  const { expectedRevision } = v.DeletePlanQueryParams.parse(req.query);
  res.json(v.DeletePlanResponse.parse(await catalog.deleteCatalogRecord(principalFrom(res), planId, "plan", expectedRevision)));
});
router.post("/plans/:planId/duplicate", async (req, res) => {
  const { planId } = v.DuplicatePlanParams.parse(req.params);
  res.status(201).json(v.DuplicatePlanResponse.parse(await catalog.duplicatePlan(principalFrom(res), planId)));
});
router.put("/plans/:planId/status", async (req, res) => {
  const { planId } = v.SetPlanStatusParams.parse(req.params);
  res.json(v.SetPlanStatusResponse.parse(await (async () => { const b = v.SetPlanStatusBody.parse(req.body); return catalog.changePlanStatus(principalFrom(res), planId, b.status, b.expectedRevision); })()));
});
router.get("/add-ons", async (_req, res) => res.json(v.ListAddonsResponse.parse(await catalog.listAddons(principalFrom(res)))));
router.post("/add-ons", async (req, res) => res.status(201).json(v.CreateAddonResponse.parse(await catalog.saveAddon(principalFrom(res), v.CreateAddonBody.parse(req.body)))));
router.put("/add-ons/:addonId", async (req, res) => {
  const { addonId } = v.UpdateAddonParams.parse(req.params);
  res.json(v.UpdateAddonResponse.parse(await catalog.saveAddon(principalFrom(res), v.UpdateAddonBody.parse(req.body), addonId)));
});
router.delete("/add-ons/:addonId", async (req, res) => {
  const { addonId } = v.DeleteAddonParams.parse(req.params);
  res.json(v.DeleteAddonResponse.parse(await catalog.deleteCatalogRecord(principalFrom(res), addonId, "addon")));
});
router.put("/tenants/:tenantId/subscription/commercial", async (req, res) => {
  const { tenantId } = v.UpdateSubscriptionCommercialParams.parse(req.params);
  res.json(v.UpdateSubscriptionCommercialResponse.parse(await sub.updateSubscriptionCommercial(principalFrom(res), tenantId, v.UpdateSubscriptionCommercialBody.parse(req.body))));
});
router.get("/tenants/:tenantId/subscription", async (req, res) => {
  const { tenantId } = v.GetTenantSubscriptionParams.parse(req.params);
  res.json(v.GetTenantSubscriptionResponse.parse(await getSubscription(principalFrom(res), tenantId)));
});
router.put("/tenants/:tenantId/subscription/plan", async (req, res) => {
  const { tenantId } = v.ChangeTenantPlanParams.parse(req.params);
  res.json(v.ChangeTenantPlanResponse.parse(await sub.changeTenantPlan(principalFrom(res), tenantId, v.ChangeTenantPlanBody.parse(req.body).planId)));
});
router.put("/tenants/:tenantId/subscription/add-ons", async (req, res) => {
  const { tenantId } = v.SetTenantAddonsParams.parse(req.params);
  res.json(v.SetTenantAddonsResponse.parse(await sub.setTenantAddons(principalFrom(res), tenantId, v.SetTenantAddonsBody.parse(req.body).addonIds)));
});
router.put("/tenants/:tenantId/subscription/overrides", async (req, res) => {
  const { tenantId } = v.SetTenantOverridesParams.parse(req.params);
  res.json(v.SetTenantOverridesResponse.parse(await sub.setTenantOverrides(principalFrom(res), tenantId, v.SetTenantOverridesBody.parse(req.body).overrides)));
});
router.put("/tenants/:tenantId/suspension", async (req, res) => {
  const { tenantId } = v.SetTenantSuspensionParams.parse(req.params);
  const { suspended, reason } = v.SetTenantSuspensionBody.parse(req.body);
  res.json(v.SetTenantSuspensionResponse.parse(await sub.setTenantSuspension(principalFrom(res), tenantId, suspended, reason)));
});
router.put("/tenants/:tenantId/website-settings", async (req, res) => {
  const { tenantId } = v.UpdateTenantWebsiteSettingsParams.parse(req.params);
  res.json(v.UpdateTenantWebsiteSettingsResponse.parse(await saveWebsiteSettings(principalFrom(res), tenantId, v.UpdateTenantWebsiteSettingsBody.parse(req.body))));
});
router.get("/tenants/:tenantId/resources/:resourceType", async (req, res) => {
  const { tenantId, resourceType } = v.ListTenantResourcesParams.parse(req.params);
  res.json(v.ListTenantResourcesResponse.parse(await resource.listResources(principalFrom(res), tenantId, resourceType)));
});
router.post("/tenants/:tenantId/resources/:resourceType", async (req, res) => {
  const { tenantId, resourceType } = v.CreateTenantResourceParams.parse(req.params);
  res.status(201).json(v.CreateTenantResourceResponse.parse(await resource.createResource(principalFrom(res), tenantId, resourceType, v.CreateTenantResourceBody.parse(req.body))));
});
router.delete("/tenants/:tenantId/resources/:resourceType/:resourceId", async (req, res) => {
  const { tenantId, resourceType, resourceId } = v.RemoveTenantResourceParams.parse(req.params);
  res.json(v.RemoveTenantResourceResponse.parse(await resource.removeResource(principalFrom(res), tenantId, resourceType, resourceId)));
});
export default router;
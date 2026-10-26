import { Router } from "express";
import * as v from "@workspace/api-zod";
import { principalFrom, requireAuthentication, sameOriginMutation } from "../middlewares/authentication";
import * as pm from "../modules/plan-management/service";

const router = Router();
router.use("/plan-management", requireAuthentication, sameOriginMutation);
router.get("/plan-management/versions", async (_req, res) => { res.set("Cache-Control", "no-store"); res.json(v.ListPublicationVersionsResponse.parse(await pm.publicationVersions(principalFrom(res)))); });
router.post("/plan-management/versions/:versionId/rollback", async (req, res) => {
  const { versionId } = v.RollbackPublicationParams.parse(req.params);
  const body = v.RollbackPublicationBody.strict().parse(req.body);
  res.json(v.RollbackPublicationResponse.parse(await pm.rollbackPublication(principalFrom(res), versionId, { expectedPublishedRevision: body.expectedPublishedRevision, reason: body.reason.trim() })));
});
router.put("/plan-management/order", async (req, res) => {
  res.json(v.ReorderPlansResponse.parse(await pm.reorderPlans(principalFrom(res), v.ReorderPlansBody.strict().parse(req.body).plans)));
});
router.get("/plan-management/plans/:planId/history", async (req, res) => {
  res.json(v.GetPlanHistoryResponse.parse(await pm.planHistory(principalFrom(res), v.GetPlanHistoryParams.parse(req.params).planId)));
});
router.get("/plan-management/plans/:planId/migration-preview", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { planId } = v.GetPlanMigrationPreviewParams.parse(req.params);
  res.json(v.GetPlanMigrationPreviewResponse.parse(await pm.migrationPreview(principalFrom(res), planId, v.GetPlanMigrationPreviewQueryParams.parse(req.query).targetPlanId)));
});
router.post("/plan-management/plans/:planId/migrate", async (req, res) => {
  const { planId } = v.MigratePlanSubscriptionsParams.parse(req.params);
  const body = v.MigratePlanSubscriptionsBody.strict().parse(req.body);
  res.json(v.MigratePlanSubscriptionsResponse.parse(await pm.migrateSubscriptions(principalFrom(res), planId, { ...body, reason: body.reason.trim() })));
});
export default router;

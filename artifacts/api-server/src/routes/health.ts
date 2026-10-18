import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { withDatabase, authSupportPool } from "@workspace/db";
import { productionAcceptance } from "../modules/supabase-auth/config";
import { publicPreparation } from "../../../../lib/production-access-gate/public-preparation.mjs";

const router: IRouter = Router();

router.get("/healthz", async (_req, res, next) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  if (productionAcceptance() || publicPreparation()) {
    try {
      await withDatabase({ actorId: "acceptance-health" }, c => c.query("SELECT 1"));
      await authSupportPool.query("SELECT 1 FROM vynox_supabase_auth.sessions LIMIT 0");
      res.json({ ...data, environment: "production", commit: process.env.RENDER_GIT_COMMIT,
        acceptanceOnly: productionAcceptance(), ready: publicPreparation(), publicLiveActivated: false,
        publicPreparation: publicPreparation(), financialExecutionEnabled: false,
        databaseConnected: true, privateAuthConnected: true,
        schemaVerified: process.env.QXLAYER_PRODUCTION_SCHEMA_VERIFIED === "true" });
    } catch (error) { next(error); }
    return;
  }
  res.json(data);
});

export default router;

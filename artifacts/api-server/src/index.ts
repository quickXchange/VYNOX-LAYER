import app from "./app";
import { logger } from "./lib/logger";
import { startIntegrationHealthMonitor } from "./modules/integrations/monitor";
import { pool, authSupportPool, withDatabase } from "@workspace/db";
import { assertExternalEnvironment } from "./lib/external-environment";
import { startTrialMonitor } from "./modules/commerce/trial-monitor";

assertExternalEnvironment();
if (process.env.QXLAYER_DATABASE_PROVIDER === "supabase")
  await withDatabase({ actorId: "qxlayer-external-readiness" }, c => c.query("SELECT 1"));

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, "0.0.0.0", (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
const stop = process.env.QXLAYER_HEALTH_MONITOR_MODE === "disabled" ? () => {}
  : startIntegrationHealthMonitor();
let closing = false;
const stopTrials = startTrialMonitor();
async function shutdown() {
  if (closing) return;
  closing = true;
  setTimeout(() => process.exit(1), 20_000).unref();
  await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), stop(), stopTrials()]);
  if (authSupportPool !== pool) await authSupportPool.end();
  await pool.end(); process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

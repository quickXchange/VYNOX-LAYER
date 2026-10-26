import { logger } from "../../lib/logger";
import { sweepExpiredTrials } from "./trials";
import { acceptanceCatalog } from "../../lib/catalog-scope";

export function startTrialMonitor() {
  if (acceptanceCatalog()) return async () => {};
  let running: Promise<void> | undefined;
  const tick = () => {
    if (running) return;
    running = sweepExpiredTrials().catch(err => {
      logger.error({ err }, "Trial expiry audit failed; deadline access enforcement remains active");
    }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return async () => { clearInterval(timer); await running; };
}

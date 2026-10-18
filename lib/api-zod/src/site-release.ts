import { z } from "zod";
import { GetPublicSiteResponse, GetPublicExchangeResponse, GetReleasedSiteConfigResponse } from "./generated/api";

export const SITE_SCHEMA_VERSION = 1;
export const SiteSnapshot = GetReleasedSiteConfigResponse.extend({ schema_version: z.literal(1) });
export type SiteSnapshotConfig = z.infer<typeof SiteSnapshot>;

/** One shared compatibility boundary, used in API and browser. Never default a tenant. */
export function migrateSiteSnapshot(raw: unknown): SiteSnapshotConfig {
  if (!raw || typeof raw !== "object") throw new Error("Site configuration is missing.");
  const old = raw as Record<string, unknown>;
  if (old.schema_version === 0) {
    return SiteSnapshot.parse({ schema_version: 1, site: GetPublicSiteResponse.parse(old.site),
      exchange: old.exchange == null ? null : GetPublicExchangeResponse.parse(old.exchange),
      addons: old.addons ?? [], displayLimits: old.displayLimits ?? {}, providers: old.providers ?? [] });
  }
  if (old.schema_version !== 1) throw new Error("Unsupported site configuration version. Refresh or contact the operator.");
  return SiteSnapshot.parse(raw);
}

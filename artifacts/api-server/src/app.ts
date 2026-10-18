import express, { type Express, type ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";
import { ZodError } from "zod";
import router from "./routes";
import { logger } from "./lib/logger";
import { HttpError } from "./lib/errors";
import { createAccessGate } from "../../../lib/production-access-gate/index.mjs";
import { supabaseAuthConfiguration, supabaseDefaultProvider } from "./modules/supabase-auth/config";
import { preparationIsolation } from "./middlewares/preparation-isolation";

// No silent fallback to a retired provider, including in a future published build.
if (!supabaseDefaultProvider()) throw new Error("Supabase Auth must be explicitly configured. Legacy authentication is retired; Production migration approval is required before publishing.");
supabaseAuthConfiguration();

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]?.replace(
            /^(\/api\/auth\/reset-password\/)[^/]+$/, "$1[redacted]",
          ),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
// Before body parsing and application routes.
const accessGate = createAccessGate({ basePath: "/api", healthPath: "/api/healthz",
  deliveredSite: async slug => (await import("./modules/website/service")).deliveredPublicSite(slug) });
app.use((req, res, next) => {
  // This path was already public liveness. Let the API's explicit safe handler
  // prove the protected candidate's real pools instead of returning gate liveness.
  if (req.path === "/api/healthz" && ["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Cache-Control", "no-store"); return next();
  }
  return accessGate(req, res, next);
});
app.use(express.json({ limit: "128kb" }));
app.use(express.urlencoded({ extended: true, limit: "128kb" }));

app.use(preparationIsolation);
app.use("/api", router);
const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (req.path === "/api/diagnostics/website-errors" && error?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid safe diagnostic." }); return;
  }
  if (error?.type === "entity.too.large") { res.status(413).json({ error: "The upload or request exceeds its allowed size limit." }); return; }
  // The generated API validators and application validators can resolve distinct
  // Zod packages. Keep valid client mistakes at 400 rather than logging a 500.
  if (error instanceof ZodError || (error?.name === "ZodError" && Array.isArray(error.issues))) {
    res.status(400).json({ error: "Invalid input.", details: error.issues.map((i: { path: unknown; message: string }) => ({ path: i.path, message: i.message })) }); return;
  }
  if (error instanceof HttpError) {
    if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
    const authCode = req.path.startsWith("/api/supabase-auth") ? error.message.match(/^([A-Z_]+):/)?.[1] : undefined;
    res.status(error.status).json({ error: error.message, ...(authCode ? { code: authCode } : {}),
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }); return;
  }
  if (req.path.startsWith("/api/supabase-auth")) {
    // Auth SQL/network errors must never expose token envelopes or credential parameters.
    req.log.error({ code: typeof error?.code === "string" ? error.code : "AUTH_UNAVAILABLE" }, "Staging authentication unavailable");
    res.status(503).json({ error: "Authentication is temporarily unavailable." }); return;
  }
  const code = (error as { code?: string }).code;
  if (code === "23505") { res.status(409).json({ error: "This slug, domain, or unique configuration is already in use." }); return; }
  if (code === "23503") { res.status(400).json({ error: "Configuration references an unavailable catalog entry or a dependent record." }); return; }
  req.log.error({ err: error }, "Request failed");
  res.status(500).json({ error: "The operation could not be completed." });
};
app.use(errorHandler);

export default app;

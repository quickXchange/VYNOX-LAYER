import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile, readdir, stat, readFile } from "node:fs/promises";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frontendRoutes } from "./frontend-routes.mjs";
import { publicPreparation } from "../../lib/production-access-gate/public-preparation.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(root);
const api = new URL(process.env.QXLAYER_API_ORIGIN ?? "https://unconfigured.invalid");
if (api.protocol !== "https:" || !api.hostname.endsWith(".onrender.com") ||
    api.pathname !== "/" || api.username || api.password || api.search || api.hash)
  throw new Error("QXLAYER_API_ORIGIN must be the exact Render API HTTPS origin.");
const authProvider = process.env.QXLAYER_AUTH_PROVIDER;
if (authProvider !== "supabase" || !["staging", "production"].includes(process.env.QXLAYER_EXTERNAL_ENVIRONMENT))
  throw new Error("External frontend builds require Supabase and an explicit isolated target.");
if (process.env.QXLAYER_EXTERNAL_ENVIRONMENT === "production") {
  const ref = process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF ?? "";
  if (!/^[a-z0-9]{20}$/.test(ref) || ["nktstksmfpcsjnjbeqsk", "muvedavhbpgpdrrnjrih"].includes(ref) ||
      process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_URL !==
        (process.env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED === "true" ?
          "https://qxlayer-acceptance-vynox3.vercel.app" :
          publicPreparation(process.env) ? "https://qxlayer-staging.vercel.app" : "https://www.quicklychan.xyz"))
    throw new Error("Production frontend builds require isolated Production Auth metadata.");
}
for (const [name, base] of [["private-label-console", "/"], ["private-label-website", "/private-label-website/"]]) {
  const result = spawnSync("pnpm", ["--filter", `@workspace/${name}`, "run", "build"], {
    stdio: "inherit", env: { ...process.env, NODE_ENV: "production", PORT: "3000", BASE_PATH: base,
      VITE_EXTERNAL_DEPLOYMENT: "true",
      VITE_QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED: process.env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED,
      VITE_QXLAYER_PUBLIC_PREPARATION_APPROVED: process.env.QXLAYER_PUBLIC_PREPARATION_APPROVED,
      VITE_QXLAYER_AUTH_PROVIDER: authProvider,
      VITE_QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF: process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF,
      VITE_QXLAYER_PRODUCTION_SUPABASE_AUTH_URL: process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_URL,
      VITE_QXLAYER_EXTERNAL_ENVIRONMENT: process.env.QXLAYER_EXTERNAL_ENVIRONMENT ?? "production" },
  });
  if (result.status !== 0) throw new Error(`${name} build failed.`);
}
const output = path.join(root, ".vercel/output");
await rm(output, { recursive: true, force: true });
const fn = path.join(output, "functions/frontend.func");
await mkdir(path.join(fn, "static"), { recursive: true });
await cp("artifacts/private-label-console/dist/public", path.join(fn, "static"), { recursive: true });
await cp("artifacts/private-label-website/dist/public", path.join(fn, "static/private-label-website"), { recursive: true });
await cp("lib/production-access-gate", path.join(fn, "lib/production-access-gate"), { recursive: true });
const bootstrap = process.env.QXLAYER_PREVIEW_BOOTSTRAP === "true";
if (bootstrap && process.env.QXLAYER_EXTERNAL_ENVIRONMENT !== "staging")
  throw new Error("Preview bootstrap packaging is Staging-only.");
await cp(bootstrap ? "deploy/vercel/preview-bootstrap-handler.mjs" : "deploy/vercel/handler.mjs",
  path.join(fn, "handler.mjs"));
await mkdir(path.join(fn, "artifacts/private-label-console/public"), { recursive: true });
for (const mode of ["light", "dark"])
  await cp(`artifacts/private-label-console/public/qxlayer-logo-${mode}.png`,
    path.join(fn, `artifacts/private-label-console/public/qxlayer-logo-${mode}.png`));
async function validateSizes(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await validateSizes(file);
    else if ((await stat(file)).size > 4 * 1024 * 1024)
      throw new Error("A frontend asset exceeds the safe Vercel function response budget.");
  }
}
await validateSizes(path.join(fn, "static"));
// Compress at build time, not per visitor. Gate still runs before every response;
// these files remain inside the function, never on a public bypass route.
async function compressAssets(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await compressAssets(file);
    else if (/\.(js|css|html|svg)$/.test(file)) {
      const bytes = await readFile(file);
      await writeFile(`${file}.gz`, gzipSync(bytes, { level: 9 }));
      await writeFile(`${file}.br`, brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
    }
  }
}
await compressAssets(path.join(fn, "static"));
await writeFile(path.join(fn, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs24.x", handler: "handler.mjs", launcherType: "Nodejs",
  shouldAddHelpers: false, maxDuration: 15,
}, null, 2));
// API/uploads bypass the Node function and preserve existing 8-MB uploads.
// Protected Staging/acceptance gate entry stays in the same-origin function.
// The public Production route and API/upload proxy remain unchanged.
await writeFile(path.join(output, "config.json"), JSON.stringify({ version: 3, routes: frontendRoutes({
  apiOrigin: api.origin, environment: process.env.QXLAYER_EXTERNAL_ENVIRONMENT,
  acceptanceApproved: process.env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED, bootstrap,
}) }, null, 2));
console.info(bootstrap
  ? "Built gated Preview-only frontends; API disabled and no external rewrites; nothing deployed."
  : "Built gated Vercel frontends and same-origin Render routes; nothing deployed.");

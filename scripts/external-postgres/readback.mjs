import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { targetConfiguration } from "./migrate.mjs";
import { verifyTarget } from "./verify-target.mjs";
import { assertMigrationReadback } from "./manifest-readback.mjs";
const require = createRequire(new URL("../../lib/db/package.json",import.meta.url));
const { Client } = require("pg");
const options = targetConfiguration(process.env);
if (options.caFile) {
  options.ssl = { rejectUnauthorized:true,ca:await readFile(options.caFile,"utf8") };
  delete options.caFile;
}
const c = new Client(options);
try {
  await c.connect(); await c.query("BEGIN READ ONLY"); await verifyTarget(c, { planManagement: true });
  const versions = await c.query("SELECT file,sha256 FROM qxlayer_migrations.versions ORDER BY file");
  const expected = JSON.parse(await readFile(new URL(process.env.QXLAYER_EXTERNAL_ENVIRONMENT === "production" ? "../../deploy/production-candidate/manifest.json" : "../../deploy/migrations/manifest.json",import.meta.url),"utf8"));
  assertMigrationReadback(versions.rows, expected);
  await c.query("COMMIT");
} catch { console.error("External readback failed; release is stopped."); process.exitCode=1; }
finally { await c.end(); }

import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
if (process.env.NODE_ENV === "production" || process.env.QXLAYER_EXTERNAL_ENVIRONMENT !== "development" || !process.env.REPLIT_DEV_DOMAIN)
  throw new Error("Development-only migration; other targets require separate scoped approval.");
const c = await pool.connect();
try {
  if ((await c.query("SELECT current_database() AS name")).rows[0]?.name !== "heliumdb") throw new Error("Unexpected database target.");
  await c.query(await readFile(new URL("../../lib/db/migrations/subscription-trials.sql", import.meta.url), "utf8"));
  console.log("Subscription trial schema ready; existing agreements unchanged.");
} finally { c.release(); await pool.end(); }

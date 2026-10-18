import { pool } from "@workspace/db";
import reference from "./site-release-catalog-fixture.json";
import { seedReferenceCatalog } from "./catalog-reference";
/** Schema-only CI migrations deliberately have no catalog data or startup seeding. */
export async function seedCICatalog() {
  if (process.env.NODE_ENV !== "test" || process.env.QXLAYER_MIGRATION_TEST !== "true" ||
      !["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Disposable CI only.");
  const c=await pool.connect();
  try {
    for(const d of reference.definitions) await c.query("INSERT INTO entitlement_definitions(key,label,kind,value_type) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[d.key,d.label,d.kind,d.value_type]);
    for(const m of reference.modules) await c.query("INSERT INTO module_catalog(key,name,description,category,definition) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[m.key,m.name,m.description,m.category,m]);
    await seedReferenceCatalog(c);
    // Catalog availability in a disposable sandbox is not provider connectivity.
    await c.query("UPDATE global_exchange_catalog SET status='enabled',metadata=metadata||'{\"verified\":true}'::jsonb WHERE kind IN ('assets','networks')");
    await c.query("UPDATE global_exchange_catalog_links SET enabled=true,verified=true WHERE kind='asset_network'");
  } finally { c.release(); }
}

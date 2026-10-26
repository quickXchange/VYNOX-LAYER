// Read-only fingerprint used before/after DB verification to prove no data changed.
import { pool } from "@workspace/db";
const r = (await pool.query(`SELECT (SELECT count(*) FROM plans WHERE status='enabled') en,(SELECT md5(string_agg(id::text||revision||status||profile::text,'' ORDER BY id)) FROM plans) plans,
 (SELECT count(*) FROM tenant_subscriptions WHERE contract_snapshot IS NULL) unfrozen,(SELECT count(*) FROM qxlayer_commerce.pricing_publication_versions) versions,
 (SELECT revision FROM qxlayer_commerce.pricing_publication) pub,(SELECT count(*) FROM audit_events WHERE actor_id LIKE 'verify:%') audits,
 (SELECT md5(string_agg(contract_snapshot::text,'' ORDER BY tenant_id)) FROM tenant_subscriptions) snaps`)).rows[0];
console.log(JSON.stringify(r)); await pool.end();

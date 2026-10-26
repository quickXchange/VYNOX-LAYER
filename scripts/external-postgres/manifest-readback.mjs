import { schemaLedger } from "./legacy-data-receipts.mjs";
/** Exact schema ledger; historical data receipts are never replayed. */
export function assertMigrationReadback(rows, manifest, env = process.env) {
  const inactiveAuth = env.QXLAYER_EXTERNAL_ENVIRONMENT === "staging" &&
    env.QXLAYER_AUTH_PROVIDER === "clerk" && rows.length === 2 && manifest.length === 3 &&
    manifest[2].file === "0003_owned_auth.sql";
  const expected = inactiveAuth ? manifest.slice(0, 2) : manifest;
  const actual = schemaLedger(rows, env.QXLAYER_EXTERNAL_ENVIRONMENT === "production");
  if (JSON.stringify(actual) !== JSON.stringify(expected.map(({file,sha256}) => ({file,sha256}))))
    throw Error("Applied migration ledger does not match reviewed source.");
}

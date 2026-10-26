import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaLedger } from "./legacy-data-receipts.mjs";
const receipt = { file: "approved_public_exchange_plans", sha256: "c065c7745bd057b2714001a14c5770efdb1224623b2f052f4a05e5dc72363da5" };
test("only the exact historically approved Production receipt is separated from schema history", () => {
  const schema = { file: "0011_plan_feature_rows.sql", sha256: "hash" };
  assert.deepEqual(schemaLedger([schema, receipt], true), [schema]);
  assert.deepEqual(schemaLedger([schema, receipt], false), [schema, receipt]);
  assert.throws(() => schemaLedger([{ ...receipt, sha256: "changed" }], true));
  assert.deepEqual(schemaLedger([{ file: "unknown", sha256: "hash" }], true), [{ file: "unknown", sha256: "hash" }]);
});

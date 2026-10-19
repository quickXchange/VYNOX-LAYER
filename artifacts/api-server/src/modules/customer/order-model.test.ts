import test from "node:test";
import assert from "node:assert/strict";
import { orderView, planSnapshotView } from "./order-model";

test("legacy requested and approved plan snapshots expose feature rows without changing stored history", async () => {
  const legacy = Object.freeze({ id: "historical-plan", name: "Original name", monthlyPrice: "39.00" });
  const modern = Object.freeze({ ...legacy, featureRows: [{ label: "Support", value: "Email" }] });
  const client = { query: async () => ({ rows: [] }) } as any;
  const row = {
    id: "order", orderNumber: 1, status: "new",
    configuration: { projectName: "Example", brandName: "Example", actions: ["swap"],
      catalogSnapshot: { plan: legacy } },
    approvedConfiguration: { plan: modern },
  };
  const view = await orderView(client, row);
  assert.deepEqual(view.requestedPlan, { ...legacy, featureRows: [] });
  assert.deepEqual(view.approvedPlan, modern);
  assert.equal(Object.hasOwn(legacy, "featureRows"), false);
  const reversed = await orderView(client, {
    ...row, configuration: { ...row.configuration, catalogSnapshot: { plan: modern } },
    approvedConfiguration: { plan: legacy },
  });
  assert.deepEqual(reversed.requestedPlan, modern);
  assert.deepEqual(reversed.approvedPlan, { ...legacy, featureRows: [] });
});

test("missing plans remain null and malformed present feature rows are not silently discarded", () => {
  assert.equal(planSnapshotView(null), null);
  assert.equal(planSnapshotView(undefined), null);
  assert.deepEqual(planSnapshotView({ featureRows: [] }), { featureRows: [] });
  assert.deepEqual(planSnapshotView({ featureRows: "invalid" }), { featureRows: "invalid" });
});

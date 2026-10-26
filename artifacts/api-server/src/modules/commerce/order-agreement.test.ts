import assert from "node:assert/strict";
import { test } from "node:test";
import { orderAgreement } from "./order-agreement";
import { invoicePricing } from "./pricing";

const agreement = () => ({ plan: { id: "plan", pricingConfigured: true, monthlyPrice: "25.00", yearlyPrice: "250.00", setupFee: "5.00", discountPercent: "0", currency: "EUR" }, addons: [] });
test("submission agreement remains invoiceable after the live plan changes or is archived", () => {
  const snapshot = agreement();
  const configuration = { catalogSnapshot: snapshot, requestedPlanId: "plan", billingPeriod: "monthly", pricedAt: "2026-10-01T00:00:00Z" };
  const livePlan = { ...snapshot.plan, monthlyPrice: "999.00", status: "archived" };
  assert.notEqual(livePlan.monthlyPrice, snapshot.plan.monthlyPrice);
  assert.equal(invoicePricing({ ...configuration, catalogSnapshot: orderAgreement({ status: "submitted", configuration }) }).amount, "30.00");
});
test("only an approved quotation can replace the submitted agreement", () => {
  const original = agreement(), approved = agreement();
  approved.plan.monthlyPrice = "40.00";
  assert.equal(orderAgreement({ status: "submitted", configuration: { catalogSnapshot: original }, approved_configuration: approved }), original);
  assert.equal(orderAgreement({ status: "quote_ready", configuration: { catalogSnapshot: original }, approved_configuration: approved }), approved);
});
test("legacy orders with missing agreements fail closed instead of silently using today's price", () => {
  assert.throws(() => orderAgreement({ status: "submitted", configuration: { requestedPlanId: "plan" } }), /original pricing snapshot is missing/);
  assert.throws(() => orderAgreement({ status: "quote_ready", configuration: { catalogSnapshot: agreement() } }), /original pricing snapshot is missing/);
});

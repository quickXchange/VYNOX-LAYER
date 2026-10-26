import test from "node:test";
import assert from "node:assert/strict";
import { effectiveRecurring, promotionActive, recurringEstimate } from "./commercial-pricing";
import { invoicePricing } from "../commerce/pricing";

const start = new Date("2026-03-01T00:00:00Z"), end = new Date("2026-04-01T00:00:00Z");
const base = { monthlyPrice: "50.00", yearlyPrice: "500.00", setupFee: "10.00", currency: "EUR", pricingConfigured: true, discountPercent: "10" };
test("percentage, fixed and promotion follow one rule", () => {
  assert.equal(effectiveRecurring(base, "monthly"), "45.00");
  const fixed = { ...base, discountPercent: "0", profile: { fixedDiscountAmount: "7.50" } };
  assert.equal(effectiveRecurring(fixed, "monthly"), "42.50"); assert.equal(effectiveRecurring(fixed, "yearly"), "492.50");
  const promo = { ...fixed, profile: { fixedDiscountAmount: "7.50", promoPrice: "19.99", promoStartsAt: start, promoEndsAt: end } };
  assert.equal(effectiveRecurring(promo, "monthly", new Date("2026-03-15T00:00:00Z")), "19.99", "promotion replaces, no stacking");
  assert.equal(effectiveRecurring(promo, "yearly", new Date("2026-03-15T00:00:00Z")), "492.50", "promotion is monthly only");
  assert.equal(effectiveRecurring(promo, "monthly", end), "42.50", "end is exclusive");
  assert.equal(effectiveRecurring(promo, "monthly", new Date("2026-02-28T23:59:59Z")), "42.50");
  assert.ok(!promotionActive({ promoPrice: "1" }, start));
  assert.equal(effectiveRecurring({ monthlyPrice: null, yearlyPrice: null }, "monthly"), null);
});
test("estimates and invoices use the same rule; invoices price at submission time", () => {
  const plan = { ...base, discountPercent: "0", profile: { promoPrice: "20.00", promoStartsAt: start, promoEndsAt: end } };
  assert.equal(recurringEstimate([plan], "monthly", "0", new Date("2026-03-02T00:00:00Z")), "20.00");
  const cfg = (pricedAt?: string) => ({ billingPeriod: "monthly", pricedAt, catalogSnapshot: { plan, addons: [] } });
  assert.equal(invoicePricing(cfg("2026-03-10T00:00:00Z")).recurring, "20.00");
  assert.equal(invoicePricing(cfg("2026-05-10T00:00:00Z")).recurring, "50.00");
  assert.equal(invoicePricing(cfg("2026-03-10T00:00:00Z")).amount, "30.00");
  assert.throws(() => invoicePricing({ billingPeriod: "monthly", catalogSnapshot: { plan: { ...plan, pricingConfigured: false }, addons: [] } }), /provisional/);
});

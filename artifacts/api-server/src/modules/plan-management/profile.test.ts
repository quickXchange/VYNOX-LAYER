import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { billingError, normalizeProfile, publicProfile, safeLocalUrl, safeMediaUrl } from "./profile";

const cap = (o: Record<string, unknown>) => ({ key: "x_feature", label: "X", state: "included", availability: "available", ...o });
const both = { monthly: true, yearly: true };
const none = { monthlyPrice: null, yearlyPrice: null, setupFee: null };

test("urls are restricted to safe local paths or https", () => {
  for (const u of ["/contact", "/pricing#a"]) assert.ok(safeLocalUrl(u));
  for (const u of ["//evil.com", "javascript:alert(1)", "/../x", "https://x.com"]) assert.ok(!safeLocalUrl(u));
  assert.ok(safeMediaUrl("https://cdn.example.com/a.png"));
  for (const u of ["http://cdn.example.com/a.png", "https://u:p@cdn.example.com/a", "data:image/png;base64,AA"]) assert.ok(!safeMediaUrl(u));
});
test("capability states, limits and dependencies are validated", () => {
  assert.throws(() => normalizeProfile({ capabilities: [cap({ state: "limited" })] }));
  assert.throws(() => normalizeProfile({ capabilities: [cap({ limitValue: 3 })] }));
  assert.throws(() => normalizeProfile({ capabilities: [cap({ state: "unavailable" })] }));
  assert.throws(() => normalizeProfile({ capabilities: [cap({ dependsOn: ["missing"] })] }));
  assert.throws(() => normalizeProfile({ capabilities: [cap({ dependsOn: ["b_feature"] }), cap({ key: "b_feature", state: "excluded" })] }));
  assert.throws(() => normalizeProfile({ capabilities: [cap({ dependsOn: ["b_feature"] }), cap({ key: "b_feature", dependsOn: ["x_feature"] })] }));
  assert.equal(normalizeProfile({ capabilities: [cap({ state: "limited", limitValue: 2, unit: "providers" })] }).capabilities![0].limitValue, 2);
  assert.throws(() => normalizeProfile({ badgeType: "custom" }));
});
test("billing must be coherent", () => {
  assert.equal(billingError({ pricingMode: "contact_sales" }, false, none, both), null);
  assert.ok(billingError({ pricingMode: "contact_sales" }, true, { monthlyPrice: "1", yearlyPrice: "1", setupFee: "0" }, both));
  assert.ok(billingError({ pricingMode: "paid" }, false, none, both));
  assert.ok(billingError({ pricingMode: "free" }, true, { monthlyPrice: "5", yearlyPrice: "0", setupFee: "0" }, both));
  assert.ok(billingError({ pricingMode: "custom" }, false, none, both));
  const paid = { monthlyPrice: "50", yearlyPrice: "500", setupFee: "0" };
  assert.equal(billingError({ pricingMode: "paid", fixedDiscountAmount: "5" }, true, paid, both), null);
  assert.ok(billingError({ pricingMode: "paid", fixedDiscountAmount: "60" }, true, paid, both), "fixed discount >= price");
  assert.ok(billingError({ pricingMode: "paid", fixedDiscountAmount: "5" }, true, { ...paid, discountPercent: "10" }, both), "no stacking with percentage");
  assert.ok(billingError({ pricingMode: "paid", trialDays: 7 }, true, paid, both), "trial unsupported");
  assert.equal(billingError({ pricingMode: "paid" }, true, { ...paid, discountPercent: "10" }, both), null);
  assert.ok(billingError({ pricingMode: "paid", promoPrice: "40" }, true, paid, both));
  assert.ok(billingError({ pricingMode: "paid", promoPrice: "40", promoStartsAt: new Date("2026-02-01T00:00:00Z"), promoEndsAt: new Date("2026-01-01T00:00:00Z") }, true, paid, both));
  assert.equal(billingError({ pricingMode: "paid", promoPrice: "40", promoStartsAt: new Date("2026-01-01T00:00:00Z"), promoEndsAt: new Date("2026-02-01T00:00:00Z") }, true, paid, both), null);
  assert.ok(billingError({ pricingMode: "paid", billingInterval: "monthly" }, true, paid, both));
  assert.ok(billingError({ pricingMode: "contact_sales", trialDays: 7 }, false, none, both));
});
test("public projection excludes internal fields and hidden features", () => {
  const p = publicProfile({ internalNotes: "x", internalName: "y", capabilities: [cap({ publicVisible: false })] });
  assert.ok(!("internalNotes" in p) && !("internalName" in p));
  assert.equal(p.capabilities!.length, 0);
});
test("seed profiles are valid contact-sales plans with explicit inherited features", () => {
  const sql = readFileSync(new URL("../../../../../lib/db/migrations/plan-management-seed.sql", import.meta.url), "utf8");
  const profiles = [...sql.matchAll(/\$j\$(.*?)\$j\$/gs)].map(m => normalizeProfile(JSON.parse(m[1])));
  assert.equal(profiles.length, 3);
  for (const p of profiles) { assert.equal(p.pricingMode, "contact_sales"); assert.equal(billingError(p, false, none, both), null); }
  const granted = (i: number) => new Set(profiles[i].capabilities!.filter(c => !["excluded", "unavailable"].includes(c.state)).map(c => c.key));
  for (const k of granted(0)) assert.ok(granted(1).has(k), `Standard lists ${k}`);
  for (const k of granted(1)) assert.ok(granted(2).has(k), `Premium lists ${k}`);
});
test("unsupported services are always public as unavailable", () => {
  const p = publicProfile({ capabilities: [cap({ key: "pair_markup" }), cap({ key: "fiat_ramps", availability: "requires_configuration" }), cap({ key: "api_access" })] });
  assert.deepEqual(p.capabilities!.map(c => c.availability), ["unavailable", "unavailable", "available"]);
});

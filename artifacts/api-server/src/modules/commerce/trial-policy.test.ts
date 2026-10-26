import test from "node:test";
import assert from "node:assert/strict";
import { effectiveTrial, trialBlocksAccess, type Trial } from "./trial-policy";

const trial: Trial = {
  id: "f36a3509-8cc7-49e5-a46c-ef41fac86031", state: "active",
  startedAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-01-08T00:00:00.000Z",
  renewalRule: "manual_agreement_required", renewalRequestedAt: null, cancelledAt: null,
  publishedRevision: "test", agreedRecurringPrice: "50.00",
};
test("trial deadline is half-open and enforced without a scheduler", () => {
  assert.equal(trialBlocksAccess(trial, new Date("2026-01-07T23:59:59.999Z")), false);
  assert.equal(trialBlocksAccess(trial, new Date(trial.endsAt)), true);
  assert.equal(effectiveTrial(trial, new Date(trial.endsAt))?.state, "expired");
  assert.equal(trial.state, "active", "read enforcement must not mutate stored data");
});
test("cancelled and expired trials never resume; ordinary subscriptions are unchanged", () => {
  assert.equal(trialBlocksAccess(null), false);
  assert.equal(trialBlocksAccess(undefined), false);
  for (const state of ["cancelled", "expired"] as const) {
    assert.equal(trialBlocksAccess({ ...trial, state }, new Date(trial.startedAt)), true);
  }
});
test("a renewal request does not extend the deadline or change agreed prices", () => {
  const requested = { ...trial, renewalRequestedAt: "2026-01-07T00:00:00Z" };
  assert.equal(trialBlocksAccess(requested, new Date(trial.endsAt)), true);
  assert.equal(effectiveTrial(requested)?.agreedRecurringPrice, trial.agreedRecurringPrice);
});

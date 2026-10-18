import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalMatches, approvedDeploymentId, bindingMatches, challengeHash,
} from "./approval";

test("only an explicitly enabled exact Production deployment can be approved", () => {
  const oldEnabled = process.env.QXLAYER_CUSTOM_DOMAIN_ACTIVATION_APPROVED;
  const oldDeployment = process.env.VERCEL_DOMAIN_APPROVED_DEPLOYMENT_ID;
  try {
    process.env.QXLAYER_CUSTOM_DOMAIN_ACTIVATION_APPROVED = "true";
    process.env.VERCEL_DOMAIN_APPROVED_DEPLOYMENT_ID = "dpl_Approved123";
    const approval = { metadata: { domain: "exchange.customer.example", deploymentId: "dpl_Approved123" } };
    assert.equal(approvedDeploymentId(), "dpl_Approved123");
    assert.equal(approvalMatches(approval, "exchange.customer.example", approvedDeploymentId()), true);
    assert.equal(approvalMatches(approval, "other.customer.example", approvedDeploymentId()), false);
    assert.equal(approvalMatches(approval, "exchange.customer.example", "dpl_Other"), false);
    process.env.QXLAYER_CUSTOM_DOMAIN_ACTIVATION_APPROVED = "false";
    assert.equal(approvalMatches(approval, "exchange.customer.example", approvedDeploymentId()), false);
    process.env.VERCEL_DOMAIN_APPROVED_DEPLOYMENT_ID = "latest-production";
    assert.equal(approvedDeploymentId(), null);
  } finally {
    if (oldEnabled === undefined) delete process.env.QXLAYER_CUSTOM_DOMAIN_ACTIVATION_APPROVED;
    else process.env.QXLAYER_CUSTOM_DOMAIN_ACTIVATION_APPROVED = oldEnabled;
    if (oldDeployment === undefined) delete process.env.VERCEL_DOMAIN_APPROVED_DEPLOYMENT_ID;
    else process.env.VERCEL_DOMAIN_APPROVED_DEPLOYMENT_ID = oldDeployment;
  }
});

test("binding evidence must be explicit, match the approval and follow it", () => {
  const approval = {
    metadata: { domain: "exchange.customer.example", deploymentId: "dpl_Approved123" },
    created_at: "2026-10-18T12:00:00.000Z",
  };
  const matching = {
    metadata: { domain: "exchange.customer.example", deploymentId: "dpl_Approved123", bound: true },
    created_at: "2026-10-18T12:01:00.000Z",
  };
  assert.equal(bindingMatches(matching, "exchange.customer.example", "dpl_Approved123", approval), true);
  assert.equal(bindingMatches({ ...matching, metadata: { ...matching.metadata, bound: false } }, "exchange.customer.example", "dpl_Approved123", approval), false);
  assert.equal(bindingMatches({ ...matching, created_at: "2026-10-18T11:59:00.000Z" }, "exchange.customer.example", "dpl_Approved123", approval), false);
  assert.equal(bindingMatches(matching, "exchange.customer.example", "dpl_Other", approval), false);
  assert.match(challengeHash("ownership-token"), /^[a-f0-9]{64}$/);
});

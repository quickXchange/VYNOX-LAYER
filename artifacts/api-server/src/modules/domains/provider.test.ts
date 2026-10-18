import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyApprovedDeploymentAlias } from "./provider";

test("approved alias readback requires the exact READY Production deployment", async () => {
  const original = {
    provider: process.env.QXLAYER_HOSTING_PROVIDER,
    token: process.env.VERCEL_DOMAIN_TOKEN,
    project: process.env.VERCEL_DOMAIN_PROJECT_ID,
    team: process.env.VERCEL_DOMAIN_TEAM_ID,
    fetch: globalThis.fetch,
  };
  process.env.QXLAYER_HOSTING_PROVIDER = "vercel";
  process.env.VERCEL_DOMAIN_TOKEN = "test-token";
  process.env.VERCEL_DOMAIN_PROJECT_ID = "prj_Approved123";
  process.env.VERCEL_DOMAIN_TEAM_ID = "team_Approved123";
  try {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/v13/deployments/"))
        return new Response(JSON.stringify({ projectId: "prj_Approved123", readyState: "READY", target: "production" }));
      return new Response(JSON.stringify({ aliases: [{ alias: "exchange.customer.example" }] }));
    };
    assert.equal(await verifyApprovedDeploymentAlias("exchange.customer.example", "dpl_Approved123"), true);
    assert.equal(requested.length, 2);
    assert.ok(requested[0].includes("/v13/deployments/dpl_Approved123"));
    assert.ok(requested[1].includes("/v2/deployments/dpl_Approved123/aliases"));

    globalThis.fetch = async (input) => String(input).includes("/v13/deployments/")
      ? new Response(JSON.stringify({ projectId: "prj_Approved123", readyState: "BUILDING", target: "production" }))
      : new Response(JSON.stringify({ aliases: [{ alias: "exchange.customer.example" }] }));
    await assert.rejects(
      () => verifyApprovedDeploymentAlias("exchange.customer.example", "dpl_Approved123"),
      /READY Production deployment/,
    );
  } finally {
    if (original.provider === undefined) delete process.env.QXLAYER_HOSTING_PROVIDER;
    else process.env.QXLAYER_HOSTING_PROVIDER = original.provider;
    if (original.token === undefined) delete process.env.VERCEL_DOMAIN_TOKEN;
    else process.env.VERCEL_DOMAIN_TOKEN = original.token;
    if (original.project === undefined) delete process.env.VERCEL_DOMAIN_PROJECT_ID;
    else process.env.VERCEL_DOMAIN_PROJECT_ID = original.project;
    if (original.team === undefined) delete process.env.VERCEL_DOMAIN_TEAM_ID;
    else process.env.VERCEL_DOMAIN_TEAM_ID = original.team;
    globalThis.fetch = original.fetch;
  }
});

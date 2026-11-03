import { writeFile } from "node:fs/promises";

const host = process.env.REPLIT_DEV_DOMAIN;
if (!/^[a-z0-9.-]+\.replit\.dev$/.test(host ?? "")) throw Error("Development host required.");
const origin = `https://${host}`;
const absent = "00000000-0000-4000-8000-000000000000";
// Reviewed authentication-first routes only. No valid payloads, cookies,
// deletion, financial execution, provisioning, publication, or Auth actions.
const routes = [
  ["POST", "/api/customer/white-label-requests"],
  ["PUT", "/api/customer/notifications/read"],
  ["POST", "/api/customer/order-attachments"],
  ["POST", `/api/operator/white-label-requests/${absent}/notes`],
  ["PUT", `/api/operator/white-label-requests/${absent}/review`],
  ["PUT", "/api/plan-management/order"],
];
const results = [];
for (const [method, path] of routes) {
  for (const scenario of ["same-origin-anonymous", "cross-origin-anonymous"]) {
    const response = await fetch(origin + path, {
      method, redirect: "manual", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json",
        Origin: scenario === "same-origin-anonymous" ? origin : "https://audit.invalid",
        "Sec-Fetch-Site": scenario === "same-origin-anonymous" ? "same-origin" : "cross-site" },
      body: "{}",
    });
    await response.body?.cancel();
    const rejected = [401, 403].includes(response.status);
    results.push({ method, path, scenario, status: response.status, rejected });
    // Stop rather than continue probing an unexpected handler response.
    if (!rejected) {
      await writeFile("generated-artifacts/backend-audit/write-boundary-results.json", JSON.stringify(results, null, 2));
      throw Error(`Unexpected boundary response ${response.status}; stopped.`);
    }
  }
}
await writeFile("generated-artifacts/backend-audit/write-boundary-results.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify({ requests: results.length, rejected: results.filter(r => r.rejected).length,
  caveat: "Anonymous rejection only; not authenticated role authorization or CRUD persistence." }));

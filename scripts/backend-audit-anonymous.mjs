import { readFile, writeFile } from "node:fs/promises";
const inventory = JSON.parse(await readFile("generated-artifacts/backend-audit/api-inventory.json", "utf8"));
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
if (!/^[a-z0-9.-]+\.replit\.dev$/.test(process.env.REPLIT_DEV_DOMAIN ?? "")) throw Error("Development host required.");
const results = [];
for (const e of inventory.endpoints.filter(e => e.method === "GET" && !e.path.includes("${"))) {
  const path = e.path.replace(/:([A-Za-z]+)/g, (_, name) => /id$/i.test(name) ? "00000000-0000-4000-8000-000000000000" : "audit-nonexistent");
  const started = performance.now();
  try {
    const r = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    await r.body?.cancel();
    results.push({ method: "GET", path, status: r.status, elapsedMs: Math.round(performance.now() - started),
      functionalStatus: "NOT VERIFIED", evidence: "Anonymous HTTP only; no response data retained and no cookies sent." });
  } catch { results.push({ method: "GET", path, error: "REQUEST_FAILED", functionalStatus: "NOT VERIFIED" }); }
}
await writeFile("generated-artifacts/backend-audit/anonymous-http-results.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify({ requests: results.length, statuses: results.reduce((a, r) => (a[r.status ?? r.error] = (a[r.status ?? r.error] ?? 0) + 1, a), {}) }));

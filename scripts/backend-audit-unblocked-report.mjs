import { readFile, writeFile } from "node:fs/promises";
const dir = "generated-artifacts/backend-audit";
const read = async name => JSON.parse(await readFile(`${dir}/${name}`, "utf8"));
const map = await read("endpoint-caller-map.json");
const gets = await read("anonymous-http-results.json");
const writes = await read("write-boundary-results.json");
const indexes = await read("foreign-key-index-review.json");
const rows = indexes.result.output.trim().split("\n").slice(1).map(l => l.split(","));
const candidates = rows.filter(r => r[3] === "t");
const esc = x => String(x ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const table = (heads, rows) => `<div class="scroll"><table><tr>${heads.map(h => `<th>${esc(h)}</th>`).join("")}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table></div>`;
const counts = gets.reduce((a, r) => (a[r.status ?? r.error] = (a[r.status ?? r.error] ?? 0) + 1, a), {});
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unblocked backend audit checks</title>
<style>body{font:15px/1.6 system-ui;max-width:1200px;margin:40px auto;padding:0 22px;color:#182533}h1,h2{line-height:1.3}.notice{background:#fff1d5;padding:18px;border-left:4px solid #ab7400}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:9px;border:1px solid #ccd5de;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#edf2f7}.scroll{overflow:auto}h2{margin-top:35px}</style>
<h1>Unblocked backend audit checks</h1><p>Development only · ${esc(new Date().toISOString())}</p>
<p class="notice"><strong>Partial audit addendum, not a completion certificate.</strong> No new authenticated workflow is classified VERIFIED. This pass adds source mapping, live anonymous rejection checks and a read-only database index review. Prior customer workflow evidence remains separate.</p>
<h2>Results</h2><ul>
<li>${map.summary.endpoints} route registrations traced: ${map.summary.withCandidateFrontendCaller} have candidate frontend callers; ${map.summary.requiringManualCallerTrace} need further manual tracing.</li>
<li>${gets.length} anonymous GET requests: ${esc(JSON.stringify(counts))}. Expected missing-resource 404 and malformed-input 400 responses are not classified as broken features.</li>
<li>${writes.length} anonymous write-boundary probes across six reviewed routes: ${writes.filter(r => r.rejected).length} rejected with 401/403. Empty JSON, no cookies, nonexistent IDs; no DELETE, financial, publication, provisioning or Auth actions.</li>
<li>${rows.length} declared foreign keys checked for a valid, ready, non-partial leading index; ${candidates.length} lack that exact index shape. This does not prove slow queries, and does not rule out useful partial indexes.</li></ul>
<h2>Interpretation and classifications</h2>
${table(["Area","Classification","Evidence and limit"],[
["Endpoint-to-screen mapping","NOT VERIFIED","Source candidate matches only. Generated symbol references, relative API wrappers and literal paths traced; endpoint methods can share a path. Unused imports and indirect callers require manual review."],
["Anonymous GET access boundaries","NOT VERIFIED","Live status evidence only, not authenticated role/object isolation or returned-data correctness."],
["Protected write rejection","NOT VERIFIED","Twelve rejection checks passed; authenticated create/update behavior and database persistence remain untested in this pass."],
["Foreign-key index suitability","NOT VERIFIED","33 review candidates, not 33 defects. Query plans and workload sizes are required before recommending index changes."],
["Administrator review and notes","NOT VERIFIED","Retained native QA access remains blocked. No new identity, password reset, MFA change or bypass attempted."],
])}
<h2>Preservation</h2><p>No application runtime code, database schema, accounts, MFA factors, Production data, external providers or deployments were changed. No records were deleted. Changes are audit scripts and generated evidence only. Requests were limited to Development anonymous checks; database inspection used a read-only catalog query.</p>
<h2>Remaining work</h2><p>The full master audit is incomplete. Remaining areas include authenticated role and tenant isolation, admin/customer note synchronization, CRUD persistence, trials, publication, Auth delivery/recovery, provider sandboxes, background-job concurrency, migration equivalence, and query-plan analysis. The remaining caller gaps must not be labelled BACKEND ONLY without manual investigation; some are intentional webhook or asset endpoints.</p>
<h2>Anonymous write observations</h2>${table(["Method","Path","Scenario","HTTP"],writes.map(r=>[r.method,r.path,r.scenario,r.status]))}
<h2>Foreign-key index review candidates</h2>${table(["Schema","Table","Foreign key"],candidates.map(r=>r.slice(0,3)))}
<h2>Endpoint mapping</h2>${table(["Method/path","Route source","Candidate frontend callers","Imported services"],map.endpoints.map(e=>[
`${e.method} ${e.path}`,e.route,e.callers.map(c=>`${c.file} ${c.generatedSymbols.join(", ")}`).join("\n") || "Manual trace required",
e.serviceImports.map(s=>`${s.module}: ${s.symbols.join(", ")}`).join("\n") || "Manual service trace required"]))}
<h2>Anonymous GET observations</h2>${table(["Path","HTTP","Elapsed ms"],gets.map(r=>[r.path,r.status??r.error,r.elapsedMs]))}
<p>Machine-readable evidence: endpoint-caller-map.json, anonymous-http-results.json, write-boundary-results.json, foreign-key-index-review.json. Timing values are single observations, not load-test results.</p></html>`;
await writeFile(`${dir}/unblocked-audit-addendum.html`, html);
console.log(JSON.stringify({ file: `${dir}/unblocked-audit-addendum.html`, ...map.summary, getStatuses: counts,
  writeChecks: writes.length, indexCandidates: candidates.length }));

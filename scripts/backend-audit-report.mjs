import { readFile, writeFile } from "node:fs/promises";
const dir = "generated-artifacts/backend-audit";
const api = JSON.parse(await readFile(`${dir}/api-inventory.json`, "utf8"));
const db = JSON.parse(await readFile(`${dir}/database-inventory.json`, "utf8"));
const ui = JSON.parse(await readFile(`${dir}/frontend-inventory.json`, "utf8"));
const map = JSON.parse(await readFile(`${dir}/backend-map.json`, "utf8"));
const probes = JSON.parse(await readFile(`${dir}/anonymous-http-results.json`, "utf8"));
const esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const table = (headers, rows) => `<div class="scroll"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const matrix = [
  ["Customer request submission", "VERIFIED", "Native customer UI → HTTP 201 → exact database row → refreshed list/detail → native re-login. Development only; one new request."],
  ["Request retry idempotency", "VERIFIED", "Same-session identical key returned the same ID; exactly one customer request in DB. Different-key concurrency is not covered."],
  ["Requirement upload/download", "VERIFIED", "90-byte harmless file uploaded and linked in DB; authenticated download bytes matched. Anonymous request returned 401."],
  ["Malformed domain rejection", "VERIFIED", "Invalid domain blocked by UI; otherwise valid authenticated POST rejected with HTTP 400 before insert."],
  ["Draft restoration", "NOT VERIFIED", "Basic refresh/history verified. Uploaded-file validator failure fixed and regression-tested; no full post-fix attachment browser replay. Browser-session storage, not DB persistence."],
  ["Development commerce mail capture", "VERIFIED", "Matching database outbox event and private receipt; externallyDelivered=false. No inbox delivery claim."],
  ["Administrator review, notes and cross-role visibility", "NOT VERIFIED", "Fresh admin sign-in/TOTP and list GET succeeded, but detail/edit journey stopped on test-harness failures. No review action performed."],
  ["Plan draft create/edit", "NOT VERIFIED", "Prior pass had database evidence; not independently repeated in this audit. Publication and rollback not exercised."],
  ["Trial cancellation, deadlines and reminders", "NOT VERIFIED", "Policy regression tests passed; browser/DB lifecycle verification outstanding."],
  ["Tenant admin CRUD and permissions", "NOT VERIFIED", "Routes/services inventoried; current-pass cross-tenant native UI and DB mutation journeys incomplete."],
  ["Auth signup, verification and password/MFA recovery", "NOT VERIFIED", "Auth provider mail is separate from the commerce capture. Unit tests are not native delivery/recovery proof."],
  ["Provider integration, webhooks, settlement and reconciliation", "NOT VERIFIED", "No live financial or provider execution. No sandbox end-to-end settlement performed."],
  ["Provisioning, domains, release publication and delivery", "NOT VERIFIED", "No external hosting, DNS, publication or delivery writes."],
  ["Non-Exchange advertised products", "FRONTEND ONLY", "Existing product descriptions explicitly state planned/non-executing capabilities. Not implemented as financial products in this audit."],
  ["Database integrity", "NOT VERIFIED", "All local tables/catalogs and declared FK orphan checks inspected, but full semantic integrity and migration equivalence are not established."],
  ["Production and external recovery", "NOT VERIFIED", "Production untouched. Prior refusal of Production capture remains in force."],
];
const architecture = [
 ["Entry points", "app.ts wires Express, request guards and error handling; index.ts starts API, integration monitoring and trial monitoring; worker.ts supports opt-in singleton provider monitoring."],
 ["Routing", "routes/index.ts composes public/demo/Auth/customer/commerce/tenant/operator routers. Demo-isolation middleware can intercept routes before normal controllers."],
 ["Authentication / authorization", "Supabase session middleware resolves principals. Services apply role and tenant checks; transaction context sets per-request RLS claims. Static hints in inventory are not authorization verdicts."],
 ["Persistence", "lib/db uses pg/Drizzle, pooled transactional service calls and RLS context. Private Auth and commerce schemas coexist with public tenant data. Production support may use separate restricted connection roles."],
 ["Customers", "ConfigureExchange → generated request hook → customer router → submitRequest → request, attachment/event/outbox records. Operator review uses the same request aggregate with role-specific views."],
 ["Commercial logic", "Plan management/version publication, subscriptions and trial policies are separate from manual invoice/report/settlement flows. BigInt money utilities have regression coverage, not live settlement proof."],
 ["External integrations", "Provider catalog/configuration and vault-backed adapters are distinct. Catalog presence is not working connectivity; real provider credentials and sandbox calls were not exercised."],
 ["Background work", "Commerce polling captured one real test event. Trial sweeper and provider health monitor inspected, not independently verified for concurrency, retries or backlog throughput."],
 ["Performance", "Anonymous route elapsed times retained as observations only. No load test, EXPLAIN-based index tuning, N+1 certification or production performance claim."],
];
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Backend verification report</title><style>
body{font:15px/1.55 system-ui,sans-serif;max-width:1200px;margin:40px auto;padding:0 24px;color:#17212e}h1,h2{line-height:1.2}h2{margin-top:38px}.notice{padding:18px;background:#fff1d6;border-left:5px solid #b37a16}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;border:1px solid #dbe1e7;padding:9px}th{background:#eef3f8}code{overflow-wrap:anywhere}details{margin:18px 0}summary{font-weight:bold;cursor:pointer}small{color:#526174}</style>
<h1>Backend and database verification</h1><p>Development-only audit · ${esc(new Date().toISOString())}</p>
<div class="notice"><strong>Partial completion—not a whole-platform sign-off.</strong> The attached master task requests every feature and CRUD workflow. This pass fixed confirmed defects, verified one customer submission journey, ran regressions and inventoried the application. Many authenticated, administrative, financial, recovery and deployment workflows remain NOT VERIFIED. No endpoint is certified solely because it appears in an inventory.</div>
<h2>Evidence summary</h2><ul><li>303 backend regression tests passed across 59 files with real credentials withheld. Six intake regression tests and the mail guard test also passed.</li>
<li>${db.tables.length} Development tables; ${db.columns.length} columns; ${db.constraints.length} constraints; ${db.indexes.length} indexes; ${db.orphanChecks.length} declared-FK checks. Zero declared-FK orphans, invalid indexes or unvalidated constraints found.</li>
<li>${api.endpoints.length} explicit route registrations, ${ui.length} frontend component files and ${map.modules.length} backend module files inventoried. Dynamic middleware and indirect/generated callers require further tracing.</li>
<li>${probes.length} anonymous GET probes: 11 HTTP 200, 52 HTTP 401, 14 HTTP 404, 2 HTTP 400. These are limited reachability/boundary observations, not full workflow verification.</li></ul>
<h2>Corrections</h2>${table(["Issue","Severity / action","Files"],[
 ["Malformed requested domain accepted","Medium: server and client now reject URL syntax and malformed hostnames before submission.","modules/customer/service.ts; components/customer/configure-state.ts"],
 ["Draft lost on navigation/refresh","Medium: identity-scoped, 24-hour browser-session draft with retry key; cleared on successful submission. Storage failure warning shown.","components/customer/configure.tsx; configure-draft.ts"],
 ["Uploaded-file draft rejected","Medium: use actual fileName response field rather than name; regression fixture passed.","components/customer/configure-draft.ts; configure-state.test.ts"],
 ["Development request email could reach real recipients","Test-safety blocker: explicit Development-only commerce capture, fail-closed outside Development; private hash receipts; no external send fallback.","modules/commerce/development-mail.ts; email.ts; Development environment flag"]
])}
<p>The commerce outbox retains its existing <code>sent</code> transport-completion state, with an explicit capture marker and <code>deliveryMode=development_capture</code>. It is not proof of recipient delivery. Auth SMTP/email-OTP is not intercepted by this sink.</p>
<h2>Workflow classifications</h2>${table(["Feature","Status","Evidence / boundary"],matrix)}
<h2>Architecture map</h2>${table(["Area","Implementation / inspection"],architecture)}
<h2>Preservation and test fixtures</h2><p>No Production changes, DNS actions, provider activation, financial execution or destructive cleanup. Existing requests and original administrators were preserved. One new request and two harmless QA attachments remain (one attachment is unlinked after an interrupted upload). Two additional QA administrator identities/grants were created during failed review-test attempts; their factors were not removed, and their credentials were not retained. They require an explicitly authorized cleanup/access decision. Do not create more identities to work around harness failures.</p>
<h2>Remaining scope</h2><p>Not completed: exhaustive caller-to-controller tracing; every CRUD mutation/deletion; authenticated tenant isolation; complete Admin/Super Admin review and synchronization; trial lifecycle; native Auth delivery/recovery; provider/payment sandboxes; webhook concurrency; migration equivalence; undeclared-relationship/duplicate-business-record analysis; query-plan performance assessment; backup recovery; Production verification. Source files and endpoint registrations in the appendices remain NOT VERIFIED unless a specific bounded workflow above has runtime evidence.</p>
<details><summary>API inventory (${api.endpoints.length})</summary>${table(["Method","Path","Source","Status"],api.endpoints.map(e=>[e.method,e.path,`${e.file}:${e.line}`,e.status]))}</details>
<details><summary>Frontend integration inventory (${ui.length})</summary>${table(["Component","Interactions","API hooks / literal paths","Status"],ui.map(e=>[e.file,e.interactions,[...e.apiHooks,...e.literalApiPaths].join(", "),e.status]))}</details>
<details><summary>Backend modules and SQL table references</summary>${table(["Module","Static SQL references","Status"],map.modules.map(e=>[e.file,e.tablesMentioned.join(", "),e.status]))}</details>
<details><summary>Database table inventory</summary>${table(["Schema","Table","RLS / forced","Bytes"],db.tables.map(e=>[e.schema,e.name,`${e.rls} / ${e.force_rls}`,e.bytes]))}</details>
<details><summary>Relationships and constraints</summary>${table(["Schema/table","Constraint","Type","Definition","Validated"],db.constraints.map(e=>[`${e.schema}.${e.table_name}`,e.name,e.type,e.definition,e.validated]))}</details>
<details><summary>Database indexes</summary>${table(["Schema/table","Index","Definition","Valid / ready"],db.indexes.map(e=>[`${e.schema}.${e.table_name}`,e.name,e.definition,`${e.valid} / ${e.ready}`]))}</details>
<details><summary>Anonymous HTTP observations</summary>${table(["Path","HTTP","Elapsed ms"],probes.map(e=>[e.path,e.status??e.error,e.elapsedMs]))}</details>
<h2>Evidence files</h2><p>Sanitized browser reports, private exact-scope manifests, database catalog results and regression logs are retained under <code>generated-artifacts/backend-audit/</code>. Browser credentials, session cookies and TOTP material are not included in this report.</p></html>`;
await writeFile(`${dir}/backend-verification-report.html`, html);
console.log(`${dir}/backend-verification-report.html`);

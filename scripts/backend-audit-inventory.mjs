// Static discovery is explicitly NOT functional verification.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".local", ".replit-artifact"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else if (/\.(ts|tsx|sql)$/.test(path)) out.push(path);
  }
  return out;
}
const output = "generated-artifacts/backend-audit";
await mkdir(output, { recursive: true });
const backend = await walk("artifacts/api-server/src");
const frontend = [...await walk("artifacts/private-label-console/src"), ...await walk("artifacts/private-label-website/src")];
const database = await walk("lib/db");
const sources = new Map(await Promise.all([...backend, ...frontend, ...database].map(async p => [p, await readFile(p, "utf8")])));
const lineAt = (s, at) => s.slice(0, at).split("\n").length;
const endpoints = [];
for (const file of backend.filter(f => f.includes("/routes/") && !f.endsWith(".test.ts"))) {
  const text = sources.get(file);
  const matches = [...text.matchAll(/\b(?:router|[A-Za-z]+Router)\.(get|post|put|patch|delete|head|options|all)\(\s*(['"`])([^'"`]+)\2/g)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i], body = text.slice(match.index, matches[i + 1]?.index ?? text.length);
    endpoints.push({ method: match[1].toUpperCase(), path: `/api${match[3]}`, file, line: lineAt(text, match.index),
      calls: [...new Set([...body.matchAll(/\b([A-Za-z_]\w*)\(/g)].map(m => m[1]))],
      localAuthenticationHint: /requireAuthentication|principalFrom|requireSuperAdmin/.test(body),
      localValidationHint: /\.parse\(|safeParse\(/.test(body),
      status: "NOT VERIFIED", note: "Static route discovery; inherited middleware and downstream authorization require separate tracing. No hint is a security verdict." });
  }
}
// Expand the two bounded route-registration loops, retaining source location.
for (let i = endpoints.length - 1; i >= 0; i--) {
  const entry = endpoints[i];
  const token = entry.path.includes("${prefix}") ? "prefix" : entry.path.includes("${action}") ? "action" : null;
  if (!token) continue;
  const values = token === "prefix" ? ["operator", "customer"] : ["confirm", "reject"];
  endpoints.splice(i, 1, ...values.map(value => ({ ...entry, path: entry.path.replace(`\${${token}}`, value) })));
}
const components = frontend.filter(f => /\/(?:pages|components)\//.test(f) && /\.tsx$/.test(f)).map(file => {
  const text = sources.get(file);
  return { file, interactions: (text.match(/\bon(?:Click|Submit|Change|Select|Blur)\s*=/g) ?? []).length,
    apiHooks: [...new Set([...text.matchAll(/\b(use(?:Get|List|Create|Update|Delete|Submit|Save|Patch|Publish|Cancel|Append|Retry)\w+)\(/g)].map(m => m[1]))],
    literalApiPaths: [...new Set([...text.matchAll(/['"`](\/api\/[^'"`\s]+)/g)].map(m => m[1]))],
    status: "NOT VERIFIED", note: "Generated API hooks and shared child components require indirect caller tracing." };
});
const modules = backend.filter(f => f.includes("/modules/") && !f.endsWith(".test.ts")).map(file => ({
  file, tablesMentioned: [...new Set([...sources.get(file).matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z_0-9.]*)/gi)].map(m => m[1]))],
  status: "NOT VERIFIED",
}));
await writeFile(`${output}/api-inventory.json`, JSON.stringify({ generatedAt: new Date().toISOString(),
  discoveryMethod: "Literal Express route registrations; dynamic registrations need manual review", endpoints }, null, 2));
await writeFile(`${output}/frontend-inventory.json`, JSON.stringify(components, null, 2));
await writeFile(`${output}/backend-map.json`, JSON.stringify({ modules,
  databaseFiles: database, entryPoints: backend.filter(p => /\/(app|index|worker)\.ts$/.test(p)),
  routeFiles: backend.filter(p => p.includes("/routes/") && !p.endsWith(".test.ts")),
  testFiles: backend.filter(p => p.endsWith(".test.ts")) }, null, 2));
console.log(JSON.stringify({ routeRegistrations: endpoints.length, frontendComponents: components.length, moduleFiles: modules.length, databaseFiles: database.length }));

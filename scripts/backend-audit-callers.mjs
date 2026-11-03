// Conservative source tracing, not proof that a workflow executes successfully.
import ts from "typescript";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";

const root = process.cwd();
const out = "generated-artifacts/backend-audit";
async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".local"].includes(e.name)) continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) files.push(...await walk(p));
    else if (/\.(ts|tsx)$/.test(p) && !p.endsWith(".test.ts")) files.push(p);
  }
  return files;
}
const paths = [...await walk("artifacts/api-server/src"), ...await walk("artifacts/private-label-console/src"),
  ...await walk("artifacts/private-label-website/src"), ...await walk("lib/api-client-react/src")];
const files = new Map(await Promise.all(paths.map(async path => {
  const text = await readFile(path, "utf8");
  return [path, { text, ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), imports: [], identifiers: new Set(), literals: [] }];
})));
function visit(node, fn) { fn(node); ts.forEachChild(node, child => visit(child, fn)); }
for (const [path, f] of files) {
  visit(f.ast, n => {
    if (ts.isIdentifier(n)) f.identifiers.add(n.text);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      const text = ts.isTemplateExpression(n) ? n.getText(f.ast).slice(1, -1) : n.text;
      // Include the reviewed commerce call() wrapper's relative API paths,
      // BASE_URL-prefixed fetches, and wl.ts's API-prefixed attachment URLs.
      const value = text.replace(/^\$\{import\.meta\.env\.BASE_URL\}api\//, "/api/")
        .replace(/^\$\{API\}/, "/api");
      if (value.startsWith("/")) f.literals.push(value);
    }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      const bindings = n.importClause?.namedBindings;
      const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.map(e => ({ local: e.name.text, imported: (e.propertyName ?? e.name).text })) : [];
      const base = spec.startsWith(".") ? relative(root, resolve(dirname(path), spec)) : spec.startsWith("@/") ? path.split("/src/")[0] + "/src/" + spec.slice(2) : null;
      const target = base ? [base, base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx"].find(p => files.has(p)) : undefined;
      f.imports.push({ spec, target, names });
    }
  });
}
const normalize = p => p.split("?")[0].replace(/\$\{[^}]+\}|:[A-Za-z_]\w*/g, "{}");
const generated = files.get("lib/api-client-react/src/generated/api.ts");
const symbols = new Map();
for (const node of generated.ast.statements) {
  const declarations = ts.isFunctionDeclaration(node) && node.name ? [[node.name.text, node]] :
    ts.isVariableStatement(node) ? node.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => [d.name.text, d]) : [];
  for (const [name, decl] of declarations) {
    const refs = new Set(), urls = new Set();
    visit(decl, n => {
      if (ts.isIdentifier(n)) refs.add(n.text);
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
        const value = ts.isTemplateExpression(n) ? n.getText(generated.ast).slice(1, -1) : n.text;
        if (value.startsWith("/api/")) urls.add(normalize(value));
      }
    });
    symbols.set(name, { refs, urls });
  }
}
function urlsFor(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const s = symbols.get(name);
  if (!s) return [];
  return [...s.urls, ...[...s.refs].flatMap(r => urlsFor(r, seen))];
}
const ui = [...files].filter(([p]) => /^artifacts\/private-label-(console|website)\/src\//.test(p));
const inventory = JSON.parse(await readFile(`${out}/api-inventory.json`, "utf8"));
const endpoints = inventory.endpoints.map(e => {
  const path = normalize(e.path), callers = [];
  for (const [file, f] of ui) {
    const generatedSymbols = f.imports.filter(i => i.spec === "@workspace/api-client-react")
      .flatMap(i => i.names).filter(n => urlsFor(n.imported).includes(path)).map(n => n.imported);
    const literalPaths = f.literals.filter(p => {
      const candidates = [p, `/api${p}`];
      if (file.endsWith("/commerce/payment-panel.tsx"))
        candidates.push(`/api${p.replace("${role}", "operator")}`, `/api${p.replace("${role}", "customer")}`);
      return candidates.some(c => normalize(c) === path);
    });
    if (generatedSymbols.length || literalPaths.length) callers.push({ file, generatedSymbols, literalPaths });
  }
  const route = files.get(e.file);
  const serviceImports = route.imports.filter(i => i.spec.includes("/modules/") || i.spec.includes("/products/"))
    .map(i => ({ module: i.target ?? i.spec, symbols: i.names.filter(n => e.calls.includes(n.local)).map(n => n.imported) }))
    .filter(i => i.symbols.length);
  return { method: e.method, path: e.path, route: `${e.file}:${e.line}`, callers, serviceImports,
    status: "NOT VERIFIED", evidenceType: "static-path-and-symbol-trace",
    caveat: "Path matching can join GET and mutation callers. Imported symbols may be unused. Namespace services and indirect wrapper calls require manual review. No caller match does not prove BACKEND ONLY." };
});
const report = { generatedAt: new Date().toISOString(), endpoints,
  summary: { endpoints: endpoints.length, withCandidateFrontendCaller: endpoints.filter(e => e.callers.length).length,
    requiringManualCallerTrace: endpoints.filter(e => !e.callers.length).length },
  limitations: "Conservative source evidence only. Not authenticated execution, SQL persistence, or a security certification." };
await writeFile(`${out}/endpoint-caller-map.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary));

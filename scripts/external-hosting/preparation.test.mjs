import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createStaticHandler } from "../../lib/production-access-gate/static-handler.mjs";
import { targetConfiguration } from "../external-postgres/migrate.mjs";
import { createHash } from "node:crypto";

test("Staging release uses a Preview deployment, not the Production alias", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/external-release.yml", import.meta.url), "utf8");
  const preview = workflow.split("- name: Deploy Vercel staging Preview")[1]
    ?.split("- name: Release Vercel Production package")[0];
  assert.ok(preview, "Staging deployment step is required");
  assert.match(preview, /if: inputs\.target == 'qxlayer-staging'/);
  assert.match(preview, /deploy --prebuilt --yes/);
  assert.doesNotMatch(preview, /--prod/);
  assert.match(workflow, /name: Release Vercel Production package to protected project\s+if: inputs\.target == 'qxlayer-production'/);
});

test("Migration approval/target pins fail closed and refuse Replit/transaction pooling", () => {
  assert.throws(() => targetConfiguration({}));
  const base = { QXLAYER_EXTERNAL_MIGRATIONS_APPROVED:"true", SUPABASE_PROJECT_REF:"syntheticproject",
    MIGRATION_EXPECTED_HOST:"db.syntheticproject.supabase.co", DB_TLS_CA_FILE:"test-only.pem" };
  assert.throws(() => targetConfiguration({...base,MIGRATION_DATABASE_URL:"postgresql://postgres@replit.example/postgres"}));
  assert.throws(() => targetConfiguration({...base,MIGRATION_DATABASE_URL:"postgresql://postgres@db.otherproject.supabase.co/postgres"}));
  assert.throws(() => targetConfiguration({...base,MIGRATION_DATABASE_URL:"postgresql://postgres@db.syntheticproject.supabase.co:6543/postgres"}));
  assert.throws(() => targetConfiguration({...base,QXLAYER_MIGRATION_TEST:"true",NODE_ENV:"production",
    MIGRATION_DATABASE_URL:"postgresql://postgres@localhost/postgres"}));
  assert.ok(targetConfiguration({...base,MIGRATION_DATABASE_URL:"postgresql://postgres@db.syntheticproject.supabase.co/postgres"}).caFile);
});
test("Versioned SQL has intact checksums, no rows and complete RLS/reference", async () => {
  const dir = new URL("../../deploy/migrations/",import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json",dir),"utf8"));
  for (const entry of manifest) {
    const sql = await readFile(new URL(entry.source ?? entry.file,dir),"utf8");
    assert.equal(createHash("sha256").update(sql).digest("hex"),entry.sha256);
    assert.doesNotMatch(sql,/\b(?:INSERT INTO|COPY .* FROM stdin|TRUNCATE|DROP TABLE)\b|(?:ALTER|CREATE)\s+(?:ROLE|USER)[^;]*\bPASSWORD\b/i);
  }
  const ref = JSON.parse(await readFile(new URL("rls-reference.json",dir),"utf8"));
  assert.equal(ref.tables.length,44);
  assert(ref.tables.some(t=>t.name==="global_exchange_catalog"));
  assert(ref.tables.some(t=>t.name==="global_exchange_catalog_links"));
  for (const table of ref.tables) {
    assert.equal(table.forced,true); assert.equal(table.enabled,true); assert.equal(table.policies.length,2);
    assert.ok(table.policies.every(p=>p.using && (p.command!=="*" || p.check)));
  }
});
test("Vercel handler preserves gate, separate SPA routes, HEAD and missing-asset 404", async () => {
  const root = await mkdtemp(path.join(tmpdir(),"qx-static-"));
  await mkdir(path.join(root,"private-label-website"));
  await writeFile(path.join(root,"index.html"),"console-synthetic");
  await writeFile(path.join(root,"private-label-website/index.html"),"website-synthetic");
  let server;
  async function start(env) {
    server = createServer(createStaticHandler(root,env));
    server.listen(0,"127.0.0.1"); await once(server,"listening");
    return `http://127.0.0.1:${server.address().port}`;
  }
  try {
    let origin = await start({ NODE_ENV:"production",PRODUCTION_ACCESS_GATE_ENABLED:"true",PRODUCTION_ACCESS_CODE:"synthetic-access-test-only" });
    const locked = await fetch(`${origin}/`,{headers:{Accept:"text/html"}});
    assert.match(await locked.text(),/Private Access/);
    await new Promise(resolve=>server.close(resolve));
    origin = await start({ PRODUCTION_ACCESS_GATE_ENABLED:"false" });
    assert.equal(await (await fetch(`${origin}/admin/tenants`)).text(),"console-synthetic");
    assert.equal(await (await fetch(`${origin}/private-label-website/synthetic-a/orders`)).text(),"website-synthetic");
    assert.equal((await fetch(`${origin}/private-label-website/assets/missing.js`)).status,404);
    assert.equal((await fetch(`${origin}/assets/missing.css`)).status,404);
    assert.equal((await fetch(`${origin}/admin`,{method:"HEAD"})).status,200);
    assert.equal(await (await fetch(`${origin}/admin`,{method:"HEAD"})).text(),"");
  } finally { if(server) await new Promise(resolve=>server.close(resolve)); await rm(root,{recursive:true,force:true}); }
});

test("Frontend signed access form remains valid at the fixed-origin Render API gate", async () => {
  const {createAccessGate} = await import("../../lib/production-access-gate/index.mjs");
  const env = {NODE_ENV:"production",PRODUCTION_ACCESS_GATE_ENABLED:"true",
    PRODUCTION_ACCESS_CODE:"synthetic-access-test-only",QXLAYER_DATABASE_PROVIDER:"supabase",
    QXLAYER_PLATFORM_URL:"https://synthetic-platform.example.invalid"};
  const frontGate=createAccessGate({env,basePath:"/"});
  const apiGate=createAccessGate({env,basePath:"/api"});
  const server=createServer((req,res)=>{
    const gate=req.url.startsWith("/api/")?apiGate:frontGate;
    void gate(req,res,()=>res.end("synthetic-unlocked"));
  });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    const locked=await fetch(origin,{headers:{Accept:"text/html"}});
    const html=await locked.text();
    const token=html.match(/name="csrf" value="([^"]+)"/)?.[1];
    assert.ok(token);
    const cookie=locked.headers.get("set-cookie").split(";")[0];
    const body=new URLSearchParams({csrf:token,accessCode:env.PRODUCTION_ACCESS_CODE,returnTo:"/admin/tenants"});
    const denied=await fetch(`${origin}/api/__qx_access/enter`,{method:"POST",redirect:"manual",
      headers:{"Content-Type":"application/x-www-form-urlencoded",Cookie:cookie,Origin:"https://attacker.example.invalid"},body});
    assert.equal(denied.status,403);
    const unlocked=await fetch(`${origin}/api/__qx_access/enter`,{method:"POST",redirect:"manual",
      headers:{"Content-Type":"application/x-www-form-urlencoded",Cookie:cookie,Origin:env.QXLAYER_PLATFORM_URL},body});
    assert.equal(unlocked.status,303); assert.equal(unlocked.headers.get("location"),"/admin/tenants");
    const session=unlocked.headers.get("set-cookie").split(";")[0];
    assert.equal(await (await fetch(`${origin}/admin/tenants`,{headers:{Cookie:session}})).text(),"synthetic-unlocked");
  } finally {await new Promise(resolve=>server.close(resolve));}
});

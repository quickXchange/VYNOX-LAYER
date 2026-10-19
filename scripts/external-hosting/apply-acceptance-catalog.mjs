// Explicit operator command; never imported by startup or automatic synchronization.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
const {Client}=createRequire(new URL("../../lib/db/package.json",import.meta.url))("pg");
import {protectedOperator,protectedState,encryptedSnapshot,hash,REPORT,restrictedClient} from "./plan-entitlements-operator.mjs";

const apply=process.argv.includes("--apply-approved-acceptance-catalog");
assert(apply || process.argv.includes("--rehearse"), "Explicit apply or rollback rehearsal required");
const ctx=await protectedOperator();
const response=await fetch("https://api.render.com/v1/services/srv-db5b47qjnfac739s374g/env-vars?limit=100",{
 headers:{Authorization:`Bearer ${process.env.RENDER_API_KEY}`},signal:AbortSignal.timeout(25000)});
assert(response.ok);const variables=await response.json();assert(variables.length<100);
const env={...ctx.env,...Object.fromEntries(variables.map(v=>[v.envVar.key,v.envVar.value]))};
assert.equal(env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED,"true");
assert.equal(env.QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION,"true");
assert.equal(env.QXLAYER_PLATFORM_URL,"https://qxlayer-acceptance-vynox3.vercel.app");
assert.equal(env.PRODUCTION_ACCESS_GATE_ENABLED,"true");
assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED,"false");
assert.notEqual(env.QXLAYER_PUBLIC_PREPARATION_APPROVED,"true");
// In-memory runtime configuration only; credentials are never persisted or printed.
Object.assign(process.env,env);
const file="0010_acceptance_catalog.sql";
const sql=await readFile(new URL(`../../deploy/migrations/${file}`,import.meta.url),"utf8");
assert(!/^\s*(BEGIN|COMMIT)\s*;/mi.test(sql),"Operator owns the transaction");
const c=ctx.client;let committed=false,stage="initialize";
const temporary=await mkdtemp(join(tmpdir(),"acceptance-catalog-"));
const publication=async()=>hash((await c.query("SELECT * FROM qxlayer_commerce.pricing_publication ORDER BY singleton")).rows);
try{
 await writeFile(join(temporary,"ca.pem"),ctx.ca,{mode:0o600});
 process.env.DB_TLS_CA_FILE=join(temporary,"ca.pem");
 const {draftOffers,pricingRevision}=await import("../../artifacts/api-server/src/modules/commerce/pricing-publication.ts");
 await c.connect();
 const backup=apply?await encryptedSnapshot(ctx):null;
 await c.query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s'");
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('acceptance-catalog-migration',0))");
 const before=await protectedState(c),publishedBefore=await publication();
 stage="migration";
 const existing=(await c.query("SELECT sha256 FROM qxlayer_migrations.versions WHERE file=$1",[file])).rows[0];
 if(existing)assert.equal(existing.sha256,hash(sql),"Immutable migration checksum");
 else{
  assert.equal((await c.query("SELECT to_regnamespace('qxlayer_acceptance_catalog') present")).rows[0].present,null,"Untracked private schema must be reviewed");
  await c.query(sql);
  await c.query("INSERT INTO qxlayer_migrations.versions(file,sha256) VALUES($1,$2)",[file,hash(sql)]);
 }
 const tiers=[
  ["a4000000-0000-4000-8000-000000000001",39,390,149,3,2,2,1,100,10000],
  ["a4000000-0000-4000-8000-000000000002",99,990,399,10,10,5,5,1000,1000000],
  ["a4000000-0000-4000-8000-000000000003",249,2490,999,25,25,15,15,10000,10000000],
 ];
 // A rerun must not overwrite subsequent operator edits.
 if(!existing){
  stage="configure-private-plans";
  await c.query("UPDATE qxlayer_acceptance_catalog.plans SET status='disabled'");
  await c.query("UPDATE qxlayer_acceptance_catalog.addons SET enabled=false");
  const definitions=(await c.query("SELECT key,kind FROM public.entitlement_definitions ORDER BY key")).rows;
  for(const [id,monthly,yearly,setup,assets,networks,methods,staff,orders,volume] of tiers){
   const changed=await c.query(`UPDATE qxlayer_acceptance_catalog.plans SET monthly_price=$2,yearly_price=$3,setup_fee=$4,
     currency='EUR',pricing_configured=true,status='enabled',discount_percent=0,
     description='Approved Acceptance-only White Label Exchange plan. Simulated activity only; no live financial execution.',
     updated_at=now() WHERE id=$1 RETURNING id`,[id,monthly,yearly,setup]);
   assert.equal(changed.rowCount,1);
   const limits={max_supported_assets:assets,max_supported_networks:networks,max_payment_methods:methods,max_staff:staff,
    max_monthly_transactions:orders,max_monthly_volume:volume,max_api_keys:0,max_webhooks:0};
   await c.query("DELETE FROM qxlayer_acceptance_catalog.plan_entitlements WHERE plan_id=$1",[id]);
   for(const d of definitions){
    assert(d.kind==="feature" || d.key in limits,`Unreviewed limit ${d.key}`);
    const value=d.kind==="feature"?["website","crypto_exchange","swap","convert"].includes(d.key):String(limits[d.key]);
    await c.query("INSERT INTO qxlayer_acceptance_catalog.plan_entitlements(plan_id,key,value) VALUES($1,$2,$3)",[id,d.key,JSON.stringify(value)]);
   }
   await c.query(`INSERT INTO qxlayer_acceptance_catalog.offer_settings(plan_id,monthly,yearly) VALUES($1,true,true)
    ON CONFLICT(plan_id) DO UPDATE SET monthly=true,yearly=true`,[id]);
  }
  stage="private-publication";
  const payload=await draftOffers(c);
  assert.deepEqual(payload.plans.map(p=>p.id).sort(),tiers.map(t=>t[0]).sort());
  assert.equal(payload.purchaseAvailable,false,"Acceptance must not enable purchases");
  await c.query(`INSERT INTO qxlayer_acceptance_catalog.pricing_publication(singleton,payload,revision) VALUES(true,$1,$2)
   ON CONFLICT(singleton) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,published_at=now()`,
   [JSON.stringify(payload),pricingRevision(payload)]);
 }
 stage="preservation";
 assert.deepEqual(await protectedState(c),before,"Shared application records and security must remain identical");
 assert.equal(await publication(),publishedBefore,"Official publication must remain identical");
 await c.query(apply?"COMMIT":"ROLLBACK");committed=apply;
 if(apply){
  stage="restricted-login-verification";
  assert.deepEqual(await protectedState(c),before,"Post-commit shared state preservation");
  assert.equal(await publication(),publishedBefore);
  const runtime=restrictedClient(ctx);
  try{
   await runtime.connect();await runtime.query("BEGIN; SET LOCAL ROLE qxlayer_runtime");
   assert.equal((await runtime.query("SELECT count(*)::int n FROM qxlayer_acceptance_catalog.plans WHERE status='enabled'")).rows[0].n,3);
   assert.equal((await runtime.query("UPDATE qxlayer_acceptance_catalog.plans SET name=name RETURNING id")).rowCount,0);
   await runtime.query("SELECT set_config('app.is_super_admin','true',true),set_config('app.can_write','true',true)");
   assert.equal((await runtime.query("UPDATE qxlayer_acceptance_catalog.plans SET name=name WHERE status='enabled' RETURNING id")).rowCount,3);
   await runtime.query("ROLLBACK");
  }finally{await runtime.end();}
  const pr=await fetch("https://api.render.com/v1/services/srv-dba0q0gm7kps73f1k9fg/env-vars?limit=100",{
   headers:{Authorization:`Bearer ${process.env.RENDER_API_KEY}`},signal:AbortSignal.timeout(25000)});
  assert(pr.ok);const pv=await pr.json();assert(pv.length<100);
  const pe=Object.fromEntries(pv.map(v=>[v.envVar.key,v.envVar.value]));
  const publicUrl=new URL(pe.DATABASE_URL);
  assert.equal(publicUrl.hostname,ctx.url.hostname);
  assert.equal(decodeURIComponent(publicUrl.username),"qxlayer_public_app.qcgvhlphalxqzzsxqjhi");
  publicUrl.search="";
  const publicClient=new Client({connectionString:publicUrl.toString(),ssl:{ca:ctx.ca,rejectUnauthorized:true,servername:publicUrl.hostname},enableChannelBinding:true});
  try{
   await publicClient.connect();await publicClient.query("BEGIN; SET LOCAL ROLE qxlayer_runtime");
   await publicClient.query("SELECT set_config('app.is_super_admin','true',true),set_config('app.can_write','true',true)");
   assert.equal((await publicClient.query("SELECT count(*)::int n FROM qxlayer_acceptance_catalog.plans")).rows[0].n,0);
   assert.equal((await publicClient.query("UPDATE qxlayer_acceptance_catalog.plans SET name=name RETURNING id")).rowCount,0);
   await assert.rejects(publicClient.query("INSERT INTO qxlayer_acceptance_catalog.catalog_audit_events(actor_id,event_type,description) VALUES('isolation-probe','probe','Must be denied')"),e=>e.code==="42501");
   await publicClient.query("ROLLBACK");
  }finally{await publicClient.end();}
 }
 const report={applied:apply,migration:file,checksum:hash(sql),sharedDataAndSecurityPreserved:true,
  officialPublicationPreserved:true,privatePlansPublished:apply,financialExecution:false,backup,checkedAt:new Date().toISOString()};
 if(apply)await writeFile(new URL("acceptance-catalog-commit.json",REPORT),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch(error){
 await c.query("ROLLBACK").catch(()=>{});
 console.error(JSON.stringify({failed:true,committed,stage,code:error.code??"VERIFICATION_FAILED",
  message:error.code==="ERR_ASSERTION"?error.message.split("\n")[0]:error.code?"Database operation failed; diagnostics withheld":error.message}));
 process.exitCode=1;
}finally{await c.end();await rm(temporary,{recursive:true,force:true});}

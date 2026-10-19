import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash,createHmac} from "node:crypto";
import {readFile,readdir,mkdir,writeFile,rm} from "node:fs/promises";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {basename} from "node:path";
import {seal} from "../recovery/encrypted_backup.mjs";
const {Client}=createRequire(new URL("../../lib/db/package.json",import.meta.url))("pg");
export const REPORT=new URL("../../generated-artifacts/plan-entitlements-release/",import.meta.url);
export const hash=value=>createHash("sha256").update(typeof value==="string"||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest("hex");
export async function protectedOperator(){
 const r=await fetch("https://api.render.com/v1/env-groups/evg-db936g3bc2fs73cmm5dg",{headers:{Authorization:`Bearer ${process.env.RENDER_API_KEY}`},signal:AbortSignal.timeout(25000)});
 assert(r.ok,"Protected operator configuration unavailable");
 const group=await r.json(),env=Object.fromEntries(group.envVars.map(v=>[v.key,v.value]));
 assert(group.serviceLinks.some(x=>x.id==="srv-db5b47qjnfac739s374g"));
 assert.equal(env.QXLAYER_EXTERNAL_ENVIRONMENT,"production");
 assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF,"qcgvhlphalxqzzsxqjhi");
 assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED,"false");
 const url=new URL(process.env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL??env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL);
 assert.equal(url.toString(),new URL(env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL).toString());
 assert.equal(decodeURIComponent(url.username),"postgres.qcgvhlphalxqzzsxqjhi");
 assert.equal(url.hostname,env.DB_EXPECTED_HOST);assert.equal(url.pathname,"/postgres");url.search="";
 const ca=group.secretFiles.find(f=>f.name==="supabase-ca.crt")?.content;
 assert(ca?.includes("BEGIN CERTIFICATE"));
 return {env,url,ca,client:new Client({connectionString:url.toString(),ssl:{ca,rejectUnauthorized:true,servername:url.hostname},enableChannelBinding:true,connectionTimeoutMillis:20000,query_timeout:120000})};
}
export async function encryptedSnapshot(ctx){
 assert(process.env.QXLAYER_BACKUP_PASSPHRASE?.length>=24,"Existing backup custody required");
 await mkdir(REPORT,{recursive:true});
 const tool=(await readdir("/nix/store")).find(x=>x.endsWith("-postgresql-17.6"));
 assert(tool,"Reviewed PostgreSQL 17 backup tools required");
 const caFile=new URL("operator-ca.pem",REPORT);
 await writeFile(caFile,ctx.ca,{mode:0o600});
 const child=spawn(`/nix/store/${tool}/bin/pg_dump`,["-Fc","--no-password","--no-owner","--no-acl",
   "--schema=public","--schema=auth","--schema=vynox_supabase_auth","--schema=qxlayer_migrations","--schema=qxlayer_commerce","--schema=qxlayer_acceptance_catalog"],{
  env:{PATH:`/nix/store/${tool}/bin`,LANG:"C",LC_ALL:"C",PGHOST:ctx.url.hostname,PGPORT:"5432",PGDATABASE:"postgres",
   PGUSER:decodeURIComponent(ctx.url.username),PGPASSWORD:decodeURIComponent(ctx.url.password),PGSSLMODE:"verify-full",
   PGSSLROOTCERT:caFile.pathname,PGCHANNELBINDING:"prefer",PGCONNECT_TIMEOUT:"20"},stdio:["ignore","pipe","pipe"]});
 let diagnostic="";child.stderr.on("data",b=>{if(diagnostic.length<16000)diagnostic+=b.toString();});
 const finished=once(child,"exit");
 let file;
 try{
  file=await seal(child.stdout,`plan-entitlements-before-${Date.now()}.qxb`,process.env.QXLAYER_BACKUP_PASSPHRASE);
  const [code]=await finished;
  if(code!==0){await rm(file,{force:true});throw Error(`Encrypted snapshot failed (${ /permission denied/i.test(diagnostic)?"permission":/version mismatch/i.test(diagnostic)?"version":"provider"}); diagnostics withheld`);}
  const bytes=await readFile(file);assert(bytes.length>100);
  return {file:basename(file),sha256:hash(bytes),bytes:bytes.length,encrypted:true,plaintextWritten:false,durableExternalCopyVerified:false};
 }finally{await rm(caFile,{force:true});}
}
const quote=value=>`"${value.replaceAll('"','""')}"`;
export async function protectedState(c){
 const tables=(await c.query(`SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND (n.nspname IN('public','qxlayer_commerce','vynox_supabase_auth') OR n.nspname='auth' AND c.relname IN('users','identities','mfa_factors'))
 AND NOT(n.nspname='qxlayer_commerce' AND c.relname='pricing_publication') ORDER BY n.nspname,c.relname`)).rows;
 const result={};
 for(const t of tables){
  const predicate=t.schema==="public"&&t.name==="entitlement_definitions"?" WHERE key<>ALL($1::text[])":"";
  const rows=(await c.query(`SELECT to_jsonb(t)::text row FROM ${quote(t.schema)}.${quote(t.name)} t${predicate} ORDER BY to_jsonb(t)::text`,
   predicate?[["quickex","whitebit","quickex_customer_credentials","whitebit_customer_credentials"]]:[])).rows;
  result[`${t.schema}.${t.name}`]={count:rows.length,digest:createHmac("sha256",process.env.QXLAYER_BACKUP_PASSPHRASE).update(JSON.stringify(rows)).digest("hex")};
 }
 const policies=(await c.query(`SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
 (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'cmd',p.polcmd,'roles',p.polroles,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) policies
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','qxlayer_commerce','vynox_supabase_auth') AND c.relkind='r'
 AND c.relname<>'pricing_publication' ORDER BY n.nspname,c.relname`)).rows;
 return {records:result,security:hash(policies)};
}
export function restrictedClient(ctx){
 const url=new URL(ctx.env.DATABASE_URL);
 assert.equal(decodeURIComponent(url.username),"qxlayer_app.qcgvhlphalxqzzsxqjhi");
 assert.equal(url.hostname,ctx.url.hostname);assert.equal(url.pathname,"/postgres");url.search="";
 return new Client({connectionString:url.toString(),ssl:{ca:ctx.ca,rejectUnauthorized:true,servername:url.hostname},enableChannelBinding:true,connectionTimeoutMillis:20000});
}
export async function verifyPublication(c,{exercise=false}={}){
 if(exercise)await c.query("SET LOCAL ROLE qxlayer_runtime");
 const meta=(await c.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='qxlayer_commerce.pricing_publication'::regclass")).rows[0];
 assert(meta.relrowsecurity&&meta.relforcerowsecurity);
 const roles=(await c.query("SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN('qxlayer_app','qxlayer_runtime') ORDER BY rolname")).rows;
 assert.equal(roles.length,2);assert(roles.every(r=>!r.rolsuper&&!r.rolbypassrls));
 for(const role of ["anon","authenticated","service_role"])
  assert.equal((await c.query("SELECT has_table_privilege($1,'qxlayer_commerce.pricing_publication','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
 if(!exercise)return {forceRls:true,restrictedRoles:true,providerApiRolesRevoked:true,actualRuntimeWriteChecks:false};
 await c.query("SET LOCAL ROLE qxlayer_runtime; SELECT set_config('app.is_super_admin','false',true),set_config('app.can_write','true',true)");
 const published=(await c.query("SELECT payload,revision FROM qxlayer_commerce.pricing_publication WHERE singleton=true")).rows[0];assert(published);
 assert.equal((await c.query("UPDATE qxlayer_commerce.pricing_publication SET payload=payload RETURNING singleton")).rowCount,0);
 await c.query("SAVEPOINT denied_insert");
 let denied=false;
 try{await c.query("INSERT INTO qxlayer_commerce.pricing_publication(singleton,payload,revision) VALUES(true,$1,$2) ON CONFLICT DO NOTHING",[published.payload,published.revision]);}catch(e){assert.equal(e.code,"42501");denied=true;await c.query("ROLLBACK TO SAVEPOINT denied_insert");}
 assert(denied,"Non-admin snapshot INSERT must be denied");
 await c.query("RELEASE SAVEPOINT denied_insert; SELECT set_config('app.is_super_admin','true',true)");
 assert.equal((await c.query("UPDATE qxlayer_commerce.pricing_publication SET payload=payload RETURNING singleton")).rowCount,1);
 await c.query("RESET ROLE");
 return {forceRls:true,restrictedRoles:true,providerApiRolesRevoked:true,actualRuntimeWriteChecks:true,customerWritesDenied:true,superAdminWritesAllowed:true,publicPricingReadAllowed:true};
}

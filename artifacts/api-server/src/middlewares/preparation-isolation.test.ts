import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import type {RequestHandler} from "express";
import {createPreparationIsolation} from "./preparation-isolation";
const preparationIsolation = createPreparationIsolation(() => { throw new Error("Unexpected authentication"); });
const publicEnv={QXLAYER_PUBLIC_PREPARATION_APPROVED:"true",QXLAYER_EXTERNAL_ENVIRONMENT:"production",
 QXLAYER_EXTERNAL_CANDIDATE:"false",QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED:"false",
 QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED:"false",
 QXLAYER_PUBLIC_PRODUCTION_ORIGIN:"https://qxlayer-staging.vercel.app",
 QXLAYER_PLATFORM_URL:"https://qxlayer-staging.vercel.app",PRODUCTION_ACCESS_GATE_ENABLED:"false",
 QXLAYER_FINANCIAL_EXECUTION_ENABLED:"false",
 QXLAYER_PREPARATION_WRITE_TENANTS:"qa-tenant",QXLAYER_PREPARATION_WRITE_SLUGS:"qa-site",
 QXLAYER_PUBLIC_EXCLUDED_TENANTS:"solara-tenant",QXLAYER_PUBLIC_EXCLUDED_SLUGS:"solara-site"};
test("public preparation denies demo, real-customer mutations and execution without authorizing ordinary routes",async ()=>{
 const before={...process.env};Object.assign(process.env,publicEnv);
 try{
  const probe=async(method:string,path:string)=>{let code=0,next=false;
   await preparationIsolation({method,path} as any,{status:(n:number)=>{code=n;return{json:()=>{}}}} as any,()=>{next=true;});
   return{code,next};};
  assert.equal((await probe("GET","/api/public/product-catalog")).next,true);
  assert.equal((await probe("POST","/api/supabase-auth/action")).next,true);
  for(const path of ["/api/demo/session","/api/d%65mo/session","/api/public/sites/solara-site/exchange",
   "/api/public/sites/%73olara-site/exchange","/api/tenants/SOLARA-TENANT/settings"])
   assert.equal((await probe("GET",path)).code,404);
  assert.equal((await probe("POST","/api/tenants/real-tenant/exchange/orders")).code,403);
  assert.equal((await probe("POST","/api/platform/settings")).code,403);
  assert.equal((await probe("POST","/api/tenants/qa-tenant/exchange/orders")).next,true);
  assert.equal((await probe("POST","/api/tenants/qa-tenant/exchange/payout")).code,403);
  process.env.QXLAYER_PUBLIC_PREPARATION_APPROVED="false";
  process.env.QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION="true";
  assert.equal((await probe("POST","/api/tenants/real-tenant/settings")).code,403);
  assert.equal((await probe("POST","/api/tenants/qa-tenant/settings")).next,true);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
});

test("only the verified original Owner can read the approved excluded tenant",async ()=>{
 const before={...process.env};Object.assign(process.env,publicEnv);
 const policy={tenantId:"solara-tenant",ownerBusinessIdSha256:createHash("sha256").update("original-owner").digest("hex")};
 const owner={userId:"original-owner",authenticationProvider:"supabase",role:"super_admin",memberships:[]};
 try {
  const probe=async(method:string,path:string,principal:unknown=owner,authError?:unknown)=>{
   let code=0,next=false,authCalls=0,nextError:unknown;
   const headers:Record<string,string>={};
   const res={locals:{principal:null as unknown},setHeader:(k:string,v:string)=>{headers[k]=v;},vary:(v:string)=>{headers.Vary=v;},
    status:(n:number)=>{code=n;return{json:()=>{}}}};
   const auth:RequestHandler=async(_req,response,done)=>{
    authCalls++;if(authError)throw authError;
    response.locals.principal=principal;done();
   };
   await createPreparationIsolation(auth,policy)({method,path} as any,res as any,(error)=>{if(error)nextError=error;else next=true;});
   return {code,next,authCalls,headers,nextError};
  };
  for(const path of ["/api/tenants/solara-tenant","/api/tenants/solara-tenant/subscription",
   "/api/tenants/solara-tenant/exchange/dashboard","/api/tenants/%73olara-tenant/exchange/configuration"]) {
   const r=await probe("GET",path);
   assert.equal(r.next,true);assert.equal(r.authCalls,1);
   assert.equal(r.headers["Cache-Control"],"private, no-store");assert.equal(r.headers.Vary,"Cookie");
  }
  assert.equal((await probe("HEAD","/api/tenants/solara-tenant")).next,true);
  for(const p of [null,{...owner,userId:"another-super-admin"},{...owner,role:"client_admin"},
   {...owner,demo:true},{...owner,authenticationProvider:undefined},{...owner,userId:undefined}]) {
   const r=await probe("GET","/api/tenants/solara-tenant",p);
   assert.equal(r.code,404);assert.equal(r.next,false);
  }
  for(const status of [401,403,428])
   assert.equal((await probe("GET","/api/tenants/solara-tenant",null,{status})).code,404);
  const failure=new Error("Authentication unavailable");
  assert.equal((await probe("GET","/api/tenants/solara-tenant",null,failure)).nextError,failure);
  for(const path of ["/api/public/sites/solara-site","/api/public/sites/solara-site/exchange",
   "/api/demo/session","/api/tenants/other/solara-tenant","/api/tenants/solara-tenant-extra/solara-tenant"]) {
   const r=await probe("GET",path);assert.equal(r.code,404);assert.equal(r.authCalls,0);
  }
  for(const method of ["POST","PUT","PATCH","DELETE","OPTIONS"]) {
   const r=await probe(method,"/api/tenants/solara-tenant/exchange/configuration");
   assert.equal(r.code,404);assert.equal(r.authCalls,0);
  }
  const financial=await probe("POST","/api/tenants/solara-tenant/exchange/withdrawals");
  assert.equal(financial.code,403);assert.equal(financial.authCalls,0);
  process.env.QXLAYER_PUBLIC_PREPARATION_APPROVED="false";
  process.env.QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION="true";
  const acceptance=await probe("GET","/api/tenants/solara-tenant");
  assert.equal(acceptance.next,true);assert.equal(acceptance.authCalls,0);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
});

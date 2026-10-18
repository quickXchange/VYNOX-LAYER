import test from "node:test";
import assert from "node:assert/strict";
import {preparationIsolation} from "./preparation-isolation";
const publicEnv={QXLAYER_PUBLIC_PREPARATION_APPROVED:"true",QXLAYER_EXTERNAL_ENVIRONMENT:"production",
 QXLAYER_EXTERNAL_CANDIDATE:"false",QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED:"false",
 QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED:"false",
 QXLAYER_PUBLIC_PRODUCTION_ORIGIN:"https://qxlayer-staging.vercel.app",
 QXLAYER_PLATFORM_URL:"https://qxlayer-staging.vercel.app",PRODUCTION_ACCESS_GATE_ENABLED:"false",
 QXLAYER_FINANCIAL_EXECUTION_ENABLED:"false",
 QXLAYER_PREPARATION_WRITE_TENANTS:"qa-tenant",QXLAYER_PREPARATION_WRITE_SLUGS:"qa-site",
 QXLAYER_PUBLIC_EXCLUDED_TENANTS:"solara-tenant",QXLAYER_PUBLIC_EXCLUDED_SLUGS:"solara-site"};
test("public preparation denies demo, real-customer mutations and execution without authorizing ordinary routes",()=>{
 const before={...process.env};Object.assign(process.env,publicEnv);
 try{
  const probe=(method:string,path:string)=>{let code=0,next=false;
   preparationIsolation({method,path} as any,{status:(n:number)=>{code=n;return{json:()=>{}}}} as any,()=>{next=true;});
   return{code,next};};
  assert.equal(probe("GET","/api/public/product-catalog").next,true);
  assert.equal(probe("POST","/api/supabase-auth/action").next,true);
  for(const path of ["/api/demo/session","/api/public/sites/solara-site/exchange","/api/tenants/solara-tenant/settings"])
   assert.equal(probe("GET",path).code,404);
  assert.equal(probe("POST","/api/tenants/real-tenant/exchange/orders").code,403);
  assert.equal(probe("POST","/api/platform/settings").code,403);
  assert.equal(probe("POST","/api/tenants/qa-tenant/exchange/orders").next,true);
  assert.equal(probe("POST","/api/tenants/qa-tenant/exchange/payout").code,403);
  process.env.QXLAYER_PUBLIC_PREPARATION_APPROVED="false";
  process.env.QXLAYER_ACCEPTANCE_PREPARATION_ISOLATION="true";
  assert.equal(probe("POST","/api/tenants/real-tenant/settings").code,403);
  assert.equal(probe("POST","/api/tenants/qa-tenant/settings").next,true);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
});

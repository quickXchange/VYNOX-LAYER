import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {protectedOperator,REPORT} from "./plan-entitlements-operator.mjs";
const expected=process.env.GITHUB_SHA;
assert(/^[a-f0-9]{40}$/.test(expected??""));
const ctx=await protectedOperator(),root="https://qxlayer-api.onrender.com";
const health=await fetch(root+"/api/healthz").then(r=>r.json());
assert.equal(health.commit,expected);
assert(health.acceptanceOnly&&health.schemaVerified&&health.databaseConnected&&!health.financialExecutionEnabled);
const form=await fetch(root+"/",{headers:{accept:"text/html"},redirect:"manual"});
const html=await form.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];
assert(csrf);
const cookies=form.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
const enter=await fetch(root+"/api/__qx_access/enter",{method:"POST",redirect:"manual",
 headers:{origin:ctx.env.QXLAYER_PLATFORM_URL,"content-type":"application/x-www-form-urlencoded",cookie:cookies},
 body:new URLSearchParams({csrf,accessCode:ctx.env.PRODUCTION_ACCESS_CODE,returnTo:"/"})});
assert.equal(enter.status,303,"Native private gate entry must succeed");
const cookie=enter.headers.getSetCookie().find(v=>v.startsWith("__Host-qxlayer-access="))?.split(";")[0];
assert(cookie);
const response=await fetch(root+"/api/phase1/catalog",{headers:{cookie}});
assert.equal(response.status,200);
const offers=await response.json();
assert.equal(offers.plans.length,3);assert.equal(offers.purchaseAvailable,false);
assert.deepEqual(offers.methods,[]);assert.deepEqual(offers.addons,[]);
const tiers=[[39,390,149,3,2,2,1,100,10000],[99,990,399,10,10,5,5,1000,1000000],[249,2490,999,25,25,15,15,10000,10000000]];
for(const [i,p] of offers.plans.entries()){
 const [monthly,yearly,setup,assets,networks,methods,staff,orders,volume]=tiers[i];
 assert.equal(Number(p.monthlyPrice),monthly);assert.equal(Number(p.yearlyPrice),yearly);assert.equal(Number(p.setupFee),setup);
 assert.deepEqual(p.billingPeriods,["monthly","yearly"]);assert.equal(p.currency,"EUR");
 const expectedLimits={max_supported_assets:assets,max_supported_networks:networks,max_payment_methods:methods,max_staff:staff,
  max_monthly_transactions:orders,max_monthly_volume:volume,max_api_keys:0,max_webhooks:0};
 for(const entry of p.entitlements){
  if(typeof entry.value==="boolean")assert.equal(entry.value,["website","crypto_exchange","swap","convert"].includes(entry.key));
  else {assert(entry.key in expectedLimits);assert.equal(Number(entry.value),expectedLimits[entry.key]);}
 }
}
assert.equal((await fetch(root+"/api/phase1/catalog")).status,403);
const publicRoot="https://vynox-public-api.onrender.com";
const publicHealth=await fetch(publicRoot+"/api/healthz").then(r=>r.json());
assert.equal(publicHealth.commit,"e02a682ca6cbe9fa37d14c41522edd8ca4cfae33");
const publicOffers=await fetch(publicRoot+"/api/phase1/catalog").then(r=>r.json());
assert.equal(publicOffers.plans.length,0);
const report={acceptanceCommit:expected,privateGateVerified:true,privateCatalogServed:true,
 plans:offers.plans.map(p=>({name:p.name,monthly:p.monthlyPrice,yearly:p.yearlyPrice,setup:p.setupFee})),
 exactEntitlementsVerified:true,purchaseAvailable:false,publicCommitUnchanged:true,publicPlansUnchanged:true,checkedAt:new Date().toISOString()};
await writeFile(new URL("acceptance-catalog-runtime.json",REPORT),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));

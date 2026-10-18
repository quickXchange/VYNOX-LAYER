import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {publicPreparation} from "../../lib/production-access-gate/public-preparation.mjs";
const config=JSON.parse(await readFile("deploy/public-preparation.json","utf8"));
assert(publicPreparation(process.env));
assert(process.env.GITHUB_EVENT_NAME==="workflow_dispatch"&&process.env.GITHUB_REF==="refs/heads/main");
const vr=async(path,method="GET",body)=>{const r=await fetch(`https://api.vercel.com${path}${path.includes("?")?"&":"?"}teamId=${config.teamId}`,{method,headers:{Authorization:`Bearer ${process.env.VERCEL_TOKEN}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});assert(r.ok,`Public frontend verification ${r.status}`);return r.json();};
const rr=async path=>{const r=await fetch("https://api.render.com/v1/"+path,{headers:{Authorization:`Bearer ${process.env.RENDER_API_KEY}`},signal:AbortSignal.timeout(30000)});assert(r.ok,`Public API verification ${r.status}`);return r.json();};
const legacyDomains=await Promise.all(["quicklychan.xyz","www.quicklychan.xyz"].map(async domain=>{
 const record=await vr(`/v9/projects/${config.projectId}/domains/${domain}`);
 const response=await fetch(`https://api.vercel.com/v4/aliases/${domain}?teamId=${config.teamId}`,{headers:{Authorization:`Bearer ${process.env.VERCEL_TOKEN}`}});
 assert(response.ok||response.status===404);
 const alias=response.ok?await response.json():null;
 return {domain,redirect:record.redirect,redirectStatusCode:record.redirectStatusCode,
  deploymentId:alias?.deployment?.id??null};
}));
const acceptance=await vr("/v4/aliases/qxlayer-acceptance-vynox3.vercel.app");
const project=await vr("/v9/projects/"+config.projectId);
assert(project.autoAssignCustomDomains===false);
assert(["preview","all_except_custom_domains"].includes(project.ssoProtection?.deploymentType));
assert(acceptance.projectId===config.projectId);
const direct=Object.fromEntries((await rr(`services/${config.renderServiceId}/env-vars?limit=100`)).map(x=>{const v=x.envVar??x;return[v.key,v.value];}));
assert(publicPreparation(direct));
assert(new URL(direct.DATABASE_URL).username.startsWith("qxlayer_public_app"));
assert(new URL(direct.QXLAYER_PRODUCTION_AUTH_DATABASE_URL).username.startsWith("qxlayer_public_auth"));
assert(!direct.QXLAYER_PROVIDER_VAULT_KEY&&!direct.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL);
if(process.argv[2]==="before"){
 assert(direct.QXLAYER_PUBLIC_PRODUCTION_ORIGIN===config.primaryOrigin);
 await writeFile(".public-preparation-before.json",JSON.stringify({acceptance:acceptance.deployment.id,legacyDomains}));
}else{
 const before=JSON.parse(await readFile(".public-preparation-before.json","utf8"));
 assert.equal(acceptance.deployment.id,before.acceptance,"Protected acceptance must not be replaced");
 assert.deepEqual(legacyDomains,before.legacyDomains,"Legacy domains must remain unchanged");
 const url=new URL(process.env.PUBLIC_PREPARATION_DEPLOYMENT);
 assert(url.protocol==="https:"&&/^qxlayer-staging-[a-z0-9-]+\.vercel\.app$/.test(url.hostname));
 const deployment=await vr("/v13/deployments/"+url.hostname);
 assert(deployment.projectId===config.projectId&&deployment.readyState==="READY"&&deployment.target==="production");
 assert((deployment.meta?.githubCommitSha??deployment.meta?.gitCommitSha)===process.env.GITHUB_SHA);
 assert((deployment.alias??[]).every(a=>a.endsWith(".vercel.app")),"Official domain aliases are forbidden during preparation");
 const health=await fetch(config.apiOrigin+"/api/healthz");assert(health.ok);
 const h=await health.json();assert(h.publicPreparation&&h.databaseConnected&&h.privateAuthConnected&&!h.publicLiveActivated&&!h.financialExecutionEnabled&&h.commit===process.env.GITHUB_SHA);
 await vr("/v2/now/deployments/"+deployment.id+"/aliases","POST",{alias:new URL(config.temporaryOrigin).hostname});
 const assigned=await vr("/v4/aliases/"+new URL(config.temporaryOrigin).hostname);
 assert(assigned.deployment.id===deployment.id);
 assert(config.officialDomainCutoverApproved&&config.primaryOrigin==="https://vynoxlayer.com");
 for(const domain of ["vynoxlayer.com","www.vynoxlayer.com"]){
  const dns=await vr(`/v6/domains/${domain}/config`);
  assert(dns.misconfigured===false,"Official DNS must already be accepted; never edit it");
  await vr("/v2/deployments/"+deployment.id+"/aliases","POST",{alias:domain});
  const official=await vr("/v4/aliases/"+domain);
  assert(official.deployment.id===deployment.id,"Official alias must use the reviewed Production");
 }
 const www=await vr(`/v9/projects/${config.projectId}/domains/www.vynoxlayer.com`);
 assert(www.redirect==="vynoxlayer.com"&&www.redirectStatusCode===308);
 const https=await fetch(config.primaryOrigin);assert(https.ok);
 const redirect=await fetch("https://www.vynoxlayer.com/sign-in?domaincheck=1",{redirect:"manual"});
 assert(redirect.status===308&&redirect.headers.get("location")==="https://vynoxlayer.com/sign-in?domaincheck=1");
 const proxy=await fetch(config.primaryOrigin+"/api/healthz");assert(proxy.ok);
 assert((await proxy.json()).commit===process.env.GITHUB_SHA);
 console.log(JSON.stringify({productionPreparationReady:true,primaryOrigin:config.primaryOrigin,apiOrigin:config.apiOrigin,commit:process.env.GITHUB_SHA,httpsVerified:true,acceptancePreserved:true,legacyDomainsPreserved:true,officialDnsChanged:false,financialExecutionEnabled:false}));
}

import test from "node:test";
import assert from "node:assert/strict";
import {publicPreparation} from "./public-preparation.mjs";
const valid={QXLAYER_PUBLIC_PREPARATION_APPROVED:"true",QXLAYER_EXTERNAL_ENVIRONMENT:"production",
 QXLAYER_EXTERNAL_CANDIDATE:"false",QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED:"false",
 QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED:"false",
 QXLAYER_PUBLIC_PRODUCTION_ORIGIN:"https://qxlayer-staging.vercel.app",
 QXLAYER_PLATFORM_URL:"https://qxlayer-staging.vercel.app",PRODUCTION_ACCESS_GATE_ENABLED:"false",
 QXLAYER_FINANCIAL_EXECUTION_ENABLED:"false"};
test("official-domain approval pins only the official origin and keeps execution held",()=>{
 const official={...valid,QXLAYER_OFFICIAL_DOMAIN_CONNECTION_APPROVED:"true",
  QXLAYER_PUBLIC_PRODUCTION_ORIGIN:"https://www.quicklychan.xyz",QXLAYER_PLATFORM_URL:"https://www.quicklychan.xyz"};
 assert.equal(publicPreparation(official),true);
 assert.throws(()=>publicPreparation({...official,QXLAYER_PLATFORM_URL:"https://evil.invalid"}));
 assert.throws(()=>publicPreparation({...official,QXLAYER_FINANCIAL_EXECUTION_ENABLED:"true"}));
 assert.throws(()=>publicPreparation({...official,QXLAYER_OFFICIAL_DOMAIN_CONNECTION_APPROVED:"false"}));
});
test("public preparation is explicit, temporary-origin pinned and never DNS/financial activation",()=>{
 assert.equal(publicPreparation({}),false);assert.equal(publicPreparation(valid),true);
 for(const patch of [{QXLAYER_PLATFORM_URL:"https://www.quicklychan.xyz"},
 {QXLAYER_PUBLIC_PRODUCTION_ORIGIN:"https://evil.invalid"},
 {QXLAYER_EXTERNAL_CANDIDATE:"true"},{QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED:"true"},
 {QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED:"true"},
 {PRODUCTION_ACCESS_GATE_ENABLED:"true"},{QXLAYER_FINANCIAL_EXECUTION_ENABLED:"true"}])
  assert.throws(()=>publicPreparation({...valid,...patch}));
});

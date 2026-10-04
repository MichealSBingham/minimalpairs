// Operator-only: provision the new offer without touching existing customers,
// subscriptions, payments, balances or email settings. Never import in the app.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {STRIPE_API_VERSION} from '../providers/stripe.mjs';
import {SUPPORTED_EVENTS} from '../core.mjs';
import {privateJson,privateDirectory as verifyPrivateDirectory} from './runtime-sandbox-state.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const privateDir=path.join(root,'private');
const accountId='acct_1PFMIDJ2FK64SYOd';
const origin='https://minimalpairs.web.app';
const workerOrigin='https://minimalpairs-billing.sirmichealbingham.workers.dev';
const stateFile=path.join(privateDir,'production-setup.json');
function form(value,prefix='',out=new URLSearchParams()) {
 for(const [key,v] of Object.entries(value)) {const field=prefix?`${prefix}[${key}]`:key;
 if(v && typeof v==='object')form(v,field,out);else if(v!==undefined)out.append(field,String(v));}
 return out;
}
async function main(){
 assert.equal(process.argv[2],'--prepare');assert.equal(process.argv.length,3);
 verifyPrivateDirectory(privateDir);
 const credentials=privateJson(path.join(privateDir,'stripe-production.json'));
 assert.equal(credentials.accountId,accountId);assert.match(credentials.secretKey,/^rk_live_[A-Za-z0-9]+$/);
 const lock=fs.openSync(path.join(privateDir,'production-setup.lock'),'wx',0o600);
 try {
  const state=fs.existsSync(stateFile)?privateJson(stateFile):{accountId,runId:randomUUID(),operations:{}};
  assert.equal(state.accountId,accountId);
  const save=()=>{const temp=`${stateFile}.tmp`;fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(temp,stateFile);};
  async function request(method,endpoint,body={},idempotencyKey){
   assert.match(endpoint,/^\/v1\/[a-zA-Z0-9_/-]+$/);
   const url=new URL(endpoint,'https://api.stripe.com');if(method==='GET')url.search=form(body).toString();
   const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${credentials.secretKey}`,'Stripe-Version':STRIPE_API_VERSION,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(method==='POST'?{body:form(body)}:{})});
   const data=await response.json();if(!response.ok)throw new Error(`production_stripe_http_${response.status}`);return data;
  }
  const account=await request('GET','/v1/account');assert.equal(account.id,accountId);assert.equal(account.charges_enabled,true);
  async function create(name,endpoint,body){
   if(state.operations[name]?.result)return state.operations[name].result;
   state.operations[name]??={startedAt:Date.now(),key:`mp-production:${state.runId}:${name}`,body};
   const op=state.operations[name];assert.deepEqual(op.body,body);assert.ok(Date.now()-op.startedAt<23*3600000,'uncertain_operation_requires_manual_readback');save();
   op.result=await request('POST',endpoint,body,op.key);assert.equal(op.result.livemode,true);save();return op.result;
  }
  const product=await create('product','/v1/products',{name:'MinimalPairs Membership',description:'All available listening exercises and languages.',metadata:{minimalpairsOffer:'2026-10',billingSchema:'1'}});
  const prices={};
  for(const [plan,amount,interval] of [['monthly',700,'month'],['annual',4900,'year']]){
   const p=await create(`price_${plan}`,'/v1/prices',{product:product.id,unit_amount:amount,currency:'usd',recurring:{interval,interval_count:1},metadata:{minimalpairsOffer:'2026-10',plan}});
   const actual=await request('GET',`/v1/prices/${p.id}`);
   assert.equal(actual.livemode,true);assert.equal(actual.active,true);assert.equal(actual.unit_amount,amount);assert.equal(actual.currency,'usd');assert.equal(actual.recurring.interval,interval);assert.equal(actual.recurring.interval_count,1);
   prices[plan]={id:p.id,unitAmount:amount,currency:'usd',interval,intervalCount:1};
  }
  const portal=await create('portal','/v1/billing_portal/configurations',{business_profile:{headline:'Manage your MinimalPairs membership',privacy_policy_url:`${origin}/privacy`,terms_of_service_url:`${origin}/terms`},default_return_url:`${origin}/account`,features:{customer_update:{enabled:false},invoice_history:{enabled:true},payment_method_update:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end',proration_behavior:'none'},subscription_update:{enabled:false}},metadata:{minimalpairsOffer:'2026-10'}});
  const checkedPortal=await request('GET',`/v1/billing_portal/configurations/${portal.id}`);assert.equal(checkedPortal.active,true);assert.equal(checkedPortal.features.subscription_cancel.mode,'at_period_end');assert.equal(checkedPortal.features.subscription_update.enabled,false);
  const hook=await create('webhook','/v1/webhook_endpoints',{url:`${workerOrigin}/billing/webhook`,api_version:STRIPE_API_VERSION,enabled_events:[...SUPPORTED_EVENTS],connect:false,description:'MinimalPairs membership access updates',metadata:{minimalpairsOffer:'2026-10'}});
  assert.match(hook.secret,/^whsec_[A-Za-z0-9]+$/);
  const checkedHook=await request('GET',`/v1/webhook_endpoints/${hook.id}`);assert.equal(checkedHook.url,`${workerOrigin}/billing/webhook`);assert.equal(checkedHook.livemode,true);assert.deepEqual([...checkedHook.enabled_events].sort(),[...SUPPORTED_EVENTS].sort());
  state.config={appOrigin:origin,expectedLivemode:true,prices,portalConfigurationId:portal.id};state.workerOrigin=workerOrigin;save();
  console.log(JSON.stringify({prepared:true,accountId,prices,portalConfigurationId:portal.id,webhookId:hook.id,checkoutEnabled:false,existingCustomersChanged:false}));
 } finally{fs.closeSync(lock);fs.unlinkSync(path.join(privateDir,'production-setup.lock'));}
}
main().catch(e=>{console.error(JSON.stringify({error:/^production_stripe_http_\d+$/.test(e.message)?e.message:'production_setup_failed',note:'Inspect private checkpoint before retrying; no secrets logged.'}));process.exitCode=1;});

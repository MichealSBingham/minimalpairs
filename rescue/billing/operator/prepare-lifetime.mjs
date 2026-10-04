// Provision a price only. Never submits payment, changes a subscription, or sends email.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {privateJson,privateDirectory} from './runtime-sandbox-state.mjs';
import {STRIPE_API_VERSION} from '../providers/stripe.mjs';
import {SUPPORTED_EVENTS} from '../core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=path.join(root,'private');
async function main(){
 assert.deepEqual(process.argv.slice(2),['--prepare']);privateDirectory(dir);
 const credentials=privateJson(path.join(dir,'stripe-production.json'));
 const setup=privateJson(path.join(dir,'production-setup.json'));
 assert.equal(credentials.accountId,setup.accountId);
 const checkpoint=path.join(dir,'lifetime-setup.json'),lockfile=path.join(dir,'lifetime-setup.lock');
 const lock=fs.openSync(lockfile,'wx',0o600);
 try{
  const state=fs.existsSync(checkpoint)?privateJson(checkpoint):{accountId:setup.accountId,runId:randomUUID()};
  assert.equal(state.accountId,setup.accountId);
  const save=()=>{fs.writeFileSync(`${checkpoint}.tmp`,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(`${checkpoint}.tmp`,checkpoint);};
  async function request(method,endpoint,body,key){
   const r=await fetch(`https://api.stripe.com${endpoint}`,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${credentials.secretKey}`,'Stripe-Version':STRIPE_API_VERSION,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key}:{})},...(body?{body:new URLSearchParams(body)}:{})});
   if(!r.ok){await r.body?.cancel();throw new Error(`stripe_http_${r.status}`);}return r.json();
  }
  const account=await request('GET','/v1/account');assert.equal(account.id,setup.accountId);assert.equal(account.charges_enabled,true);
  const productId=setup.operations.product.result.id;assert.match(productId,/^prod_[A-Za-z0-9]+$/);
  const body={product:productId,unit_amount:'2900',currency:'usd','metadata[minimalpairsOffer]':'2026-10-lifetime','metadata[plan]':'lifetime'};
  if(!state.price){
   state.operation??={key:`mp-lifetime:${state.runId}`,createdAt:Date.now(),body};assert.deepEqual(state.operation.body,body);
   assert.ok(Date.now()-state.operation.createdAt<23*3600000,'uncertain_creation_requires_readback');save();
   state.price=await request('POST','/v1/prices',body,state.operation.key);save();
  }
  const price=await request('GET',`/v1/prices/${state.price.id}`);
  assert.equal(price.livemode,true);assert.equal(price.active,true);assert.equal(price.type,'one_time');assert.equal(price.recurring,null);assert.equal(price.currency,'usd');assert.equal(price.unit_amount,2900);assert.equal(price.product,productId);
  const monthly=await request('GET',`/v1/prices/${setup.config.prices.monthly.id}`);assert.equal(monthly.livemode,true);assert.equal(monthly.unit_amount,700);assert.equal(monthly.currency,'usd');assert.equal(monthly.recurring.interval,'month');assert.equal(monthly.active,true);
  const hook=await request('GET',`/v1/webhook_endpoints/${setup.operations.webhook.result.id}`);assert.equal(hook.livemode,true);assert.equal(hook.status,'enabled');assert.equal(hook.url,`${setup.workerOrigin}/billing/webhook`);for(const type of SUPPORTED_EVENTS)assert.ok(hook.enabled_events.includes(type),'webhook_event_missing');
  const file=path.join(root,'wrangler.production.jsonc');const worker=JSON.parse(fs.readFileSync(file,'utf8'));const config=JSON.parse(worker.vars.BILLING_CONFIG_JSON);
  assert.equal(config.expectedLivemode,true);config.prices.annual.sellable=false;config.prices.lifetime={id:price.id,unitAmount:2900,currency:'usd',interval:null,intervalCount:0};
  worker.vars.BILLING_CONFIG_JSON=JSON.stringify(config);fs.writeFileSync(file,JSON.stringify(worker,null,2)+'\n');
  setup.config=config;fs.writeFileSync(path.join(dir,'production-setup.json'),JSON.stringify(setup,null,2),{mode:0o600});
  state.verified=true;save();console.log(JSON.stringify({priceId:price.id,amount:2900,currency:'usd',mode:'payment',webhookVerified:true,annualNewSales:false,deployed:false,noPaymentsMade:true}));
 }finally{fs.closeSync(lock);fs.unlinkSync(lockfile);}
}
main().catch(e=>{console.error(/^stripe_http_\d+$/.test(e.message)?e.message:'Lifetime setup failed; inspect private checkpoint before retrying.');process.exitCode=1;});

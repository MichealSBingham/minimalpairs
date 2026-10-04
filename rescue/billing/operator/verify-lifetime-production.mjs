// Live integration smoke only. No payment submission and no email.
// Separate private state from the existing subscription smoke helper.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {privateJson,privateDirectory} from './runtime-sandbox-state.mjs';
import {STRIPE_API_VERSION} from '../providers/stripe.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=path.join(root,'private');
const require=createRequire(import.meta.url),mode=process.argv[2];
assert.ok(['--run','--cleanup'].includes(mode));assert.equal(process.argv.length,3);
async function main(){
 privateDirectory(dir);
 const file=path.join(dir,'lifetime-production-smoke.json'),lockfile=path.join(dir,'lifetime-production-smoke.lock');
 const lock=fs.openSync(lockfile,'wx',0o600);
 try{
  const state=fs.existsSync(file)?privateJson(file):{uid:`lifetime_${randomUUID().replaceAll('-','')}`,password:randomBytes(32).toString('base64url'),requestId:randomUUID()};
  state.email??=`${state.uid}@example.invalid`;
  const save=()=>{fs.writeFileSync(`${file}.tmp`,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(`${file}.tmp`,file);};
  if(mode==='--run'&&state.complete){console.log('PASS prior lifetime smoke verified and cleaned up; no payment made');return;}
  const setup=privateJson(path.join(dir,'production-setup.json')),credentials=privateJson(path.join(dir,'stripe-production.json'));
  assert.equal(credentials.accountId,setup.accountId);assert.equal(setup.config.prices.lifetime.unitAmount,2900);
  const auth=require(path.join(root,'../app/node_modules/firebase-tools/lib/auth.js'));
  const owner=auth.getProjectDefaultAccount(path.join(root,'../app'));
  const access=await auth.getAccessToken(owner.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
  const apiKey=fs.readFileSync(path.join(root,'../app/.env'),'utf8').match(/^PUBLIC_FIREBASE_API_KEY=(.+)$/m)[1].trim();
  async function identity(action,body,admin=true){
   const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}${admin?'':`?key=${encodeURIComponent(apiKey)}`}`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(admin?{Authorization:`Bearer ${access.access_token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
   if(!r.ok){await r.body?.cancel();throw new Error(`identity_http_${r.status}`);}return r.json();
  }
  const lookup=()=>identity('lookup',{targetProjectId:'minimalpairs',localId:[state.uid]});
  async function stripe(method,endpoint,body,key){
   assert.match(endpoint,/^\/v1\/[A-Za-z0-9_/-]+$/);
   const r=await fetch(`https://api.stripe.com${endpoint}`,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${credentials.secretKey}`,'Stripe-Version':STRIPE_API_VERSION,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:new URLSearchParams(body)}:{})});
   if(!r.ok){await r.body?.cancel();throw new Error(`stripe_http_${r.status}`);}return r.json();
  }
  const account=await stripe('GET','/v1/account');assert.equal(account.id,setup.accountId);
  async function checkedSession(){
   const session=await stripe('GET',`/v1/checkout/sessions/${state.sessionId}`);
   assert.equal(session.livemode,true);assert.equal(session.client_reference_id,state.uid);assert.equal(session.metadata.firebaseUid,state.uid);assert.equal(session.metadata.plan,'lifetime');assert.equal(session.mode,'payment');assert.equal(session.currency,'usd');assert.equal(session.amount_total,2900);
   return session;
  }
  async function cleanup(){
   if(state.sessionId&&!state.expired){
    const session=await checkedSession();assert.equal(session.payment_status,'unpaid');
    if(session.status==='open'){const expired=await stripe('POST',`/v1/checkout/sessions/${state.sessionId}/expire`,{},`expire-lifetime-smoke:${state.requestId}`);assert.equal(expired.status,'expired');}else assert.equal(session.status,'expired');
    state.expired=true;save();
   }
   if(state.identityStarted&&!state.disabled){const user=(await lookup()).users?.[0];if(user){assert.equal(user.email,state.email);await identity('update',{targetProjectId:'minimalpairs',localId:state.uid,disableUser:true});}state.disabled=true;delete state.idToken;delete state.password;save();}
  }
  if(mode==='--cleanup'){await cleanup();console.log('PASS lifetime synthetic account disabled and unpaid checkout expired');return;}
  assert.ok(!state.disabled,'previous_partial_run_requires_new_review');save();
  let succeeded=false;
  try{
   state.identityStarted=true;save();
   const prior=(await lookup()).users?.[0];
   if(!prior)await identity('signUp',{targetProjectId:'minimalpairs',localId:state.uid,email:state.email,password:state.password,emailVerified:true});else assert.equal(prior.email,state.email);
   const login=await identity('signInWithPassword',{email:state.email,password:state.password,returnSecureToken:true},false);assert.equal(login.localId,state.uid);state.idToken=login.idToken;save();
   async function worker(endpoint,body){const r=await fetch(`${setup.workerOrigin}/billing/${endpoint}`,{method:'POST',redirect:'error',headers:{Origin:setup.config.appOrigin,'Content-Type':'application/json',Authorization:`Bearer ${state.idToken}`},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});return {status:r.status,body:await r.json()};}
   const annual=await worker('checkout',{plan:'annual',requestId:randomUUID()});assert.equal(annual.status,409);assert.equal(annual.body.error,'plan_not_available');
   const first=await worker('checkout',{plan:'lifetime',requestId:state.requestId});assert.equal(first.status,200,`checkout_http_${first.status}`);assert.equal(new URL(first.body.url).origin,'https://checkout.stripe.com');
   state.checkoutUrl=first.body.url;state.sessionId=new URL(first.body.url).pathname.match(/cs_(?:test_|live_)?[A-Za-z0-9]+/)?.[0];assert.ok(state.sessionId);save();
   const repeat=await worker('checkout',{plan:'lifetime',requestId:state.requestId});assert.equal(repeat.status,200);assert.equal(repeat.body.url,first.body.url);
   const session=await checkedSession();assert.equal(session.status,'open');assert.equal(session.payment_status,'unpaid');assert.equal(session.subscription,null);
   const lines=await stripe('GET',`/v1/checkout/sessions/${state.sessionId}/line_items`);assert.equal(lines.data.length,1);assert.equal(lines.has_more,false);assert.equal(lines.data[0].price.id,setup.config.prices.lifetime.id);assert.equal(lines.data[0].quantity,1);assert.equal(lines.data[0].amount_total,2900);
   const status=await worker('checkout-status',{});assert.equal(status.status,200);assert.equal(status.body.state,'open');assert.equal(status.body.plan,'lifetime');
   state.verified=true;save();succeeded=true;
  }finally{await cleanup();}
  if(succeeded){state.complete=true;save();console.log('PASS live $29 one-time checkout, price, deduplication, annual rejection, and status; unpaid session expired and synthetic account disabled. No payment or email.');}
 }finally{fs.closeSync(lock);fs.unlinkSync(lockfile);}
}
main().catch(e=>{console.error(/^(?:identity|stripe|checkout)_http_\d+$/.test(e.message)?e.message:'Lifetime smoke incomplete; inspect private checkpoint and run --cleanup if needed. No payment submitted.');process.exitCode=1;});

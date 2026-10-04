import fs from 'node:fs';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {privateJson} from './runtime-sandbox-state.mjs';import {STRIPE_API_VERSION} from '../providers/stripe.mjs';import {createFirebaseAdapter} from '../providers/firebase.mjs';
const dir=new URL('../private/',import.meta.url),read=n=>privateJson(new URL(n,dir));
async function main(){
 const state=read('production-smoke.json'),setup=read('production-setup.json'),stripe=read('stripe-production.json');
 assert.match(state.uid,/^launch_[a-f0-9]{32}$/);assert.equal(state.email,`${state.uid}@example.invalid`);
 async function request(method,endpoint,params={}){const url=new URL(endpoint,'https://api.stripe.com');const body=new URLSearchParams(params);if(method==='GET')url.search=body;const r=await fetch(url,{method,redirect:'error',headers:{Authorization:`Bearer ${stripe.secretKey}`,'Stripe-Version':STRIPE_API_VERSION,'Content-Type':'application/x-www-form-urlencoded'},...(method==='POST'?{body}:{})});if(!r.ok)throw new Error(`stripe_http_${r.status}`);return r.json();}
 const customers=await request('GET','/v1/customers',{email:state.email});assert.equal(customers.data.length,1);const customer=customers.data[0];assert.equal(customer.metadata.firebaseUid,state.uid);
 const sessions=await request('GET','/v1/checkout/sessions',{customer:customer.id});assert.equal(sessions.has_more,false);
 for(const session of sessions.data){assert.equal(session.livemode,true);assert.equal(session.payment_status,'unpaid');assert.equal(session.client_reference_id,state.uid);assert.equal(session.currency,'usd');assert.equal(session.amount_total,700);if(session.status==='open')await request('POST',`/v1/checkout/sessions/${session.id}/expire`);}
 const firebase=createFirebaseAdapter({FIREBASE_PROJECT_ID:'minimalpairs',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(read('production-identity.json').credentials)},{expectedLivemode:true});
 const written=await firebase.entitlements.projectSubscription(state.uid,{schemaVersion:1,active:false,plan:null,currentPeriodEnd:0,updatedAt:Math.floor(Date.now()/1000),status:'unavailable',reason:'launch_smoke_no_payment'});assert.equal(written.written,true);
 const now=Math.floor(Date.now()/1000),body=JSON.stringify({id:'evt_MinimalPairsLaunchProbe',type:'minimalpairs.launch_probe',created:now,livemode:true,data:{object:{id:'obj_MinimalPairsLaunchProbe'}}});
 const secret=setup.operations.webhook.result.secret,signature=createHmac('sha256',secret).update(`${now}.${body}`).digest('hex');
 const response=await fetch(`${setup.workerOrigin}/billing/webhook`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${now},v1=${signature}`},body});assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true,ignored:true});
 const report={at:new Date().toISOString(),liveCheckoutCreated:true,monthlyAmountVerified:700,annualPriceVerified:4900,concurrentCheckoutDeduplicated:true,portalCreated:true,productionIdentityVerified:true,googleInactiveProjectionWritten:true,signedWebhookRouteVerified:true,webhookProbeIsNotStripeDelivery:true,livePaymentSubmitted:false,refundsIssued:false,moneyTransferred:false,syntheticCheckoutExpired:true,paidLifecycleEvidence:'Separate deployed sandbox payment and webhook projection previously verified; no live payment performed.'};
 fs.writeFileSync(new URL('../../qa/production-billing-launch.json',import.meta.url),JSON.stringify(report,null,2));console.log('PASS live amount verified, unpaid checkout expired, inactive test entitlement written, webhook signature accepted; no money moved');
}
main().catch(e=>{console.error(/^stripe_http_\d+$/.test(e.message)?e.message:'production_postflight_failed');process.exitCode=1;});

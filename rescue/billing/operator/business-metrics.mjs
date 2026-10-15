/** Owner-only, GET-only report. No customer identifiers or raw Stripe responses are output. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateJson} from './runtime-sandbox-state.mjs';
import {STRIPE_API_VERSION} from '../providers/stripe.mjs';
import {attributionFromMetadata} from '../analytics.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const id=x=>typeof x==='string'?x:x?.id;
const money=(target,currency,amount)=>{target[currency]=(target[currency]??0)+amount;};
const scoped=x=>x.livemode===true && x.metadata?.billingSchema==='1' && !!x.metadata?.firebaseUid;
export function summarize({sessions,subscriptions,charges,refunds,prices,start,end}) {
 const plans=Object.fromEntries(Object.entries(prices).map(([plan,p])=>[p.id,plan]));
 const paid={monthly:0,annual:0,lifetime:0,unclassified:0};
 const paidCheckoutByOffer={},paidCheckoutByLandingPage={},paidCheckoutBySource={},paidCheckoutGrossMinor={},subStates={},activePlans={monthly:0,annual:0};
 const recurringListPriceMonthlyMinor={},scheduledCancellationMonthlyMinor={};
 let scheduledCancellations=0,canceledInWindow=0,unscopedPaidCheckouts=0,excludedActiveItems=0;
 const bySubscription=new Map(subscriptions.map(s=>[s.id,s]));
 for(const s of sessions){
  if(s.payment_status!=='paid'||s.status!=='complete')continue;
  if(!scoped(s)){unscopedPaidCheckouts++;continue;}
  let plan=s.mode==='payment'&&s.metadata?.plan==='lifetime'?'lifetime':null;
  const sub=bySubscription.get(id(s.subscription));
  if(!plan && sub?.items?.data?.length===1)plan=plans[id(sub.items.data[0].price)];
  paid[plan??'unclassified']++;
  money(paidCheckoutGrossMinor,s.currency,s.amount_total??0);
  const offer=s.metadata?.recoveryOffer === 'lifetime50v1'?'lifetime50v1':'standard';
  const offerGroup=paidCheckoutByOffer[offer]??={purchases:0,grossMinor:{}};offerGroup.purchases++;money(offerGroup.grossMinor,s.currency,s.amount_total??0);
  const attribution=attributionFromMetadata(s.metadata);
  const source=attribution?.source??'unattributed';
  const group=paidCheckoutBySource[source]??={purchases:0,grossMinor:{}};
  group.purchases++;money(group.grossMinor,s.currency,s.amount_total??0);
  const pageGroup=paidCheckoutByLandingPage[attribution?.landing_page??'unattributed']??={purchases:0,grossMinor:{}};
  pageGroup.purchases++;money(pageGroup.grossMinor,s.currency,s.amount_total??0);
 }
 for(const s of subscriptions){
  if(!scoped(s))continue;
  subStates[s.status]=(subStates[s.status]??0)+1;
  if(s.status==='canceled' && s.canceled_at>=start && s.canceled_at<end)canceledInWindow++;
  if(s.status!=='active')continue;
  if(s.cancel_at_period_end || s.cancel_at)scheduledCancellations++;
  for(const item of s.items?.data??[]){
   const p=item.price,plan=plans[id(p)];
   if(!['monthly','annual'].includes(plan)||p.unit_amount==null||p.recurring?.usage_type==='metered'){excludedActiveItems++;continue;}
   activePlans[plan]++;
   const normalized=p.unit_amount*(item.quantity??1)/(p.recurring.interval_count*(p.recurring.interval==='year'?12:1));
   money(recurringListPriceMonthlyMinor,p.currency,normalized);
   if(s.cancel_at_period_end || s.cancel_at)money(scheduledCancellationMonthlyMinor,p.currency,normalized);
  }
 }
 const capturedGrossMinor={},refundedMinor={};let capturedCharges=0,successfulRefunds=0;
 for(const c of charges)if(c.livemode&&c.paid&&c.captured){capturedCharges++;money(capturedGrossMinor,c.currency,c.amount_captured??c.amount);}
 for(const r of refunds)if(r.status==='succeeded'){successfulRefunds++;money(refundedMinor,r.currency,r.amount);}
 return {
  window:{start:new Date(start*1000).toISOString(),endExclusive:new Date(end*1000).toISOString()},
  currentOffer:{paidCheckoutPurchases:paid,paidCheckoutByOffer,paidCheckoutBySource,paidCheckoutByLandingPage,paidCheckoutGrossMinor,subscriptionStates:subStates,activeSubscriptionItemsByPlan:activePlans,recurringListPriceMonthlyMinor,scheduledCancellations,scheduledCancellationMonthlyMinor,canceledInWindow,excludedActiveItems},
  accountWideCash:{capturedCharges,capturedGrossMinor,successfulRefunds,refundedMinor,unscopedPaidCheckouts},
  definitions:[
   'All money is in the smallest currency unit; currencies are never combined.',
   'Checkout purchases count completed paid sessions created within the window; renewals are not new checkout purchases. Session creation time may precede payment.',
   'Current-offer scope requires live mode, billingSchema=1 and Firebase ownership metadata. Older buyers without this metadata are excluded here.',
   'Recurring monthly value is current active subscription list price normalized to a month, before discounts, taxes, fees and refunds. It is not net MRR or cash received. Lifetime payments are excluded.',
   'Scheduled cancellation remains active until access expires. canceledInWindow uses the current canceled state and canceled_at timestamp, not a historical churn cohort.',
   'Account-wide cash includes all Stripe products, including legacy sales. Charges use creation time; refunds use refund creation time. Refunds may concern older charges. Cash is before processing fees, disputes and payouts.',
   'Landing-page purchases use the first eligible public page observed after consent in the same tab, expiring after 30 minutes idle. No earlier visits or missing historical data are reconstructed. Counts are purchases and gross revenue, not conversion rates; visitor denominators are not available in this report.',
   'Paid checkout source uses only consented coarse metadata saved when the checkout was reserved. Unknown or invalid metadata is unattributed, never inferred. Source is browser-reported, not proof of causation. No unique-customer conversion rate, trial conversion or retention is inferred.'
  ]
 };
}
export function checkoutOwnership(sessions,ownerEmail) {
 const normalize=value=>typeof value==='string'?value.trim().toLowerCase():'';
 const owner=normalize(ownerEmail);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner))throw new Error('invalid_owner_email');
 const counts={ownerEmailMatch:0,otherEmail:0,unknownEmail:0};
 const purchases=[];
 for(const s of sessions){
  if(!scoped(s)||s.status!=='complete'||s.payment_status!=='paid')continue;
  const email=normalize(s.customer_details?.email||s.customer_email);
  const category=!email?'unknownEmail':email===owner?'ownerEmailMatch':'otherEmail';
  counts[category]++;
  purchases.push({category,checkoutCreatedAt:new Date(s.created*1000).toISOString(),mode:s.mode,paymentStatus:s.payment_status,livemode:s.livemode,plan:s.metadata?.plan??'subscription'});
 }
 return {counts,purchases,note:'Email comparison uses only trim/lowercase, not alias merging. A different email does not prove a different person. Dates are checkout creation, not settlement. This classifies current-offer paid checkouts only; it does not exclude account-wide cash or subscriptions.'};
}
export async function fetchList(get,endpoint,params={},maxPages=20){
 const rows=[];let cursor;
 for(let page=0;page<maxPages;page++){
  const result=await get(endpoint,{...params,limit:100,...(cursor?{starting_after:cursor}:{})});
  if(!Array.isArray(result.data))throw new Error('invalid_list');
  rows.push(...result.data);
  if(!result.has_more)return rows;
  const next=result.data.at(-1)?.id;if(!next||next===cursor)throw new Error('invalid_pagination');cursor=next;
 }
 throw new Error('report_limit_exceeded_no_partial_report');
}
async function main(){
 const args=process.argv.slice(2);if(args.length>2||args.some(a=>a!=='--owner-check'&&!/^--days=\d+$/.test(a))||new Set(args).size!==args.length)throw new Error('usage_node_business_metrics_days_1_to_366');
 const days=Number(args.find(a=>a.startsWith('--days='))?.split('=')[1]??30);if(days<1||days>366)throw new Error('invalid_days');
 const credential=privateJson(path.join(root,'private/stripe-production.json'));
 if(credential.accountId!=='acct_1PFMIDJ2FK64SYOd'||!/^rk_live_/.test(credential.secretKey))throw new Error('invalid_production_credential');
 const config=JSON.parse(JSON.parse(fs.readFileSync(path.join(root,'wrangler.production.jsonc'),'utf8')).vars.BILLING_CONFIG_JSON);
 const get=async(endpoint,params={})=>{
  if(!['/v1/account','/v1/checkout/sessions','/v1/subscriptions','/v1/charges','/v1/refunds'].includes(endpoint))throw new Error('endpoint_not_allowed');
  const url=new URL(endpoint,'https://api.stripe.com');url.search=new URLSearchParams(params);
  const res=await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${credential.secretKey}`,'Stripe-Version':STRIPE_API_VERSION}});
  if(!res.ok)throw new Error(`stripe_read_http_${res.status}`);return res.json();
 };
 const account=await get('/v1/account');if(account.id!==credential.accountId)throw new Error('wrong_account');
 const end=Math.floor(Date.now()/1000),start=end-days*86400,window={'created[gte]':start,'created[lt]':end};
 const sessions=await fetchList(get,'/v1/checkout/sessions',window);
 const subscriptions=await fetchList(get,'/v1/subscriptions',{status:'all'});
 if(subscriptions.some(s=>s.items?.has_more))throw new Error('subscription_items_truncated');
 const charges=await fetchList(get,'/v1/charges',window);
 const refunds=await fetchList(get,'/v1/refunds',window);
 const ownership=args.includes('--owner-check')?checkoutOwnership(sessions,process.env.MINIMALPAIRS_OWNER_EMAIL??privateJson(path.join(root,'private/business-metrics-owner.json')).email):undefined;
 console.log(JSON.stringify({generatedAt:new Date().toISOString(),...summarize({sessions,subscriptions,charges,refunds,prices:config.prices,start,end}),...(ownership?{checkoutOwnership:ownership}:{})},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({error:/^(stripe_read_http_\d+|invalid_|report_limit_|wrong_account|subscription_items_|usage_)/.test(e.message)?e.message:'business_report_failed_no_private_details_logged'}));process.exitCode=1;});

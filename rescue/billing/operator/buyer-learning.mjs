/** GET-only buyer case refresh. Private receipts, no customer identifiers in stdout. */
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';
import {fetchList} from './business-metrics.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export function usableRecoveryReservation(session,reservation){return !!session.metadata?.support_offer && reservation?.found===true && Number.isSafeInteger(reservation.createdAt) && reservation.createdAt<=session.created && session.created-reservation.createdAt<=86400 && reservation.metadata?.firebaseUid===session.metadata?.firebaseUid;}
async function main(){
 const key=JSON.parse(fs.readFileSync(path.join(root,'rescue/billing/private/stripe-production.json'))).secretKey;
 const feed=fs.readFileSync(path.join(root,'rescue/billing/private/purchase-feed-token'),'utf8').trim();
 const admin=fs.readFileSync(path.join(root,'rescue/audio-reports/private/admin-token'),'utf8').trim();
 const read=async(url,token)=>{const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('read_http_'+r.status);return r.json();};
 const sessions=await fetchList((p,params)=>read('https://api.stripe.com'+p+'?'+new URLSearchParams(params),key),'/v1/checkout/sessions',{'created[gte]':Math.floor(Date.now()/1000)-90*86400});
 const rows=[];
 for(const s of sessions.filter(s=>s.livemode&&s.status==='complete'&&s.payment_status==='paid'&&s.metadata?.billingSchema==='1'&&!s.metadata?.operatorTest)){
  let m=s.metadata,origin='paid_checkout',lookupError;
  if(!m.mp_journey&&m.support_offer){try{const r=await read('https://minimalpairs-billing.sirmichealbingham.workers.dev/internal/checkout-attribution?uid='+encodeURIComponent(m.firebaseUid),feed);if(usableRecoveryReservation(s,r)){m=r.metadata;origin='same_account_original_reservation';}}catch(e){lookupError=e.message;}}
  let j;if(m.mp_journey){try{j=(await read('https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/admin/analytics?journey='+encodeURIComponent(m.mp_journey),admin)).journey;}catch(e){lookupError=e.message;}}
  const row={checkoutId:s.id,checkoutCreatedAt:new Date(s.created*1000).toISOString(),amount:s.amount_total,currency:s.currency,plan:s.metadata.plan,country:s.customer_details?.address?.country||null,recovery:!!s.metadata.support_offer,attributionEvidence:origin,source:j?.source||m.mp_source||'unattributed',referrerHost:j?.referrerHost||null,referrerKind:j?.referrerKind||null,landing:j?.landing||m.mp_landing_page||null,language:m.mp_language||j?.language||null,contrast:m.mp_contrast||j?.contrast||null,diagnosticLength:m.mp_diagnostic_length||j?.diagnosticLength||null,observedJourneyAnswers:j?Object.values(j.attempts||{}).reduce((n,a)=>n+(a.answers||0),0):null,answersBeforeCheckout:j?.eventHistory?.filter(e=>e.event==='practice_answer'&&e.occurredAt<s.created*1000).length??null,journeyAvailable:!!j,...(lookupError?{lookupError}:{})};rows.push(row);
 }
 const result={checkedAt:new Date().toISOString(),rows,limits:['Original referral is unknown if not recorded. Referrer host is prospective from October31. No inferred cross-device identities.','A recovery reservation is inspected only for a support offer, matching account, and preceding checkout by at most 24 hours.','Journey answers can include activity after checkout. answersBeforeCheckout uses retained timestamps only. Missing journeys are null, not zero.']};
 fs.writeFileSync(path.join(root,'rescue/company/private/buyer-learning-latest.json'),JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify({checkedAt:result.checkedAt,buyers:rows.length,cases:rows.map(({checkoutId,...x})=>x)},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('Buyer learning refresh failed: '+e.message);process.exitCode=1;});

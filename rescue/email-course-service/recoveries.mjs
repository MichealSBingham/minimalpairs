import template from '../company/checkout-recovery/email.json' with {type:'json'};
import {brandedHtml} from './delivery.mjs';
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
export const recoveryTemplateHash=()=>digest(template.subject+'\n'+template.text);
async function feed(env,path){const r=await env.BILLING_PURCHASES.fetch('https://internal/internal/'+path,{headers:{Authorization:'Bearer '+env.PURCHASE_FEED_TOKEN}});if(!r.ok)throw Error('Recovery feed unavailable');return r.json();}
async function suppressed(storage,hash){for(const prefix of ['subscriber:','buyer:','recovery:'])if((await storage.get(prefix+hash))?.status==='suppressed')return true;return false;}
export async function collectRecoveries(storage,env,{now=Date.now()}={}){
 if(env.RECOVERY_COLLECTOR_ENABLED!=='true'||!env.BILLING_PURCHASES||!env.PURCHASE_FEED_TOKEN)return {state:'disabled'};
 try{
  const result=await feed(env,'recovery-offers');if(!Array.isArray(result.data))throw Error('Invalid recovery feed');
  for(const item of result.data){
   if(typeof item.email!=='string'||!item.email.includes('@')||typeof item.uid!=='string'||!Number.isSafeInteger(item.expiresAt)||item.expiresAt*1000<=now+3600000)continue;
   const email=item.email.trim().toLowerCase(),hash=await digest(email),key='recovery:'+hash;
   await storage.transaction(async tx=>{if(await tx.get(key))return;const token=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-','');
    await tx.put(key,{...item,email,state:'queued',status:await suppressed(tx,hash)?'suppressed':'checkout',unsubscribeToken:token,audit:[],createdAt:now});
    await tx.put('token:'+await digest(token),key);
   });
  }
  await storage.put('recoveryCollectorStatus',{state:'current',checkedAt:now});return {state:'current'};
 }catch{await storage.put('recoveryCollectorStatus',{state:'error',checkedAt:now});return {state:'error'};}
}
export function recoveryText(row,env){return template.text.replace('{{expires_at}}',new Date(row.expiresAt*1000).toUTCString()).replace('{{offer_url}}','https://minimalpairs.co/pricing?billing=cancel').replace('{{unsubscribe_url}}',env.PUBLIC_ORIGIN+'/unsubscribe/confirm#'+row.unsubscribeToken);}
export async function deliverRecovery(storage,env,{now=Date.now(),fetcher=fetch}={}){
 if(env.RECOVERY_SENDING_ENABLED!=='true'||env.SENDING_ENABLED!=='true'||env.RECOVERY_TEMPLATE_SHA256!==await recoveryTemplateHash()||!env.RESEND_API_KEY||!env.FROM_ADDRESS||!env.PUBLIC_ORIGIN||!env.BILLING_PURCHASES||!env.PURCHASE_FEED_TOKEN)return {state:'disabled'};
 for(const [key,row] of await storage.list({prefix:'recovery:',limit:5000})){
  if(row.state!=='queued')continue;const hash=key.slice(9);
  if(row.expiresAt*1000<=now+3600000 || await suppressed(storage,hash)) {row.state='suppressed';await storage.put(key,row);continue;}
  let eligible;try{eligible=(await feed(env,'recovery-eligible?uid='+encodeURIComponent(row.uid))).eligible===true;}catch{return {state:'eligibility-unavailable'};}
  if(!eligible){row.state='ineligible';await storage.put(key,row);continue;}
  const reserved=await storage.transaction(async tx=>{
   const current=await tx.get(key);if(current?.state!=='queued'||await suppressed(tx,hash))return false;
   const day=new Date(now).toISOString().slice(0,10);let quota=await tx.get('sendQuota');if(quota?.day!==day)quota={day,count:0};
   if(quota.count>=Math.min(50,Number(env.DAILY_SEND_CAP)||0))return false;
   current.state='sending';current.attemptedAt=now;await tx.put(key,current);quota.count++;await tx.put('sendQuota',quota);return true;
  });if(!reserved)return {state:'idle'};
  let state='uncertain',providerId;
  if(await suppressed(storage,hash))state='suppressed';
  else try{
   const text=recoveryText(row,env),html=brandedHtml(text).replace('$14.50','<strong style="font-size:24px">$14.50</strong>').replace('$29','<del>$29</del>').replace('almost bought','<em>almost</em> bought');
   const r=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'minimalpairs-recovery:'+hash},body:JSON.stringify({from:env.FROM_ADDRESS,reply_to:'micheal@minimalpairs.co',to:[row.email],subject:template.subject,text,html})});
   if(r.ok){const result=await r.json();if(typeof result.id==='string'&&result.id.length<200){state='accepted';providerId=result.id;}}else if(r.status<500)state='failed';
  }catch{}
  await storage.transaction(async tx=>{const current=await tx.get(key);current.state=state;if(providerId){current.providerId=providerId;current.acceptedAt=now;await tx.put('provider:'+providerId,key);}await tx.put(key,current);});
  return {state};
 }
 return {state:'idle'};
}

import {brandedHtml} from './delivery.mjs';
const hash=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))),v=>v.toString(16).padStart(2,'0')).join('');
export const founderText=plan=>`Hi,\n\nThanks for getting ${plan==='lifetime'?'lifetime access to':plan==='monthly'?'a monthly membership for':'a membership for'} MinimalPairs. I’m Micheal, the founder.\n\nI’d love to know: how did you find us, and what made you decide to buy? If you’ve tried a lesson, what’s one thing that would make it more useful for you?\n\nA short reply is plenty. If anything isn’t working, you can reply here for help too. I'm actively working on new features and upgrades so stay tuned and let me know if you have any requests\n\nThanks,\nMicheal`;
export async function seedBuyer(storage,{email,providerId}){
 if(typeof email!=='string'||!email.includes('@')||typeof providerId!=='string'||!providerId.trim())throw Error('Receipt required');
 const key='buyer:'+await hash(email.trim().toLowerCase());
 return storage.transaction(async tx=>{if(await tx.get(key))return false;await tx.put(key,{email:email.trim().toLowerCase(),state:'accepted',status:'buyer',audit:[],providerId,seeded:true});await tx.put('provider:'+providerId,key);return true;});
}
export async function collectBuyers(storage,env,{now=Date.now()}={}){
 if(env.BUYER_COLLECTOR_ENABLED!=='true'||!env.BILLING_PURCHASES||!env.PURCHASE_FEED_TOKEN)return {state:'disabled'};
 // Persistent bounded sweep: overlap catches delayed events, event delivery itself is idempotent.
 let scan=await storage.get('buyerScan');
 if(!scan?.cursor)scan={from:Math.max(Number(env.BUYER_START_EPOCH)||0,(scan?.through||0)-86400),through:Math.floor(now/1000)};
 try{
  for(let page=0;page<3;page++){
   const url=new URL('https://internal/internal/buyer-events');url.searchParams.set('created_gte',String(scan.from));url.searchParams.set('created_lte',String(scan.through));
   if(scan.cursor)url.searchParams.set('starting_after',scan.cursor);
   const r=await env.BILLING_PURCHASES.fetch(url.toString(),{method:'GET',headers:{Authorization:`Bearer ${env.PURCHASE_FEED_TOKEN}`}});if(!r.ok)throw Error('Buyer feed '+r.status);const data=await r.json();if(!Array.isArray(data.data))throw Error('Buyer feed response');
   for(const event of data.data)await recordBuyer(storage,env,event.data?.object,{now});
   scan.cursor=data.has_more?data.data.at(-1)?.id:null;if(data.has_more&&!scan.cursor)throw Error('Missing cursor');
   await storage.put('buyerScan',scan);if(!scan.cursor)break;
  }
  await storage.put('buyerCollectorStatus',{state:scan.cursor?'catching-up':'current',checkedAt:now,through:scan.through});
 }catch(e){await storage.put('buyerCollectorStatus',{state:'error',checkedAt:now,reason:String(e.message).slice(0,80)});}
 // Reporting is independent of mail eligibility and retries safely using purchase ID.
 let reportAttempts=0;
 if(env.REPORTING&&env.REPORTING_TOKEN)for(const [key,p] of await storage.list({prefix:'buyerPurchase:',limit:5000})){
  if(p.reported)continue;if(reportAttempts++>=50)break;
  try{const r=await env.REPORTING.fetch('https://internal/internal/purchase',{method:'POST',headers:{Authorization:`Bearer ${env.REPORTING_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(p.payload)});if(r.ok){p.reported=true;p.reportedAt=now;await storage.put(key,p);}}catch{}
 }
 return await storage.get('buyerCollectorStatus');
}
export async function recordBuyer(storage,env,s,{now=Date.now()}={}){
 if(!s||s.livemode!==true||s.status!=='complete'||s.payment_status!=='paid'||!(s.amount_total>0)||s.metadata?.billingSchema!=='1'||!s.metadata.firebaseUid)return false;
 const plan=s.metadata.plan||(s.mode==='subscription'?'membership':null);if(!['monthly','lifetime','membership'].includes(plan))return false;
 const metadata={};for(const k of ['mp_ui_locale','mp_journey','mp_source','mp_medium','mp_campaign','mp_landing_page','mp_language','mp_contrast','mp_session_kind','mp_surface'])if(typeof s.metadata[k]==='string')metadata[k]=s.metadata[k].slice(0,500);
 if(!await storage.get('buyerPurchase:'+s.id))await storage.put('buyerPurchase:'+s.id,{reported:false,payload:{purchaseId:s.id,created:s.created,...(Number.isInteger(s.paid_event_at)?{paidAt:s.paid_event_at}:{}),amount:s.amount_total,currency:s.currency,plan,metadata}});
 const email=(s.customer_details?.email||s.customer_email||'').trim().toLowerCase();if(!email.includes('@'))return true;
 const digest=await hash(email),key='buyer:'+digest;
 await storage.transaction(async tx=>{
  if(await tx.get(key))return;
  const existing=await tx.get('subscriber:'+digest);const recovery=await tx.get('recovery:'+digest);const token=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-','');
  // Separate identity: a buyer is not silently subscribed to the course or newsletter.
  await tx.put(key,{email,plan,purchaseId:s.id,state:'queued',createdAt:now,status:existing?.status==='suppressed'||recovery?.status==='suppressed'?'suppressed':'buyer',unsubscribeToken:token,audit:[]});
  await tx.put('token:'+await hash(token),key);
 });return true;
}
export async function deliverBuyer(storage,env,{now=Date.now(),fetcher=fetch}={}){
 if(env.BUYER_SENDING_ENABLED!=='true'||env.SENDING_ENABLED!=='true'||!env.RESEND_API_KEY||!env.POSTAL_ADDRESS||!env.PUBLIC_ORIGIN)return {state:'disabled'};
 const reservation=await storage.transaction(async tx=>{
  const day=new Date(now).toISOString().slice(0,10);let q=await tx.get('sendQuota');if(q?.day!==day)q={day,count:0};if(q.count>=Math.min(50,Number(env.DAILY_SEND_CAP)||0))return null;
  for(const [key,row] of await tx.list({prefix:'buyer:',limit:5000})){
   if(row.state!=='queued')continue;
   if(row.status==='suppressed'||(await tx.get(key.replace('buyer:','subscriber:')))?.status==='suppressed'){row.state='suppressed';await tx.put(key,row);continue;}
   row.state='sending';row.attemptedAt=now;await tx.put(key,row);q.count++;await tx.put('sendQuota',q);return {key,row};
  }return null;
 });if(!reservation)return {state:'idle'};
 const {key,row}=reservation;let state='uncertain',providerId;
 if((await storage.get(key))?.status==='suppressed')state='suppressed';
 else try{
  const text=founderText(row.plan)+`\n\nMinimalPairs · ${env.POSTAL_ADDRESS}\nStop these emails: ${env.PUBLIC_ORIGIN}/unsubscribe/confirm#${row.unsubscribeToken}`;
  const r=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'minimalpairs-founder:'+key.slice(6)},body:JSON.stringify({from:env.FROM_ADDRESS,reply_to:'micheal@minimalpairs.co',to:[row.email],subject:'Hey thanks for buying MinimalPairs!',text,html:brandedHtml(text)})});
  if(r.ok){const result=await r.json();if(typeof result.id==='string'&&result.id.length<200){state='accepted';providerId=result.id;}}else if(r.status<500)state='failed';
 }catch{}
 await storage.transaction(async tx=>{const current=await tx.get(key);current.state=state;if(providerId){current.providerId=providerId;current.acceptedAt=now;await tx.put('provider:'+providerId,key);}await tx.put(key,current);});
 // Sending/uncertain jobs never automatically retry after a timeout or provider expiry.
 return {state};
}
export async function buyerStatus(storage){const states={};for(const row of (await storage.list({prefix:'buyer:',limit:5000})).values())states[row.state]=(states[row.state]||0)+1;const purchases=[...(await storage.list({prefix:'buyerPurchase:',limit:5000})).values()];return {states,collector:await storage.get('buyerCollectorStatus')||null,purchases:purchases.length,reportingPending:purchases.filter(x=>!x.reported).length};}

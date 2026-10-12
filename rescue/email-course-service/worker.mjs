import {courseAttribution} from '../app/src/lib/course-attribution.mjs';
import {collectBuyers,deliverBuyer,buyerStatus,seedBuyer} from './buyers.mjs';
import {enqueue,deliverOne,suppressProviderEvent,verifyProviderWebhook} from './delivery.mjs';
import {scheduleWeekly} from './weekly.mjs';
// Consent and delivery infrastructure. Intake and sending are OFF until approved activation.
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const ORIGINS=new Set(['https://minimalpairs.co','https://www.minimalpairs.co','https://minimalpairs.web.app']);
export const CONSENT_VERSION='listening-course-2026-10-09-v3';
const LANGUAGES=new Set(['en-US-ga','fr','es','de','it','pt','ru','zh','ja']);
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
export function validateSubscription(x){
 if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['email','language','course','weekly','consentVersion','attribution'].includes(k)))return null;
 if(typeof x.email!=='string'||x.email.length>254||! /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(x.email.trim()))return null;
 if(!LANGUAGES.has(x.language)||typeof x.course!=='boolean'||typeof x.weekly!=='boolean'||! (x.course||x.weekly)||x.consentVersion!==CONSENT_VERSION)return null;
 const {attribution,...rest}=x;
 return {...rest,email:x.email.trim().toLowerCase(),...(courseAttribution(attribution)?{attribution:courseAttribution(attribution)}:{})};
}
async function readBody(request,raw=false){
 const reader=request.body?.getReader();if(!reader)throw Error('body');let count=0;const parts=[];
 while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>2048){await reader.cancel();throw Error('body');}parts.push(value);}
 const out=new Uint8Array(count);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}const text=new TextDecoder().decode(out);return raw?text:JSON.parse(text);
}
export class EmailAudience{
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async cleanup(now=Date.now()){
  return this.ctx.storage.transaction(async tx=>{
   let removed=0;
   for(const [key,row] of await tx.list({prefix:'subscriber:',limit:5000})){
    if(row.status!=='pending-verification'||Date.parse(row.createdAt)>now-7*86400000)continue;
    await tx.delete('token:'+await digest(row.unsubscribeToken));
    if(row.verificationToken)await tx.delete('verify:'+await digest(row.verificationToken));
    // Minimized audit retains event times/choices, never the unverified email or tokens.
    await tx.put('expired:'+key.slice(11),{expiredAt:new Date(now).toISOString(),audit:row.audit});
    await tx.delete(key);removed++;
   }
   await tx.put('total',Math.max(0,(await tx.get('total')||0)-removed));
   // Bound audit retention as well as live audience storage.
   for(const [key,row] of await tx.list({prefix:'expired:',limit:5000}))if(Date.parse(row.expiredAt)<now-30*86400000)await tx.delete(key);
   const expired=await tx.list({prefix:'expired:',limit:10000});if(expired.size>5000)for(const key of [...expired.keys()].slice(0,expired.size-5000))await tx.delete(key);
   return removed;
  });
 }
 async alarm(){await this.cleanup();await scheduleWeekly(this.ctx.storage,this.env);await deliverOne(this.ctx.storage,this.env);await this.ctx.storage.setAlarm(Date.now()+3600000);}

 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/admin/buyers/tick'||path==='/admin/buyers/seed'){
   if(!this.env.ADMIN_TOKEN||request.headers.get('Authorization')!==`Bearer ${this.env.ADMIN_TOKEN}`)return response({error:'Unauthorized'},401);
   if(request.method!=='POST')return response({error:'Method not allowed'},405);
   if(path.endsWith('/seed')){try{return response({seeded:await seedBuyer(this.ctx.storage,await readBody(request))});}catch{return response({error:'Invalid receipt'},400);}}
   await collectBuyers(this.ctx.storage,this.env);await deliverBuyer(this.ctx.storage,this.env);return response(await buyerStatus(this.ctx.storage));
  }
  if(path==='/admin/status'){
   if(!this.env.ADMIN_TOKEN||request.headers.get('Authorization')!==`Bearer ${this.env.ADMIN_TOKEN}`)return response({error:'Unauthorized'},401);
   if(request.method!=='GET')return response({error:'Method not allowed'},405);
   const states={};for(const job of (await this.ctx.storage.list({prefix:'outbox:',limit:5000})).values())states[job.state]=(states[job.state]||0)+1;
   return response({sendingEnabled:this.env.SENDING_ENABLED==='true',intakeEnabled:this.env.INTAKE_ENABLED==='true',outbox:states,buyers:await buyerStatus(this.ctx.storage),weekly:await this.ctx.storage.get('weeklySchedule')||null});
  }
  if(path==='/webhooks/resend'){
   if(request.method!=='POST')return response({error:'Method not allowed'},405);
   let raw;try{raw=await readBody(request,true);}catch{return response({error:'Invalid request'},400);}
   if(!await verifyProviderWebhook(raw,request.headers,this.env.RESEND_WEBHOOK_SECRET))return response({error:'Unauthorized'},401);
   try{const data=JSON.parse(raw),type={'email.bounced':'bounce','email.complained':'complaint'}[data.type];if(type)await suppressProviderEvent(this.ctx.storage,{type,providerId:data.data?.email_id});return response({received:true});}catch{return response({error:'Invalid event'},400);}
  }
  if(['/admin/queue' ,'/admin/deliver','/admin/provider-event'].includes(path)){
   const secret=path==='/admin/provider-event'?this.env.PROVIDER_EVENT_TOKEN:this.env.ADMIN_TOKEN;
   if(!secret||request.headers.get('Authorization')!==`Bearer ${secret}`)return response({error:'Unauthorized'},401);
   if(request.method!=='POST')return response({error:'Method not allowed'},405);
   try{
    if(path==='/admin/deliver')return response(await deliverOne(this.ctx.storage,this.env));
    const data=await readBody(request);
    if(path==='/admin/provider-event')return response({suppressed:await suppressProviderEvent(this.ctx.storage,data)});
    const queued=await this.ctx.storage.transaction(tx=>enqueue(tx,data));await this.ctx.storage.setAlarm(Date.now()+60000);return response({queued});
   }catch{return response({error:'Invalid request'},400);}
  }
  if(path==='/admin/preferences'){
   if(!this.env.ADMIN_TOKEN||request.headers.get('Authorization')!==`Bearer ${this.env.ADMIN_TOKEN}`)return response({error:'Unauthorized'},401);
   if(request.method!=='POST')return response({error:'Method not allowed'},405);
   let input;try{input=await readBody(request);}catch{return response({error:'Invalid request'},400);}
   const {evidence,...choices}=input||{};const clean=validateSubscription({...choices,course:choices.course||choices.weekly?choices.course:true});
   if(!clean||typeof choices.course!=='boolean'||typeof choices.weekly!=='boolean'||typeof evidence!=='string'||evidence.length<5||evidence.length>300)return response({error:'Consent evidence required'},400);
   const key='subscriber:'+await digest(clean.email);
   return this.ctx.storage.transaction(async tx=>{
    const row=await tx.get(key);if(!row||!['subscribed','verified'].includes(row.status))return response({error:'Only active, unsuppressed subscriptions can change'},409);
    if((row.audit||[]).length>=100)return response({error:'Operator archive required'},409);
    const at=new Date().toISOString();row.language=clean.language;row.course=choices.course;row.weekly=choices.weekly;row.consentVersion=clean.consentVersion;
    row.audit.push({event:'preferences',at,course:row.course,weekly:row.weekly,consentVersion:clean.consentVersion,evidence});
    if(!row.course&&!row.weekly){row.status='suppressed';row.unsubscribedAt=at;}
    await tx.put(key,row);return response({updated:true});
   });
  }
  if(path==='/admin/cleanup'){
   if(!this.env.ADMIN_TOKEN||request.headers.get('Authorization')!==`Bearer ${this.env.ADMIN_TOKEN}`)return response({error:'Unauthorized'},401);
   if(request.method!=='POST')return response({error:'Method not allowed'},405);
   return response({removed:await this.cleanup()});
  }
  if(path==='/confirm'&&request.method==='GET'||path==='/unsubscribe/confirm'&&request.method==='GET')return confirmationPage(path==='/confirm'?'confirm':'unsubscribe');
  if(path==='/admin/subscribers'){
   if(!this.env.ADMIN_TOKEN||request.headers.get('Authorization')!==`Bearer ${this.env.ADMIN_TOKEN}`)return response({error:'Unauthorized'},401);
   if(request.method!=='GET')return response({error:'Method not allowed'},405);
   const rows=[...(await this.ctx.storage.list({prefix:'subscriber:',limit:5000})).values()];
   return response({sendingEnabled:this.env.SENDING_ENABLED==='true',subscribers:rows.map(({email,language,course,weekly,status,createdAt,consentVersion,unsubscribedAt,attribution})=>({email,language,course,weekly,status,createdAt,consentVersion,unsubscribedAt,attribution}))});
  }
  if(!['/subscribe','/unsubscribe','/confirm'].includes(path))return response({error:'Not found'},404);
  // Link scanners and crawlers cannot unsubscribe anyone with GET.
  if(request.method!=='POST')return response({error:'Submit a confirmation using POST'},405);
  if(!ORIGINS.has(request.headers.get('Origin'))&&request.headers.get('Origin')!==new URL(request.url).origin)return response({error:'Forbidden'},403);
  if(!this.env.RATE_SECRET)return response({error:'Not configured'},503);
  if(path==='/subscribe'&&this.env.INTAKE_ENABLED!=='true')return response({error:'Subscriptions are not open yet'},503);
  let input;try{input=await readBody(request);}catch{return response({error:'Invalid request'},400);}
  if(path==='/confirm'){
   if(!input||Object.keys(input).some(k=>k!=='token')||! /^[a-f0-9]{64}$/.test(input.token||''))return response({error:'Invalid request'},400);
   const hash=await digest(input.token);
   return this.ctx.storage.transaction(async tx=>{
    const key=await tx.get('verify:'+hash);const row=key&&await tx.get(key);
    if(!row||row.status!=='pending-verification'||Date.parse(row.verificationExpiresAt)<Date.now())return response({error:'This confirmation link is expired or already used'},410);
    row.status='verified';row.verifiedAt=new Date().toISOString();row.audit.push({event:'verified',at:row.verifiedAt});delete row.verificationToken;delete row.verificationExpiresAt;
    await tx.delete('verify:'+hash);await tx.put(key,row);
    if(row.course)for(const day of [0,3,7])await enqueue(tx,{id:`course_${hash}_${day}`,subscriberKey:key,templateId:`course-day${day}`,kind:'course',dueAt:Date.now()+day*86400000});
    await tx.setAlarm(Date.now()+60000);return response({confirmed:true,sendingEnabled:this.env.SENDING_ENABLED==='true'});
   });
  }
  if(path==='/unsubscribe'){
   if(!input||Object.keys(input).some(k=>k!=='token')||typeof input.token!=='string'||! /^[a-f0-9]{64}$/.test(input.token))return response({error:'Invalid request'},400);
   const hash=await digest(input.token);
   return this.ctx.storage.transaction(async tx=>{
    const key=await tx.get('token:'+hash);if(key){const row=await tx.get(key);if(row&&row.status!=='suppressed'){if(row.verificationToken){await tx.delete('verify:'+await digest(row.verificationToken));delete row.verificationToken;delete row.verificationExpiresAt;}row.audit.push({event:'unsubscribed',at:new Date().toISOString()});row.status='suppressed';row.course=false;row.weekly=false;row.unsubscribedAt=new Date().toISOString();await tx.put(key,row);const otherKey=key.startsWith('buyer:')?key.replace('buyer:','subscriber:'):key.replace('subscriber:','buyer:');const other=await tx.get(otherKey);if(other){other.status='suppressed';other.course=false;other.weekly=false;other.audit.push({event:'unsubscribed',at:row.unsubscribedAt});await tx.put(otherKey,other);}}}
    return response({unsubscribed:true});
   });
  }
  const clean=validateSubscription(input);if(!clean)return response({error:'Invalid subscription'},400);
  if(!String(this.env.LAUNCH_BANKS||'en-US-ga,fr').split(',').includes(clean.language))return response({error:'Choose English or French for the listening email course'},400);
  if(clean.weekly && this.env.WEEKLY_SERIES_READY!=='true')return response({error:'The weekly listening series is not open yet'},503);
  const day=new Date().toISOString().slice(0,10);
  const ipHash=await digest(this.env.RATE_SECRET+'|'+day+'|'+(request.headers.get('CF-Connecting-IP')||'unknown'));
  const key='subscriber:'+await digest(clean.email);const now=new Date().toISOString();
  return this.ctx.storage.transaction(async tx=>{
   // One bounded, rotating rate map; neither addresses nor raw IPs appear here.
   let rate=await tx.get('rate');if(rate?.day!==day)rate={day,counts:{}};
   const count=rate.counts[ipHash]||0;
   if(count>=5||(!count&&Object.keys(rate.counts).length>=1000))return response({error:'Please try later'},429);
   rate.counts[ipHash]=count+1;await tx.put('rate',rate);
   const old=await tx.get(key);if(old)return response({received:true}); // No address enumeration or opt-in resurrection.
   const total=await tx.get('total')||0;if(total>=5000)return response({error:'Please try later'},503);
   const token=randomToken();
   await tx.put(key,{...clean,status:'subscribed',createdAt:now,subscribedAt:now,ownershipVerified:false,unsubscribeToken:token,audit:[{event:'subscribed',at:now,course:clean.course,weekly:clean.weekly,consentVersion:clean.consentVersion}]});
   if(clean.course)for(const day of [0,3,7])await enqueue(tx,{id:`course_${await digest(token)}_${day}`,subscriberKey:key,templateId:`course-day${day}`,kind:'course',dueAt:Date.now()+day*86400000});
   await tx.setAlarm(Date.now()+60000);
   await tx.put('token:'+await digest(token),key);await tx.put('total',total+1);
   return response({received:true});
  });
 }
}
export default {async scheduled(event,env,ctx){
 ctx.waitUntil(env.AUDIENCE.get(env.AUDIENCE.idFromName('audience-v1')).fetch(new Request('https://internal/admin/buyers/tick',{method:'POST',headers:{Authorization:`Bearer ${env.ADMIN_TOKEN}`}})));
},async fetch(request,env){
 const origin=request.headers.get('Origin');
 if(request.method==='OPTIONS')return new Response(null,{status:ORIGINS.has(origin)?204:403,headers:ORIGINS.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}:{}});
 const result=await env.AUDIENCE.get(env.AUDIENCE.idFromName('audience-v1')).fetch(request);
 const headers=new Headers(result.headers);if(ORIGINS.has(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}
 return new Response(result.body,{status:result.status,headers});
}};

function confirmationPage(action){
 const title=action==='confirm'?'Confirm your listening emails':'Unsubscribe from listening emails';
 const nonce=randomToken();
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><main><h1>${title}</h1><p id="status">Select the button to confirm your choice.</p><button id="confirm">${action==='confirm'?'Confirm subscription':'Unsubscribe'}</button></main><script nonce="${nonce}">const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const button=document.getElementById('confirm'),status=document.getElementById('status');button.onclick=async()=>{button.disabled=true;try{const r=await fetch('/${action}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});status.textContent=r.ok?'Your choice has been saved.':'This link could not be used. Contact support@minimalpairs.co for help.';}catch{status.textContent='Connection failed. Please try again.';button.disabled=false;}};</script></html>`;
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`}});
}

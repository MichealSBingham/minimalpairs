import {sealCheckoutContext,queuePlausiblePurchase,plausiblePurchaseStatus} from './plausible-purchases.mjs';
import {sanitizeAttribution} from '../billing/analytics.mjs';
import {landingPath} from '../app/src/lib/landing-path.mjs';
const EVENTS=new Set(['page_view','practice_start','practice_first_answer','practice_answer','practice_complete','practice_exit','practice_audio_error','practice_group_complete','diagnostic_start','diagnostic_complete','diagnostic_results_view','diagnostic_report_preview','diagnostic_report_unlock_click','diagnostic_report_open','diagnostic_offer_click','plans_view','paywall_view','plan_selected','begin_checkout','checkout_resumed','checkout_error','login','guide_audio_play','challenge_start','challenge_complete','course_signup','checkout_context']);
const LANG=/^(en|fr|de|es|it|pt|ru|ja|zh|none)$/;
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
const digest=async x=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x)));
async function mac(secret,value){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)));}
const dayOf=t=>new Date(t).toISOString().slice(0,10);
const ok=x=>Response.json(x,{headers:{'Cache-Control':'no-store'}});
export function cleanEvent(x){
 if(!x||typeof x!=='object'||Object.keys(x).some(k=>!['event','occurredAt','id','language','contrast','path','source','medium','campaign','ui_locale','attempt','kind','mode','surface','round','correct','total','duration_ms','plan','diagnostic_length'].includes(k)))return null;
 if(!EVENTS.has(x.event)||! /^[a-f0-9-]{36}$/.test(x.id||''))return null;
 const out={event:x.event,id:x.id,language:LANG.test(x.language||'')?x.language:'none',contrast:/^(en|fr|de|es|it|pt|ru|ja|zh)-[a-z0-9-]{1,60}$/.test(x.contrast||'')?x.contrast:'none',path:landingPath(x.path)||(['/', '/practice','/account','/pricing'].includes(x.path)?x.path:'/other')};
 const a=sanitizeAttribution({source:x.source,medium:x.medium,ui_locale:x.ui_locale,...(x.campaign?{campaign:x.campaign}:{})});
 if(a)Object.assign(out,a);
 for(const [k,values] of Object.entries({diagnostic_length:['short','full'],kind:['focused','mixed','diagnostic','path'],mode:['abx-cross-word','word-identification'],surface:['practice','pricing','account','diagnostic','guide'],plan:['monthly','lifetime']}))if(values.includes(x[k]))out[k]=x[k];
 if(/^(?:(focused|mixed|diagnostic)-)?[a-f0-9-]{36}$/.test(x.attempt||''))out.attempt=x.attempt;
 for(const k of ['round','correct','total','duration_ms'])if(Number.isInteger(x[k])&&x[k]>=0&&x[k]<=(k==='duration_ms'?86400000:1000))out[k]=x[k];
 if(Number.isSafeInteger(x.occurredAt))out.occurredAt=x.occurredAt;
 return out;
}
async function boundedBody(request){const reader=request.body?.getReader();if(!reader)throw Error('body');let size=0,s='';const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw Error('size');}s+=decoder.decode(value,{stream:true});}return JSON.parse(s+decoder.decode());}
function increment(map,key,n=1){if(Object.hasOwn(map,key)||Object.keys(map).length<4000)map[key]=(map[key]||0)+n;}
function emptyDay(){return {version:1,events:{},languages:{},sources:{},pages:{},funnel:{visitors:0,practiceStarted:0,answered:0,completed:0,checkout:0,purchased:0},purchases:0,grossMinor:{},purchaseSources:{},purchaseLanguages:{},diagnostics:{},rejectedBots:0};}
export async function productAnalytics(request,storage,env,now=Date.now()){
 const path=new URL(request.url).pathname;
 if(path==='/admin/analytics'){
  if(!env.ADMIN_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.ADMIN_TOKEN)return new Response(null,{status:401});
  if(request.method!=='GET')return new Response(null,{status:405});
  await pruneProductAnalytics(storage,now);
  const attemptSummary={};for(const j of (await storage.list({prefix:'productJourney:',limit:10000})).values())for(const a of Object.values(j.attempts||{})){const key=[j.day,a.language,a.contrast].join('|'),v=attemptSummary[key]||={attempts:0,answeredRounds:0,completed:0,exited:0,inactiveIncomplete:0};v.attempts++;v.answeredRounds+=a.answers||0;if(a.completed)v.completed++;else if(a.exited)v.exited++;else if(now-a.lastAt>30*60000)v.inactiveIncomplete++;}
  return ok({version:1,attemptSummary,plausiblePurchases:await plausiblePurchaseStatus(storage),checkedAt:new Date(now).toISOString(),timezone:'UTC',definition:'Daily estimated visitors; no cross-day or cross-device identity. Funnels count ordered stages within a daily estimate. Payments are server-verified; purchase source is observed context, not motivation.',days:Object.fromEntries(await storage.list({prefix:'productDay:',limit:100})),latestVerifiedPurchases:[...(await storage.list({prefix:'productPurchase:',limit:1000})).values()].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)).slice(0,50)});
 }
 if(path==='/internal/purchase'){
  if(!env.REPORTING_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.REPORTING_TOKEN)return new Response(null,{status:401});
  if(request.method!=='POST')return new Response(null,{status:405});
  let p;try{p=await boundedBody(request);}catch{return new Response(null,{status:400});}
  if(!/^cs_(?:live_|test_)?[A-Za-z0-9]+$/.test(p.purchaseId||'')||!Number.isInteger(p.amount)||p.amount<0||! /^[a-z]{3}$/.test(p.currency||'')||!Number.isInteger(p.created)||p.created*1000>now+60000)return new Response(null,{status:400});
  const key='productPurchase:'+await digest(p.purchaseId),m=p.metadata||{},attribution=sanitizeAttribution(Object.fromEntries(Object.entries(m).filter(([k])=>k.startsWith('mp_')).map(([k,v])=>[k.slice(3),v])))||{};
  // A signed daily receipt can join an anonymous daily journey, never an account or email.
  let journeyKey;const parts=String(m.mp_journey||'').split('.');
  if(parts.length===3&&/^\d{4}-\d{2}-\d{2}$/.test(parts[0])&&/^[a-f0-9]{64}$/.test(parts[1])&&parts[2]===await mac(env.REPORTING_TOKEN,parts.slice(0,2).join('.')))journeyKey='productJourney:'+parts[0]+':'+parts[1];
  return storage.transaction(async tx=>{
   if(await tx.get(key))return ok({recorded:true,duplicate:true});
   const j=journeyKey&&await tx.get(journeyKey),day=dayOf((Number.isInteger(p.paidAt)&&p.paidAt>=p.created&&p.paidAt*1000<=now+60000?p.paidAt:p.created)*1000),d=await tx.get('productDay:'+day)||emptyDay();
   const diagnosticLength=attribution.diagnostic_length||j?.diagnosticLength||'unknown';d.diagnostics||={};d.diagnostics[diagnosticLength]||={};increment(d.diagnostics[diagnosticLength],'purchases');
   d.purchases++;increment(d.grossMinor,p.currency,p.amount);const source=(attribution.source&&attribution.source!=='unknown'?attribution.source:null)||(j?.source&&j.source!=='unknown'?j.source:null)||'unattributed',language=attribution.language||j?.language||'unknown';increment(d.purchaseSources,source);increment(d.purchaseLanguages,language);
   if(j&&!j.purchased){j.purchased=true;const jd=day===j.day?d:await tx.get('productDay:'+j.day)||emptyDay();updateFunnel(j,jd);await tx.put(journeyKey,j);if(day!==j.day)await tx.put('productDay:'+j.day,jd);}
   await queuePlausiblePurchase(tx,env,key,j?.plausibleContext,{domain:'minimalpairs.co',name:'Purchase',url:'https://minimalpairs.co'+(attribution.landing_page||j?.landing||'/pricing'),props:{source,language,diagnostic_length:diagnosticLength,contrast:attribution.contrast||j?.contrast||'unknown',plan:['lifetime','monthly'].includes(p.plan)?p.plan:'membership'},revenue:{currency:p.currency.toUpperCase(),amount:p.amount/100}},now);
   await tx.put('productDay:'+day,d);await tx.put(key,{recordedAt:new Date(now).toISOString(),checkoutCreatedAt:new Date(p.created*1000).toISOString(),paymentConfirmedAt:Number.isInteger(p.paidAt)?new Date(p.paidAt*1000).toISOString():null,amount:p.amount,currency:p.currency,source,language,diagnosticLength,landingPage:attribution.landing_page||j?.landing||'unknown',contrast:attribution.contrast||j?.contrast||'unknown',sessionKind:attribution.session_kind||j?.kind||'unknown',joined:!!j});return ok({recorded:true});
  });
 }
 if(path!=='/events'||request.method!=='POST')return new Response(null,{status:405});
 let x;try{x=cleanEvent(await boundedBody(request));}catch{}if(!x)return new Response(null,{status:400});
 const ip=request.headers.get('CF-Connecting-IP'),ua=request.headers.get('User-Agent');if(!ip||!ua)return new Response(null,{status:204});
 if(/bot\b|crawler|spider|headless|lighthouse|curl\/|wget\//i.test(ua))return new Response(null,{status:204});
 if(!env.REPORTING_TOKEN)return new Response(null,{status:503});
 const day=dayOf(now);
 const result=await storage.transaction(async tx=>{
  const saltKey='productSalt:'+day;let salt=await tx.get(saltKey);if(!salt){salt=crypto.randomUUID()+crypto.randomUUID();await tx.put(saltKey,salt);}
  const hash=await digest(JSON.stringify([salt,ip,ua])),key='productJourney:'+day+':'+hash;
  let j=await tx.get(key);const d=await tx.get('productDay:'+day)||emptyDay();
  if(!j){if(d.funnel.visitors>=10000)return {limited:true};j={day,source:x.source||'unknown',medium:x.medium||'none',campaign:x.campaign,landing:x.path,events:[],attempts:{},firstSeen:now};d.funnel.visitors++;increment(d.sources,j.source);increment(d.pages,j.landing);}
  if(j.events.includes(x.id))return {journey:day+'.'+hash,...context(j)};
  if(j.events.length>=500)return {limited:true};j.events.push(x.id);
  if(x.surface)j.surface=x.surface;
  if(x.diagnostic_length)j.diagnosticLength=x.diagnostic_length;
  const dl=x.diagnostic_length||j.diagnosticLength||'unknown';
  if(x.event.startsWith('diagnostic_')||(['plans_view','begin_checkout'].includes(x.event)&&j.diagnosticLength)){d.diagnostics||={};d.diagnostics[dl]||={};increment(d.diagnostics[dl],x.event);}
  if(x.event==='checkout_context')j.plausibleContext=await sealCheckoutContext(request,env,now);
  if(x.event!=='checkout_context')increment(d.events,x.event);
  if(x.language!=='none'){j.language=x.language;j.contrast=x.contrast;if(x.kind)j.kind=x.kind;increment(d.languages,[x.event,x.language,x.contrast].join('|'));}
  const occurred=Number.isSafeInteger(x.occurredAt)&&Math.abs(x.occurredAt-now)<600000?x.occurredAt:now;
  const mark={practice_start:'startAt',practice_first_answer:'answerAt',practice_complete:'completeAt',begin_checkout:'checkoutAt'}[x.event];
  if(mark)j[mark]=Math.min(j[mark]??Infinity,occurred);
  updateFunnel(j,d);
  if(x.attempt){if(j.attempts[x.attempt]||Object.keys(j.attempts).length<40){const a=j.attempts[x.attempt]||{language:x.language,contrast:x.contrast,startedAt:now,answers:0};if(x.kind)a.kind=x.kind;if(x.diagnostic_length)a.diagnosticLength=x.diagnostic_length;if(x.event==='practice_answer'){a.answers++;increment(d.languages,['answered_rounds',x.language,x.contrast].join('|'));if(x.correct===1)increment(d.languages,['correct_rounds',x.language,x.contrast].join('|'));}if(x.event==='practice_complete')a.completed=true;if(x.event==='practice_exit')a.exited=true;if(!a.lastAt||occurred>=a.lastAt){a.lastEvent=x.event;a.lastAt=occurred;};j.attempts[x.attempt]=a;}}
  await tx.put(key,j);await tx.put('productDay:'+day,d);return {journey:day+'.'+hash,...context(j)};
 });
 if(result.journey)result.journey+='.'+await mac(env.REPORTING_TOKEN,result.journey);
 const alarm=await storage.getAlarm?.();if(!alarm||alarm>now+60000)await storage.setAlarm(now+60000);
 return ok(result);
}
function context(j){return {source:j.source,medium:j.medium,...(j.campaign?{campaign:j.campaign}:{}),surface:j.surface,landing_page:landingPath(j.landing),language:j.language,contrast:j.contrast,session_kind:j.kind,diagnostic_length:j.diagnosticLength};}
export async function pruneProductAnalytics(storage,now=Date.now()){
 for(const prefix of ['productJourney:','productSalt:','productDay:','productPurchase:']){let cursor;do{const rows=await storage.list({prefix,limit:500,...(cursor?{startAfter:cursor}:{})});if(!rows.size)break;cursor=[...rows.keys()].at(-1);const cutoff=dayOf(now-(prefix==='productDay:'||prefix==='productPurchase:'?90:2)*86400000);for(const [key,row] of rows){if(prefix==='productJourney:'&&row.plausibleContext?.expires<now){delete row.plausibleContext;await storage.put(key,row);}if((prefix==='productPurchase:'?row.recordedAt.slice(0,10):key.slice(prefix.length,prefix.length+10))<cutoff)await storage.delete(key);}if(rows.size<500)break;}while(cursor);}
}

function updateFunnel(j,d){
 const next={practiceStarted:j.startAt!==undefined,answered:j.startAt!==undefined&&j.answerAt>=j.startAt,completed:j.startAt!==undefined&&j.answerAt>=j.startAt&&j.completeAt>=j.answerAt,checkout:j.checkoutAt!==undefined,purchased:!!j.purchased&&j.checkoutAt!==undefined};
 j.counted||={};for(const [k,value] of Object.entries(next)){if(value&&!j.counted[k]){d.funnel[k]++;j.counted[k]=true;}}
}

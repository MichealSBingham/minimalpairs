import {acquisitionDetails,measurementPath,landingPath,type EventData} from './measurement-data';
import {reportToPlausible} from './plausible-reporting';
const endpoint='https://minimalpairs-audio-reports.sirmichealbingham.workers.dev/events';
let context:Record<string,unknown>={},pending:Promise<unknown>=Promise.resolve();
let pageSent=false;
const exposures=new Set<string>();
export function productReportingEnabled(){
 if(typeof window==='undefined'||document.documentElement.dataset.measurementEnvironment!=='production'||/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)||navigator.webdriver)return false;
 try{return localStorage.getItem('minimalpairs.analytics-excluded.v1')!=='true';}catch{return true;}
}
/** No analytics cookie, local/session visitor ID, raw referrer, email, or account ID. */
export function productEvent(event:string,data:EventData={}){
 if(!productReportingEnabled())return Promise.resolve();
 if(event==='page_view'){if(pageSent)return pending;pageSent=true;}
 if(['plans_view','paywall_view','diagnostic_report_preview'].includes(event)){const key=JSON.stringify([event,data.surface,data.language_id,data.contrast_id,data.plan]);if(exposures.has(key))return pending;exposures.add(key);}
 try{reportToPlausible(event,data);}catch{/* A third-party outage must not interrupt first-party reporting. */}
 const a=acquisitionDetails(document.referrer,window.location.origin,window.location.search);
 const source=a.source||(a.channel==='direct'?'direct':'unknown');
 const q=new URLSearchParams(window.location.search);
 const payload={event,occurredAt:Date.now(),id:crypto.randomUUID(),path:measurementPath(window.location.pathname),source,medium:a.medium||(a.channel==='direct'?'none':'referral'),...('campaign' in a?{campaign:a.campaign}:{}),ui_locale:document.documentElement.lang||'en',language:data.language_id||q.get('language')||'none',contrast:data.contrast_id||q.get('contrast')||'none',attempt:data.attempt_id,kind:data.session_kind,mode:data.activity_mode,surface:data.surface,round:data.round,correct:data.correct,total:data.total,duration_ms:data.duration_ms,plan:data.plan};
 const send=async()=>{try{const r=await fetch(endpoint,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload),keepalive:true,signal:AbortSignal.timeout(2500)});if(r.ok&&r.status!==204){const d=await r.json();if(d.journey)context=d;}}catch{/* Audio and checkout remain available if reporting fails. */}};
 // A simple content type avoids an unload-time CORS preflight. The body is still parsed as JSON.
 // Dispatch immediately, including pagehide; don't strand exit events behind a queue.
 const task=send();pending=Promise.allSettled([pending,task]);return task;
}
export async function productCheckoutContext(){
 if(!productReportingEnabled())return undefined;
 await productEvent('checkout_context');
 const a=acquisitionDetails(document.referrer,window.location.origin,window.location.search);
 return {source:context.source||a.source||'unknown',medium:context.medium||a.medium||'none',ui_locale:document.documentElement.lang||'en',...(context.journey?{journey:context.journey}:{}),...(landingPath(String(context.landing_page||''))?{landing_page:context.landing_page}:{}),...Object.fromEntries(['language','contrast','session_kind','surface','campaign'].filter(k=>context[k]).map(k=>[k,context[k]]))};
}

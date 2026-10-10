import {plausibleEvents,plausibleProperties} from './plausible-events.mjs';
import {measurementPath,acquisitionDetails,type EventData} from './measurement-data';
type Tracker=((name:string,options:Record<string,unknown>)=>void)&{q?:unknown[];o?:Record<string,unknown>;init?:(options:Record<string,unknown>)=>void};
declare global {interface Window {plausible?:Tracker}}
let installed=false;
export function reportToPlausible(event:string,data:EventData={}){
 if(typeof window==='undefined'||!['minimalpairs.co','www.minimalpairs.co'].includes(location.hostname)||document.documentElement.dataset.measurementEnvironment!=='production'||navigator.webdriver)return;
 try{if(localStorage.getItem('minimalpairs.analytics-excluded.v1')==='true'||localStorage.getItem('plausible_ignore')==='true')return;}catch{}
 const name=plausibleEvents[event as keyof typeof plausibleEvents];if(!name)return;
 if(!installed){
  const tracker=window.plausible||Object.assign(function(name:string,options:Record<string,unknown>){tracker.q||=[];tracker.q.push([name,options]);},{q:[]} as unknown as Tracker);
  window.plausible=tracker;
  tracker.init||=(options)=>{tracker.o=options;};
  tracker.init({autoCapturePageviews:false,outboundLinks:false,fileDownloads:false,formSubmissions:false,transformRequest:(payload:Record<string,unknown>)=>{try{payload.r=payload.r?new URL(String(payload.r)).origin:null;}catch{payload.r=null;}return payload;}});
  const script=document.createElement('script');script.async=true;script.src='https://plausible.io/js/pa-ZGctM_1AgBSgv2Jn1ew-X.js';document.head.appendChild(script);installed=true;
 }
 const url=new URL(measurementPath(location.pathname),'https://minimalpairs.co');
 const a=acquisitionDetails(document.referrer,location.origin,location.search);
 if(a.source){url.searchParams.set('utm_source',a.source);if(a.medium)url.searchParams.set('utm_medium',a.medium);if('campaign' in a&&a.campaign)url.searchParams.set('utm_campaign',a.campaign);}
 const q=new URLSearchParams(location.search);
 window.plausible?.(name,{url:url.toString(),props:plausibleProperties({language_id:q.get('language')||undefined,contrast_id:q.get('contrast')||undefined,ui_locale:document.documentElement.lang,...data}),...(event==='practice_exit'||event==='practice_audio_error'?{interactive:false}:{})});
}

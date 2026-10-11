import {landingPath} from '../app/src/lib/landing-path.mjs';
// Coarse first-party purchase context. Never authorizes a purchase.
const sources=new Set(['google','bing','duckduckgo','yahoo','reddit','facebook','instagram','tiktok','linkedin','x','youtube','newsletter','refold','partner','friend','other','unknown','direct','chatgpt','claude','perplexity','copilot','gemini']);
const mediums=new Set(['organic','social','email','referral','cpc','none']);
const campaigns=new Set(['launch','diagnostic','sound-guide','comparison','listening-challenge']);
const locales=new Set(['en','es','fr','pt','de','it','ru','ja','zh']);
export function sanitizeAttribution(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['source','medium','campaign','ui_locale','landing_page','journey','language','contrast','session_kind','surface','diagnostic_length'].includes(k)))return undefined;
 if(!sources.has(input.source)||!mediums.has(input.medium)||!locales.has(input.ui_locale)||(input.campaign!==undefined&&!campaigns.has(input.campaign)))return undefined;
 const landing = landingPath(input.landing_page);
 const extra={};
 if(['short','full'].includes(input.diagnostic_length))extra.diagnostic_length=input.diagnostic_length;
 if(typeof input.journey==='string'&&/^\d{4}-\d{2}-\d{2}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(input.journey))extra.journey=input.journey;
 if(locales.has(input.language))extra.language=input.language;
 if(typeof input.contrast==='string'&&/^(en|fr|de|es|it|pt|ru|ja|zh)-[a-z0-9-]{1,60}$/.test(input.contrast))extra.contrast=input.contrast;
 if(['focused','mixed','diagnostic','path'].includes(input.session_kind))extra.session_kind=input.session_kind;
 if(['practice','account','pricing','diagnostic','guide'].includes(input.surface))extra.surface=input.surface;
 return {...extra,...(landing ? {landing_page:landing} : {}),source:input.source,medium:input.medium,...(input.campaign?{campaign:input.campaign}:{}),ui_locale:input.ui_locale};
}
export function attributionMetadata(input){
 const clean=sanitizeAttribution(input);
 return clean?Object.fromEntries(Object.entries(clean).map(([k,v])=>[`mp_${k}`,v])):{};
}
export function attributionFromMetadata(metadata){
 return sanitizeAttribution(Object.fromEntries(['source','medium','campaign','ui_locale','landing_page','journey','language','contrast','session_kind','surface','diagnostic_length'].filter(k=>metadata?.['mp_'+k]!==undefined).map(k=>[k,metadata['mp_'+k]])));
}

import {landingPath} from '../app/src/lib/landing-path.mjs';
// Optional, coarse, consented browser attribution. Never authorizes a purchase.
const sources=new Set(['google','bing','duckduckgo','yahoo','reddit','facebook','instagram','tiktok','linkedin','x','youtube','newsletter','refold','partner','other','direct','chatgpt','claude','perplexity','copilot','gemini']);
const mediums=new Set(['organic','social','email','referral','cpc','none']);
const campaigns=new Set(['launch','diagnostic','sound-guide','comparison']);
const locales=new Set(['en','es','fr','pt','de','it','ru','ja','zh']);
export function sanitizeAttribution(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['source','medium','campaign','ui_locale','landing_page'].includes(k)))return undefined;
 if(!sources.has(input.source)||!mediums.has(input.medium)||!locales.has(input.ui_locale)||(input.campaign!==undefined&&!campaigns.has(input.campaign)))return undefined;
 const landing = landingPath(input.landing_page);
 return {...(landing ? {landing_page:landing} : {}),source:input.source,medium:input.medium,...(input.campaign?{campaign:input.campaign}:{}),ui_locale:input.ui_locale};
}
export function attributionMetadata(input){
 const clean=sanitizeAttribution(input);
 return clean?Object.fromEntries(Object.entries(clean).map(([k,v])=>[`mp_${k}`,v])):{};
}
export function attributionFromMetadata(metadata){
 return sanitizeAttribution({source:metadata?.mp_source,medium:metadata?.mp_medium,...(metadata?.mp_campaign?{campaign:metadata.mp_campaign}:{}),ui_locale:metadata?.mp_ui_locale,...(metadata?.mp_landing_page?{landing_page:metadata.mp_landing_page}:{})});
}

import {landingPath} from './landing-path.mjs';
/** Coarse signup context only. Never store raw referrers, query strings or visitor IDs. */
export function courseAttribution(raw) {
 if(!raw || typeof raw!=='object' || Array.isArray(raw)) return undefined;
 const out={};
 const enums={source:['direct','unknown','google','bing','duckduckgo','yahoo','other','reddit','facebook','instagram','tiktok','linkedin','x','youtube','newsletter','refold','partner','friend','chatgpt','claude','perplexity','copilot','gemini'],medium:['none','organic','social','email','referral','cpc'],campaign:['launch','diagnostic','sound-guide','comparison','listening-challenge'],surface:['guide','account','diagnostic','practice'],diagnostic_length:['short','full']};
 for(const [key,values] of Object.entries(enums)) if(values.includes(raw[key])) out[key]=raw[key];
 for(const key of ['landing_page','signup_page']) {const value=landingPath(raw[key]);if(value)out[key]=value;}
 // Account is a known signup location, but never an acquisition landing page.
 if(typeof raw.signup_page==='string' && /^\/(?:fr\/|es\/|de\/|it\/|pt\/|ru\/|zh\/|ja\/)?account\/?$/.test(raw.signup_page))out.signup_page=raw.signup_page.replace(/\/$/,'');
 return Object.keys(out).length?out:undefined;
}

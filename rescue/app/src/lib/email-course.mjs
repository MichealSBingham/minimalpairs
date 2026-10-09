export const CONSENT_VERSION='listening-course-2026-10-09-v3';
export function courseEnabled(enabled, endpoint) {try{return enabled==='true' && new URL(endpoint).protocol==='https:';}catch{return false;}}
export function subscriptionPayload({email,language,course,weekly}) {
 const clean=email.trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean))throw Error('Enter a valid email address.');
 if(!course&&!weekly)throw Error('Choose which emails you would like to receive.');
 return {email:clean,language,course:course===true,weekly:weekly===true,consentVersion:CONSENT_VERSION};
}
export async function requestSubscription(endpoint,payload,fetcher=fetch) {
 const r=await fetcher(`${endpoint.replace(/\/$/,'')}/subscribe`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'omit'});
 if(!r.ok)throw Error(r.status===429?'Please wait before trying again.':r.status===503?'Email subscriptions are not open yet.':'We couldn’t save your request. Please try again.');
 return true;
}

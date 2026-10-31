// Keep only a public hostname: never a path, query, account identifier or IP.
export function cleanReferrerHost(value){
 if(typeof value!=='string'||value.length>253)return undefined;
 const h=value.toLowerCase().replace(/^www\./,'');
 if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)||h.endsWith('.local')||h.endsWith('.internal'))return undefined;
 if(['minimalpairs.co','minimalpairs.web.app','minimalpairs.firebaseapp.com','accounts.google.com','checkout.stripe.com','billing.stripe.com'].includes(h))return undefined;
 return h;
}
export function externalReferrerHost(referrer,origin){
 try{const u=new URL(referrer);if(!['http:','https:'].includes(u.protocol)||u.origin===origin)return undefined;return cleanReferrerHost(u.hostname);}catch{return undefined;}
}

// Keep the reason separate from the source: an internal hop is not a referral.
export function firstPartyAcquisition(details){
 const source=details.source||(details.channel==='direct'?'direct':'unknown');
 const medium=details.medium||(['referral','ai_referral'].includes(details.channel)?'referral':'none');
 const kind=['internal','direct','unknown'].includes(details.channel)?details.channel:'external';
 return {source,medium,referrer_kind:kind};
}

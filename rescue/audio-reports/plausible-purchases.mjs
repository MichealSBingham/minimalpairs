// Short-lived encrypted checkout context joins verified payments to Plausible visits.
// No email, account ID, Stripe ID, or raw network context is exposed in reports.
const bytes=s=>new TextEncoder().encode(s);
const to64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function key(env){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',bytes('plausible-checkout-v1:'+env.REPORTING_TOKEN)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function sealCheckoutContext(request,env,now){
 if(env.PLAUSIBLE_ENABLED!=='true')return undefined;
 const ip=request.headers.get('CF-Connecting-IP'),ua=request.headers.get('User-Agent');
 if(!ip||!ua||ua.length>1000)return undefined;
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),bytes(JSON.stringify({ip,ua,expires:now+2*86400000})));
 return {iv:to64(iv),data:to64(encrypted),expires:now+2*86400000};
}
export async function queuePlausiblePurchase(tx,env,purchaseKey,context,payload,now){
 if(env.PLAUSIBLE_ENABLED!=='true')return;
 const id='plausiblePurchase:'+purchaseKey.split(':')[1];
 if(await tx.get(id))return;
 await tx.put(id,context?{state:'queued',context,payload,createdAt:now}:{state:'missing-context',createdAt:now});
}
export async function deliverPlausiblePurchases(storage,env,{now=Date.now(),fetcher=fetch}={}){
 if(env.PLAUSIBLE_ENABLED!=='true')return;
 let count=0;
 for(const [id,row] of await storage.list({prefix:'plausiblePurchase:',limit:1000})){
  if(now-row.createdAt>2*86400000&&row.context){delete row.context;delete row.payload;if(row.state==='queued')row.state='expired';await storage.put(id,row);}
  if(now-row.createdAt>90*86400000){await storage.delete(id);continue;}
  if(row.state!=='queued'||count++>=10)continue;
  const reserved=await storage.transaction(async tx=>{const current=await tx.get(id);if(current?.state!=='queued')return false;current.state='sending';await tx.put(id,current);return true;});if(!reserved)continue;
  let state='uncertain';
  try{
   const context=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(row.context.iv)},await key(env),from64(row.context.data))));
   if(context.expires<now)state='expired';
   else{const r=await fetcher('https://plausible.io/api/event',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':context.ua,'X-Forwarded-For':context.ip},body:JSON.stringify(row.payload),signal:AbortSignal.timeout(8000)});state=r.ok?(r.headers.get('x-plausible-dropped')==='1'?'filtered':'accepted'):(r.status<500?'rejected':'uncertain');}
  }catch{}
  // Plausible has no event-id deduplication: never blindly resend an uncertain payment.
  await storage.put(id,{state,createdAt:row.createdAt,checkedAt:now});
 }
}
export async function plausiblePurchaseStatus(storage){const states={};for(const row of (await storage.list({prefix:'plausiblePurchase:',limit:1000})).values())states[row.state]=(states[row.state]||0)+1;return states;}

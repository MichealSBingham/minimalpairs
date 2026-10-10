// First-party counters; daily salted deduplication keys expire at the next UTC day.
const events=new Set(['page_view','practice_start','practice_complete','guide_audio_play']);
const languages=new Set(['en','fr','es','de','it','pt','ru','ja','zh','none']);
export function validAggregate(x){
 return x && Object.keys(x).every(k=>['event','language','contrast','rounds'].includes(k)) && events.has(x.event) && languages.has(x.language) && typeof x.contrast==='string' && /^(none|[a-z]{2}-[a-z0-9-]{1,60})$/.test(x.contrast) && Number.isInteger(x.rounds) && x.rounds>=0 && x.rounds<=200 && (x.event==='practice_complete'||x.rounds===0);
}
export async function aggregateRequest(request,storage,token){
 const url=new URL(request.url);
 if(url.pathname==='/admin/usage'){
  if(!token||request.headers.get('Authorization')!=='Bearer '+token)return Response.json({error:'Unauthorized'},{status:401});
  if(request.method!=='GET')return new Response(null,{status:405});
  await pruneUsage(storage);
  const rows=await storage.list({prefix:'usage:',limit:100});
  return Response.json({timezone:'UTC',measurement:'Daily estimated visitors, not exact people; daily estimates cannot be deduplicated across dates. Explicit opt-outs excluded.',days:Object.fromEntries(rows),visitorDays:Object.fromEntries(await storage.list({prefix:'visitors:',limit:100}))});
 }
 if(request.method!=='POST')return new Response(null,{status:405});
 const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
 let raw='',size=0;const decoder=new TextDecoder();
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();return new Response(null,{status:413});}raw+=decoder.decode(value,{stream:true});}
 let value;try{value=JSON.parse(raw+decoder.decode());}catch{return new Response(null,{status:400});}
 if(!validAggregate(value))return new Response(null,{status:400});
 const day=new Date().toISOString().slice(0,10),key='usage:'+day;
 await storage.transaction(async tx=>{
  const counters=await tx.get(key)||{};
  const bucket=[value.event,value.language,value.contrast].join('|');
  if(!counters[bucket]&&Object.keys(counters).length>=2048)return;
  const old=counters[bucket]||{events:0,rounds:0};
  counters[bucket]={events:old.events+1,rounds:old.rounds+value.rounds};
  await tx.put(key,counters);
  // Only page views count site visitors. Missing transport metadata is not a visitor.
  const ip=request.headers.get('CF-Connecting-IP'),ua=request.headers.get('User-Agent');
  if(value.event==='page_view'&&ip&&ua){
   const saltKey='dailySalt:'+day;
   let salt=await tx.get(saltKey);
   if(!salt){salt=crypto.randomUUID()+crypto.randomUUID();await tx.put(saltKey,salt);}
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([salt,'minimalpairs.co',ip,ua]))))].map(n=>n.toString(16).padStart(2,'0')).join('');
   const seen='dailySeen:'+day+':'+hash;
   const totals=await tx.get('visitors:'+day)||{estimatedVisitors:0,measuredPageviews:0,startedAt:new Date().toISOString()};
   totals.measuredPageviews++;
   if(!await tx.get(seen)){await tx.put(seen,true);totals.estimatedVisitors++;}
   await tx.put('visitors:'+day,totals);
  }
 });
 const alarm=await storage.getAlarm?.();
 if(!alarm||alarm>Date.now()+60000)await storage.setAlarm(Date.now()+60000);
 return new Response(null,{status:204});
}
export async function pruneUsage(storage){
 const cutoff='usage:'+new Date(Date.now()-90*86400000).toISOString().slice(0,10);
 for(const prefix of ['usage:','visitors:'])for(const key of (await storage.list({prefix,limit:1000})).keys())if(key<prefix+cutoff.slice(6))await storage.delete(key);
 const today=new Date().toISOString().slice(0,10);
 for(const prefix of ['dailySeen:','dailySalt:']){
  let cursor;
  do{const rows=await storage.list({prefix,limit:500,...(cursor?{startAfter:cursor}:{})});if(!rows.size)break;
   cursor=[...rows.keys()].at(-1);
   for(const key of rows.keys())if(!key.startsWith(prefix+today))await storage.delete(key);
   if(rows.size<500)break;
  }while(cursor);
 }
}

export async function scheduleUsageCleanup(storage){
 if(!(await storage.list({prefix:'usage:',limit:1})).size)return;
 const next=Date.parse(new Date().toISOString().slice(0,10))+86400000+1000,alarm=await storage.getAlarm?.();
 if(!alarm||alarm>next)await storage.setAlarm(next);
}

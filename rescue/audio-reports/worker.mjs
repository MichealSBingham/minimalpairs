import {queueNotification, deliverNext, notificationStatus} from './notifications.mjs';
const origins=new Set(['https://minimalpairs.web.app','https://minimalpairs.co','https://www.minimalpairs.co']);
const hex=/^[a-f0-9]{64}$/;
export function validReport(x){return x&&Object.keys(x).every(k=>['clipId','sha256','languageId','voiceId','reason'].includes(k))&&hex.test(x.clipId)&&hex.test(x.sha256)&&/^[a-zA-Z0-9-]{1,24}$/.test(x.languageId)&&/^[a-zA-Z0-9_-]{1,100}$/.test(x.voiceId)&&['pronunciation','repetition','noise','playback'].includes(x.reason);}
export function validSupport(x){return x&&Object.keys(x).every(k=>['email','topic','message','requestId'].includes(k))&&typeof x.email==='string'&&x.email.length<=254&&!/[<>,;\"\r\n]/.test(x.email)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)&&['account','billing','audio','other'].includes(x.topic)&&typeof x.message==='string'&&x.message.trim().length>=5&&x.message.length<=4000&&/^[a-f0-9-]{36}$/.test(x.requestId);}
const json=(data,status=200)=>Response.json(data,{status});
export class ReportInbox{
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async fetch(request){
  const u=new URL(request.url),s=this.ctx.storage;
  if(u.pathname==='/admin/notifications'){
   if(!this.env.ADMIN_TOKEN||request.headers.get('Authorization')!=='Bearer '+this.env.ADMIN_TOKEN)return json({error:'Unauthorized'},401);
   if(request.method==='POST'){
    for(const r of (await s.list({prefix:'support:',limit:10000})).values())await s.transaction(tx=>queueNotification(tx,r.ticketId,'support',r));
    for(const r of (await s.list({prefix:'report:',limit:10000})).values())await s.transaction(tx=>queueNotification(tx,r.clipId+'-'+r.sha256+'-'+r.reason,'report',r));
    await s.setAlarm(Date.now()+2000);
   }else if(request.method!=='GET')return json({error:'Method not allowed'},405);
   return json(await notificationStatus(s,this.env));
  }
  if(u.pathname==='/admin/support'){
   if(!this.env.ADMIN_TOKEN||request.headers.get('Authorization')!=='Bearer '+this.env.ADMIN_TOKEN)return json({error:'Unauthorized'},401);
   if(request.method!=='GET')return json({error:'Method not allowed'},405);
   return json({tickets:[...(await s.list({prefix:'support:',limit:10000})).values()]});
  }
  if(u.pathname==='/admin/reports'){
   if(!this.env.ADMIN_TOKEN||request.headers.get('Authorization')!=='Bearer '+this.env.ADMIN_TOKEN)return json({error:'Unauthorized'},401);
   if(request.method==='DELETE'){const clipId=u.searchParams.get('clipId'),sha=u.searchParams.get('sha256'),reason=u.searchParams.get('reason');if(!hex.test(clipId||'')||!hex.test(sha||'')||!['pronunciation','repetition','noise','playback'].includes(reason))return json({error:'Invalid'},400);await s.transaction(async tx=>{const key='report:'+clipId+':'+sha+':'+reason;if(await tx.get(key)){await tx.delete(key);await tx.put('total',Math.max(0,(await tx.get('total')||0)-1));}});return json({removed:true});}
   const rows=await s.list({prefix:'report:',limit:10000});return json({reports:[...rows.values()]});
  }
  if(request.method!=='POST'||!['/report','/support'].includes(u.pathname))return json({error:'Not found'},404);
  const reader=request.body?.getReader();if(!reader)return json({error:'Invalid report'},400);
  let raw='',size=0;const decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>(u.pathname==='/support'?18000:1200)){await reader.cancel();return json({error:'Too large'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
  let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid report'},400);}
  const support=u.pathname==='/support';
  if(support?!validSupport(body):!validReport(body))return json({error:'Invalid report'},400);
  // A day-scoped hash throttles abuse without retaining IP addresses.
  const day=new Date().toISOString().slice(0,10),ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(day+'|'+ip+'|'+this.env.ADMIN_TOKEN)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(support)return s.transaction(async tx=>{
   const rateKey='rate:'+day+':support:'+hash,n=await tx.get(rateKey)||0;
   if(n>=5)return json({error:'Please try again tomorrow'},429);
   const key='support:'+hash+':'+body.requestId,existing=await tx.get(key);
   if(existing)return json({saved:true,ticketId:existing.ticketId});
   const total=await tx.get('supportTotal')||0;if(total>=10000)return json({error:'Please try again later'},503);
   const ticketId=crypto.randomUUID(),ticket={ticketId,email:body.email.trim(),topic:body.topic,message:body.message.trim(),createdAt:new Date().toISOString()};await tx.put(key,ticket);
   await tx.put('supportTotal',total+1);await tx.put(rateKey,n+1);await queueNotification(tx,ticketId,'support',ticket);return json({saved:true,ticketId});
  });
  return s.transaction(async tx=>{
   const rateKey='rate:'+day+':'+hash,n=await tx.get(rateKey)||0;
   if(n>=30)return json({error:'Please try again tomorrow'},429);
   const key='report:'+body.clipId+':'+body.sha256+':'+body.reason;
   const duplicate='seen:'+day+':'+hash+':'+body.clipId+':'+body.sha256+':'+body.reason;
   if(await tx.get(duplicate))return json({saved:true});
   const old=await tx.get(key),total=await tx.get('total')||0;
   if(!old&&total>=10000)return json({error:'Please try again later'},503);
   await tx.put(rateKey,n+1);await tx.put(duplicate,true);
   await tx.put(key,{...body,count:(old?.count||0)+1,firstSeen:old?.firstSeen||new Date().toISOString(),lastSeen:new Date().toISOString()});
   if(!old){await tx.put('total',total+1);await queueNotification(tx,body.clipId+'-'+body.sha256+'-'+body.reason,'report',{...body,firstSeen:new Date().toISOString()});}
   else await tx.setAlarm(Date.now()+2000);return json({saved:true});
  });
 }
 async alarm(){
  const s=this.ctx.storage,today=new Date().toISOString().slice(0,10);
  for(const prefix of ['rate:','seen:']){let cursor;do{const rows=await s.list({prefix,limit:500,...(cursor?{startAfter:cursor}:{})});if(!rows.size)break;cursor=[...rows.keys()].at(-1);for(const key of rows.keys())if(!key.startsWith(prefix+today+':'))await s.delete(key);}while(cursor);}
  await deliverNext(s,this.env);
 }
}
export default{async fetch(request,env){
 const origin=request.headers.get('Origin');const admin=['/admin/reports','/admin/support','/admin/notifications'].includes(new URL(request.url).pathname);
 if(!admin&&!origins.has(origin))return json({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}});
 const response=await env.REPORTS.getByName('inbox').fetch(request);const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');if(origins.has(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}return new Response(response.body,{status:response.status,headers});
}};

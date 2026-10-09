import bundled from './templates.unapproved.json' with { type: 'json' };
// Delivery is fail-closed: both activation and an exact approved template are required.
const escapeHtml=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function brandedHtml(text){
 const paragraphs=text.split(/\n\n+/).map(paragraph=>{
  const parts=paragraph.split(/(https:\/\/[^\s<>"']+)/g);
  return '<p style="margin:0 0 20px;line-height:1.65">'+parts.map(part=>part.startsWith('https://')?'<a style="color:#28588a;text-decoration:underline" href="'+escapeHtml(part)+'">'+escapeHtml(part)+'</a>':escapeHtml(part).replaceAll('\n','<br>')).join('')+'</p>';
 }).join('');
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3eee3;color:#24231e"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 16px"><table role="presentation" width="560" style="width:100%;max-width:560px;background:#fbf8f1;border:1px solid #e1d8c7;border-radius:12px"><tr><td style="padding:32px;font-family:Arial,sans-serif;font-size:16px"><div style="font-family:Georgia,serif;font-size:28px;margin-bottom:28px">Minimal<span style="color:#b7442b;font-style:italic">Pairs</span><span style="font-family:Georgia,serif;font-size:13px;color:#777;white-space:nowrap;margin-left:10px">/ˈmɪnɪməl pɛəz/</span></div>'+paragraphs+'</td></tr></table></td></tr></table></body></html>';
}
export function approvedTemplates(env){
 // A short exact-content approval avoids large secrets; no fuzzy/version-only approval.
 if(typeof env.APPROVED_TEMPLATE_SHA256!=='string'||env.APPROVED_TEMPLATE_SHA256!==bundled.sourceSha256)return {};
 return Object.fromEntries(Object.entries(bundled.templates).map(([key,value])=>[key,{...value,approved:true}]));
}
export async function enqueue(tx,{id,subscriberKey,templateId,kind='course',dueAt=Date.now()}){
 if(typeof id!=='string'||typeof templateId!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(templateId)||!Number.isSafeInteger(dueAt)||dueAt<0||typeof subscriberKey!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(id)||!['confirmation','course','weekly','neutral'].includes(kind)||!subscriberKey.startsWith('subscriber:'))throw Error('Invalid job');
 const key='outbox:'+id;if(await tx.get(key))return false;
 if((await tx.list({prefix:'outbox:',limit:5000})).size>=5000)throw Error('Outbox full');
 await tx.put(key,{id,subscriberKey,templateId,kind,dueAt,state:'queued',attempts:0});return true;
}
export async function deliverOne(storage,env,{now=Date.now(),fetcher=fetch,testTemplates}={}){
 if(env.SENDING_ENABLED!=='true'||!env.RESEND_API_KEY||!env.FROM_ADDRESS)return {state:'disabled'};
 const templates=testTemplates??approvedTemplates(env);
 const day=new Date(now).toISOString().slice(0,10),cap=Math.min(50,Math.max(0,Number(env.DAILY_SEND_CAP)||0));
 const job=await storage.transaction(async tx=>{
  let quota=await tx.get('sendQuota');if(quota?.day!==day)quota={day,count:0};if(quota.count>=cap)return null;
  for(const [key,j] of await tx.list({prefix:'outbox:',limit:5000})){
   if(j.state!=='queued'||j.dueAt>now)continue;
   const r=await tx.get(j.subscriberKey);const t=templates[j.templateId+':'+r?.language]||templates[j.templateId];
   if(!r||r.status==='suppressed'){j.state='suppressed';await tx.put(key,j);continue;}
   if(!t||typeof t.subject!=='string'||typeof t.text!=='string'||t.approved!==true)continue;
   if(j.kind==='confirmation'){j.state='ineligible';await tx.put(key,j);continue;}
   if(j.kind==='confirmation'?r.status!=='pending-verification'||Date.parse(r.verificationExpiresAt)<now:!['subscribed','verified'].includes(r.status)||!(j.kind==='weekly'?r.weekly:r.course)){j.state='ineligible';await tx.put(key,j);continue;}
   // Only neutral lessons may be queued: no purchase-dependent upsell without fresh billing evidence.
   if(t.promotional===true)continue;
   if(j.kind==='confirmation'?!t.text.includes('{{confirmation_url}}'):!t.text.includes('{{unsubscribe_url}}'))continue;
   if(j.kind!=='confirmation'&&(!env.POSTAL_ADDRESS||env.POSTAL_ADDRESS.trim().length<5))continue;
   if(j.kind!=='confirmation'&&r.lastMarketingAt&&now-r.lastMarketingAt<48*3600000)continue;
   if(j.kind==='weekly'){
    if(r.lastWeeklyAt!==undefined&&now-r.lastWeeklyAt<7*86400000)continue;
    const pendingCourse=[...(await tx.list({prefix:'outbox:',limit:5000})).values()].some(other=>other.subscriberKey===j.subscriberKey&&other.kind==='course'&&['queued','sending','uncertain'].includes(other.state));
    if(r.course&&pendingCourse)continue;
   }
   // Reserve budget BEFORE network, including ambiguous outcomes; never exceed the hard free-tier ceiling.
   quota.count++;await tx.put('sendQuota',quota);
   // Reserve recipient spacing atomically with the job, including uncertain outcomes.
   if(j.kind!=='confirmation'){r.lastMarketingAt=now;if(j.kind==='weekly')r.lastWeeklyAt=now;await tx.put(j.subscriberKey,r);}
   j.state='sending';j.attempts++;j.attemptedAt=now;await tx.put(key,j);return {key,j,r,t};
  }
  return null;
 });
 if(!job)return {state:'idle'};
 const {key,j,r,t}=job;const base=env.PUBLIC_ORIGIN;if(!/^https:\/\/[^/]+$/.test(base||''))return mark('blocked');
 const link=j.kind==='confirmation'?`${base}/confirm#${r.verificationToken}`:`${base}/unsubscribe/confirm#${r.unsubscribeToken}`;
 const text=t.text.replaceAll('{{confirmation_url}}',link).replaceAll('{{unsubscribe_url}}',link).replaceAll('{{language}}',r.language).replaceAll('{{postal_address}}',env.POSTAL_ADDRESS||'');
 // Recheck suppression immediately before crossing the network boundary.
 if((await storage.get(j.subscriberKey))?.status==='suppressed')return mark('suppressed');
 try{
  const res=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'minimalpairs-email-course:'+j.id},body:JSON.stringify({from:env.FROM_ADDRESS,to:[r.email],subject:t.subject,text,html:brandedHtml(text)})});
  if(!res.ok)return mark(res.status>=500?'uncertain':'failed');
  const data=await res.json();if(typeof data?.id!=='string'||! /^[a-zA-Z0-9_-]{1,200}$/.test(data.id))return mark('uncertain');await storage.transaction(async tx=>{const saved=await tx.get(key);saved.state='accepted';saved.providerId=data.id;await tx.put(key,saved);await tx.put('provider:'+data.id,j.subscriberKey);const current=await tx.get(j.subscriberKey);if(current&&j.kind!=='confirmation'){current.lastMarketingAt=now;await tx.put(j.subscriberKey,current);}});return {state:'accepted'};
 }catch{return mark('uncertain');}
 async function mark(state){await storage.transaction(async tx=>{const saved=await tx.get(key);saved.state=state;await tx.put(key,saved);});return {state};}
}
// Invoked only after native Svix signature verification or authenticated operator action.
export async function suppressProviderEvent(storage,event){
 if(!event||!['bounce','complaint'].includes(event.type)||typeof event.providerId!=='string'||event.providerId.length>200)throw Error('Invalid event');
 return storage.transaction(async tx=>{const key=await tx.get('provider:'+event.providerId);const row=key&&await tx.get(key);if(!row)return false;if(row.status!=='suppressed'){row.status='suppressed';row.course=false;row.weekly=false;row.audit.push({event:event.type,at:new Date().toISOString()});await tx.put(key,row);}return true;});
}
export async function verifyProviderWebhook(raw,headers,secret,now=Date.now()){
 const id=headers.get('svix-id'),timestamp=headers.get('svix-timestamp'),signatures=headers.get('svix-signature');
 if(!id||!timestamp||!/^\d+$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||!signatures||!secret?.startsWith('whsec_'))return false;
 try{const bytes=Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0));const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['verify']);
 for(const item of signatures.split(' ')){const [version,sig]=item.split(',');if(version!=='v1'||!sig)continue;const signature=Uint8Array.from(atob(sig),c=>c.charCodeAt(0));if(await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(`${id}.${timestamp}.${raw}`)))return true;}
 }catch{}return false;
}

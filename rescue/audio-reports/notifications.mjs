// Owner-only notifications. The public form cannot choose a delivery address.
export const OWNER_EMAIL = 'sirmichealbingham@gmail.com';
const PREFIX = 'notification:';
const DAY = 86400000;
export const notificationsEnabled = env => env.NOTIFICATIONS_ENABLED === 'true' && Boolean(env.RESEND_API_KEY) && env.NOTIFY_TO === OWNER_EMAIL && /^[^\s<>]+@[^\s<>]+$/.test(env.NOTIFY_FROM || '');
export async function queueNotification(storage, id, kind, record) {
  const key = PREFIX + id;
  if (await storage.get(key)) return;
  await storage.put(key, {id, kind, record, state:'pending', attempts:0, nextAttemptAt:Date.now()});
  await storage.setAlarm(Date.now()+2000);
}
export function emailPayload(job, env) {
  const r=job.record;
  const text=job.kind==='support'
    ? `A customer submitted a MinimalPairs support request.\n\nReference: ${r.ticketId}\nTopic: ${r.topic}\nEmail: ${r.email}\nReceived: ${r.createdAt}\n\nCustomer message:\n${r.message}\n\nReply to this email to respond to the customer.`
    : `A MinimalPairs recording was reported.\n\nLanguage: ${r.languageId}\nIssue: ${r.reason}\nVoice: ${r.voiceId}\nClip: ${r.clipId}\nFile version: ${r.sha256}\nReceived: ${r.firstSeen}\n\nThe report is saved in the private audio review inbox. This notification does not reject or delete the recording.`;
  return {from:`MinimalPairs Support <${env.NOTIFY_FROM}>`,to:[OWNER_EMAIL],subject:job.kind==='support'?`MinimalPairs support: ${r.topic}`:`MinimalPairs audio report: ${r.languageId} / ${r.reason}`,text,...(job.kind==='support'?{reply_to:r.email}:{})};
}
export async function notificationStatus(storage, env) {
  const counts={pending:0,sent:0,held:0};
  for(const item of (await storage.list({prefix:PREFIX,limit:20000})).values()) counts[item.state]=(counts[item.state]||0)+1;
  return {enabled:notificationsEnabled(env),...counts};
}
export async function deliverNext(storage,env,{fetchImpl=fetch,now=Date.now()}={}) {
  if(!notificationsEnabled(env)) return;
  // Freeze payload before sending; retries keep the same idempotency key/body.
  const claimed=await storage.transaction(async tx=>{
    const jobs=[...(await tx.list({prefix:PREFIX,limit:20000})).entries()].filter(([,j])=>j.state==='pending').sort((a,b)=>a[1].nextAttemptAt-b[1].nextAttemptAt);
    if(!jobs.length)return null;
    const [key,job]=jobs[0];
    if(job.nextAttemptAt>now){await tx.setAlarm(job.nextAttemptAt);return null;}
    // Resend retains idempotency keys for 24h. Stop uncertain retries before expiry.
    if(job.firstAttemptAt&&now-job.firstAttemptAt>=22*3600000){await tx.put(key,{...job,state:'held',error:'delivery_needs_review'});await tx.setAlarm(now+3000);return null;}
    const date=new Date(now).toISOString(),day=date.slice(0,10),month=date.slice(0,7);
    const budget=await tx.get('notificationBudget')||{};
    const daily=budget.day===day?budget.daily:0,monthly=budget.month===month?budget.monthly:0;
    if(daily>=80||monthly>=2400){const next=monthly>=2400?Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),1):Date.parse(day)+DAY;await tx.setAlarm(next+1000);return null;}
    const updated={...job,firstAttemptAt:job.firstAttemptAt||now,attempts:job.attempts+1,payload:job.payload||emailPayload(job,env),nextAttemptAt:now+60000};
    await tx.put(key,updated);await tx.put('notificationBudget',{day,month,daily:daily+1,monthly:monthly+1});await tx.setAlarm(now+60000);
    return {key,job:updated};
  });
  if(!claimed)return;
  const {key,job}=claimed;let result;
  try{
    const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`minimalpairs-${job.id}`},body:JSON.stringify(job.payload),signal:AbortSignal.timeout(15000)});
    if(response.ok){const data=await response.json();if(typeof data.id!=='string')throw Error('missing_id');result={...job,state:'sent',providerId:data.id,sentAt:new Date(now).toISOString()};}
    else{await response.body?.cancel();result={...job,state:response.status===429||response.status>=500?'pending':'held',error:`provider_http_${response.status}`,nextAttemptAt:now+Math.min(3600000,60000*2**Math.min(job.attempts,6))};}
  }catch{result={...job,state:'pending',error:'delivery_unconfirmed',nextAttemptAt:now+Math.min(3600000,60000*2**Math.min(job.attempts,6))};}
  await storage.put(key,result);
  const pending=[...(await storage.list({prefix:PREFIX,limit:20000})).values()].filter(j=>j.state==='pending');
  await storage.setAlarm(pending.length?Math.max(now+3000,Math.min(...pending.map(j=>j.nextAttemptAt))):now+DAY);
}

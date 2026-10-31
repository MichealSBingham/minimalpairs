import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {brandedHtml} from '../../email-course-service/delivery.mjs';
const root=new URL('./',import.meta.url),file=new URL('../private/phase2-placement-receipts.json',root);
const messages=JSON.parse(fs.readFileSync(new URL('placement-pitches.json',root)));
const id=process.argv[2];if(!['N01','O05'].includes(id))throw Error('Only verified publisher email routes enabled');
const m=messages.find(x=>x.id===id);if(!m?.approved)throw Error('Exact message not approved');
const to=id==='N01'?'team@coffeebreaklanguages.com':'laura@lawlessfrench.com';const rows=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};if(rows[id])throw Error('Receipt exists; reconcile instead of resending');
const secrets=JSON.parse(fs.readFileSync(new URL('../../email-course-service/private/service-secrets.json',root)));
const sr=await fetch('https://minimalpairs-email-course.sirmichealbingham.workers.dev/admin/subscribers',{headers:{Authorization:'Bearer '+secrets.ADMIN_TOKEN}});if(!sr.ok)throw Error('Suppression check unavailable');const subs=await sr.json();if(subs.subscribers.some(x=>x.email?.toLowerCase()===to&&x.status==='suppressed'))throw Error('Suppressed recipient');
const payload={from:'Micheal at MinimalPairs <micheal@minimalpairs.co>',reply_to:'micheal@minimalpairs.co',to:[to],subject:m.subject,text:m.body,html:brandedHtml(m.body)};
const sha=createHash('sha256').update(JSON.stringify(payload)).digest('hex');const idem='mp-phase2-'+id+'-'+sha.slice(0,24);
const save=()=>fs.writeFileSync(file,JSON.stringify(rows,null,2)+'\n',{mode:0o600});
rows[id]={status:'sending',to,subject:m.subject,sha256:sha,idempotencyKey:idem,attemptedAt:new Date().toISOString(),preflight:id==='O05'?'Gmail and Zoho search including Spam/Trash empty; no prior local send receipt; course suppression checked. Address published on official Lawless French privacy page.':'No prior local send receipt; Gmail all-folders search empty; observed Zoho inbox no matching thread. Full Zoho search unavailable due Mac lock. Course suppression checked.'};save();
try{const key=fs.readFileSync(new URL('../../audio-reports/private/resend-key',root),'utf8').trim();const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':idem},body:JSON.stringify(payload)});const d=await r.json();rows[id].status=r.ok&&d.id?'accepted':r.status>=500?'uncertain':'failed';rows[id].providerId=d.id;rows[id].httpStatus=r.status;rows[id].updatedAt=new Date().toISOString();save();console.log(JSON.stringify(rows[id]));}catch(e){rows[id].status='uncertain';save();throw Error('Send result uncertain; reconcile provider before retry');}

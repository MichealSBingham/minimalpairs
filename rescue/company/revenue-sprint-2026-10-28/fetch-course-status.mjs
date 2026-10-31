// Read-only aggregate course audit. No addresses or message bodies enter the report.
const origin=process.env.EMAIL_SERVICE_ORIGIN,token=process.env.EMAIL_ADMIN_TOKEN;
if(!origin||!token)throw Error('Missing secure email-service configuration');
const base=new URL(origin);if(base.protocol!=='https:')throw Error('HTTPS required');
async function read(path){const r=await fetch(new URL(path,base),{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw Error(`Course report unavailable: ${r.status}`);return r.json();}
const [status,data]=await Promise.all([read('/admin/status'),read('/admin/subscribers')]);
const subscribers={total:0,statuses:{},languages:{},course:0,weekly:0,attributionAvailable:0};
for(const row of data.subscribers||[]){subscribers.total++;subscribers.statuses[row.status]=(subscribers.statuses[row.status]||0)+1;subscribers.languages[row.language]=(subscribers.languages[row.language]||0)+1;if(row.course)subscribers.course++;if(row.weekly)subscribers.weekly++;if(row.attribution)subscribers.attributionAvailable++;}
const actions=[];
if(!status.intakeEnabled)actions.push('Course signup is disabled; inspect intended configuration');
if(!status.sendingEnabled)actions.push('Course delivery is disabled; inspect intended configuration');
for(const [state,count] of Object.entries(status.outbox||{}))if(count&&['failed','uncertain'].includes(state))actions.push(`Reconcile ${count} ${state} course sends before retrying`);
if(status.weekly?.exhausted)actions.push(`${status.weekly.exhausted} subscribers exhausted approved weekly material; prepare the next draft for approval`);
for(const [state,count] of Object.entries(status.buyers?.states||{}))if(count&&['failed','uncertain'].includes(state))actions.push(`Reconcile ${count} ${state} buyer follow-ups before retrying`);
if(status.buyers?.collector?.state==='error')actions.push('Buyer follow-up collector reports an error; investigate before sending');
const checked=status.buyers?.collector?.checkedAt;
if(checked&&Date.now()-Number(checked)>3*60*60*1000)actions.push('Buyer follow-up collector is older than three hours; investigate cloud alarm');
console.log(JSON.stringify({checkedAt:new Date().toISOString(),status:{intakeEnabled:status.intakeEnabled,sendingEnabled:status.sendingEnabled,outbox:status.outbox,buyers:status.buyers,weekly:status.weekly},subscribers,actions}));

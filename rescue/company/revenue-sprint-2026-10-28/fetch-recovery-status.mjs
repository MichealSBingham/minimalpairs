// Read-only owner report. Supply the existing admin token via environment, never command arguments.
const origin=process.env.EMAIL_SERVICE_ORIGIN,token=process.env.EMAIL_ADMIN_TOKEN;
if(!origin||!token)throw Error('Set EMAIL_SERVICE_ORIGIN and EMAIL_ADMIN_TOKEN in the local secure environment.');
const endpoint=new URL('/admin/status',origin);if(endpoint.protocol!=='https:')throw Error('HTTPS required');
const r=await fetch(endpoint,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Admin status unavailable: '+r.status);
const data=await r.json();if(!data.recoveryExperiment)throw Error('Experiment reporting not deployed yet');
process.stdout.write(JSON.stringify(data.recoveryExperiment,null,2)+'\n');

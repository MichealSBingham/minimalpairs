import test from 'node:test';import assert from 'node:assert/strict';
import {queueNotification,deliverNext,notificationStatus,OWNER_EMAIL} from './notifications.mjs';
import {ReportInbox,validSupport} from './worker.mjs';
const env={NOTIFICATIONS_ENABLED:'true',RESEND_API_KEY:'fixture-only',NOTIFY_TO:OWNER_EMAIL,NOTIFY_FROM:'support@minimalpairs.co'};
function store(){const map=new Map();let alarm;const s={get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v)),delete:async k=>map.delete(k),list:async({prefix})=>new Map([...map].filter(([k])=>k.startsWith(prefix))),transaction:async f=>f(s),setAlarm:async n=>{alarm=n;}};return {s,map,get alarm(){return alarm;}};}
const ticket={ticketId:'test-ticket',email:'customer@example.com',topic:'account',message:'Please help with access',createdAt:new Date().toISOString()};
test('support saves durable notification once, never delivers in request, and rejects header injection',async()=>{
 const {s,map}=store(),inbox=new ReportInbox({storage:s},{...env,ADMIN_TOKEN:'fixture'});
 const data={...ticket,requestId:crypto.randomUUID()};delete data.ticketId;delete data.createdAt;
 for(let i=0;i<2;i++){const response=await inbox.fetch(new Request('https://local/support',{method:'POST',body:JSON.stringify(data)}));assert.equal(response.status,200);}
 assert.equal([...map.keys()].filter(k=>k.startsWith('notification:')).length,1);
 assert.equal(validSupport({...data,email:'a@example.com,b@other.com'}),false);
 assert.equal((await inbox.fetch(new Request('https://local/admin/notifications'))).status,401);
});
test('disabled or wrong-recipient configuration cannot send',async()=>{
 const {s}=store();await queueNotification(s,'test','support',ticket);
 for(const config of [{...env,NOTIFICATIONS_ENABLED:'false'},{...env,RESEND_API_KEY:''},{...env,NOTIFY_TO:'other@example.com'}])await deliverNext(s,config,{fetchImpl:()=>assert.fail('must not send')});
 assert.equal((await notificationStatus(s,env)).pending,1);
});
test('delivery is owner-only, reply-to customer, and retries do not duplicate accepted jobs',async()=>{
 const {s,map}=store();await queueNotification(s,'test','support',ticket);let calls=0;
 const send=async(url,options)=>{calls++;assert.equal(url,'https://api.resend.com/emails');const payload=JSON.parse(options.body);assert.deepEqual(payload.to,[OWNER_EMAIL]);assert.equal(payload.reply_to,ticket.email);assert.equal(payload.html,undefined);assert.equal(options.headers['Idempotency-Key'],'minimalpairs-test');return Response.json({id:'provider-1'});};
 await deliverNext(s,env,{fetchImpl:send});await deliverNext(s,env,{fetchImpl:send});await queueNotification(s,'test','support',ticket);assert.equal(calls,1);assert.equal(map.get('notification:test').state,'sent');
});
test('uncertain delivery retries same payload/key and holds before provider idempotency expiry',async()=>{
 const {s,map}=store();await queueNotification(s,'test','support',ticket);const now=Date.now();let payload,key;
 await deliverNext(s,env,{now,fetchImpl:async(u,o)=>{payload=o.body;key=o.headers['Idempotency-Key'];throw Error('network');}});
 assert.equal(map.get('notification:test').state,'pending');
 await deliverNext(s,{...env,NOTIFY_FROM:'changed@minimalpairs.co'},{now:now+180000,fetchImpl:async(u,o)=>{assert.equal(o.body,payload);assert.equal(o.headers['Idempotency-Key'],key);return new Response('',{status:503});}});
 await deliverNext(s,env,{now:now+23*3600000,fetchImpl:()=>assert.fail('cannot resend after expiry')});assert.equal(map.get('notification:test').state,'held');
});
test('free-tier budget caps attempts without discarding support and hard failure is held',async()=>{
 const {s,map}=store();await queueNotification(s,'test','support',ticket);const now=Date.now(),date=new Date(now).toISOString();
 await s.put('notificationBudget',{day:date.slice(0,10),month:date.slice(0,7),daily:80,monthly:80});await deliverNext(s,env,{now,fetchImpl:()=>assert.fail('daily cap')});assert.equal(map.get('notification:test').attempts,0);
 await s.put('notificationBudget',{});await deliverNext(s,env,{now,fetchImpl:async()=>new Response('',{status:403})});assert.equal(map.get('notification:test').state,'held');
});

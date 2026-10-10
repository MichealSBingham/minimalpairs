import test from 'node:test';
import assert from 'node:assert/strict';
import {validAggregate,aggregateRequest,pruneUsage} from './aggregate.mjs';
const payload={event:'practice_complete',language:'fr',contrast:'fr-u-y',rounds:12};
test('rejects identifiers, arbitrary dimensions and malformed counters',()=>{
 assert.ok(validAggregate(payload));
 for(const bad of [{...payload,email:'x@y.co'},{...payload,attempt_id:'123'},{...payload,rounds:999},{...payload,contrast:'/path?secret'},{...payload,event:'purchase'},{...payload,language:'unknown'},{...payload,event:'page_view'}])assert.ok(!validAggregate(bad));
});
test('stores only daily counters, protects reads and expires old totals',async()=>{
 const map=new Map();const s={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),transaction:async f=>f(s),setAlarm:async()=>{},list:async({prefix})=>new Map([...map].filter(([k])=>k.startsWith(prefix))),delete:async k=>map.delete(k)};
 for(let i=0;i<2;i++)assert.equal((await aggregateRequest(new Request('https://local/usage',{method:'POST',body:JSON.stringify(payload)}),s,'secret')).status,204);
 assert.deepEqual([...map.values()][0],{'practice_complete|fr|fr-u-y':{events:2,rounds:24}});
 assert.equal((await aggregateRequest(new Request('https://local/admin/usage'),s,'secret')).status,401);
 const read=await aggregateRequest(new Request('https://local/admin/usage',{headers:{Authorization:'Bearer secret'}}),s,'secret');assert.equal(read.status,200);
 map.set('usage:2000-01-01',{});await pruneUsage(s);assert.equal(map.size,1);
});
test('usage traffic does not postpone pending support notification alarms',async()=>{
 const scheduled=[]; const s={get:async()=>undefined,put:async()=>{},transaction:async f=>f(s),getAlarm:async()=>Date.now()+1000,setAlarm:async t=>scheduled.push(t)};
 await aggregateRequest(new Request('https://local/usage',{method:'POST',body:JSON.stringify(payload)}),s,'secret');
 assert.deepEqual(scheduled,[]);
});
test('daily visitors deduplicate page views without storing raw request data',async()=>{
 const map=new Map(),s={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),transaction:async f=>f(s),setAlarm:async()=>{},list:async({prefix})=>new Map([...map].filter(([k])=>k.startsWith(prefix))),delete:async k=>map.delete(k)};
 const req=(ip)=>new Request('https://local/usage',{method:'POST',headers:{'CF-Connecting-IP':ip,'User-Agent':'test-browser'},body:JSON.stringify({event:'page_view',language:'none',contrast:'none',rounds:0})});
 for(const ip of ['192.0.2.1','192.0.2.1','192.0.2.2'])await aggregateRequest(req(ip),s,'token');
 const total=map.get('visitors:'+new Date().toISOString().slice(0,10));assert.equal(total.estimatedVisitors,2);assert.equal(total.measuredPageviews,3);
 assert.ok(!JSON.stringify([...map]).includes('192.0.2'));assert.ok(!JSON.stringify([...map]).includes('test-browser'));
 map.set('dailySalt:2000-01-01','old');map.set('dailySeen:2000-01-01:abc',true);await pruneUsage(s);
 assert.ok(!map.has('dailySalt:2000-01-01'));assert.ok(!map.has('dailySeen:2000-01-01:abc'));
});

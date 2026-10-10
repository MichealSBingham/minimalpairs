import test from 'node:test';import assert from 'node:assert/strict';import {productAnalytics} from './product-analytics.mjs';
const now=Date.parse('2026-10-10T12:00:00Z'),env={ADMIN_TOKEN:'admin',REPORTING_TOKEN:'review-secret'};
function setup(){const map=new Map();const s={get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v)),delete:async k=>map.delete(k),transaction:async f=>f(s),getAlarm:async()=>0,setAlarm:async()=>{},list:async({prefix,startAfter,limit=10000})=>new Map([...map].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit))};return {map,s};}
const event=(event,extra={})=>new Request('https://local/events',{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.9','User-Agent':'Mozilla/5.0 browser'},body:JSON.stringify({event,id:crypto.randomUUID(),path:'/practice',source:'google',medium:'organic',ui_locale:'en',language:'fr',contrast:'fr-u-y',...extra})});
const purchase=(journey,extra={})=>new Request('https://local/internal/purchase',{method:'POST',headers:{Authorization:'Bearer review-secret'},body:JSON.stringify({purchaseId:'cs_live_review',amount:2900,currency:'usd',created:now/1000,metadata:{mp_journey:journey,mp_source:'google',mp_medium:'organic',mp_ui_locale:'en',mp_language:'fr',mp_contrast:'fr-u-y',mp_session_kind:'focused',...extra}})});
test('purchase language reflects checkout snapshot, not activity after checkout',async()=>{
 const {s,map}=setup();const {journey}=await(await productAnalytics(event('begin_checkout'),s,env,now)).json();
 await productAnalytics(event('practice_start',{language:'de',contrast:'de-u-ue',kind:'mixed'}),s,env,now+1000);
 await productAnalytics(purchase(journey),s,env,now+2000);const row=[...map].find(([k])=>k.startsWith('productPurchase:'))[1];
 assert.equal(row.language,'fr');assert.equal(row.contrast,'fr-u-y');assert.equal(row.sessionKind,'focused');
});
test('valid checkout attribution is not masked by unknown first event context',async()=>{
 const {s,map}=setup();const {journey}=await(await productAnalytics(event('page_view',{source:'unknown',medium:'none',language:'none',contrast:'none'}),s,env,now)).json();
 await productAnalytics(purchase(journey),s,env,now);const row=[...map].find(([k])=>k.startsWith('productPurchase:'))[1];assert.equal(row.source,'google');
});
test('unverified journey token cannot link a purchase to a visitor',async()=>{
 const {s,map}=setup();const {journey}=await(await productAnalytics(event('begin_checkout'),s,env,now)).json();
 await productAnalytics(purchase(journey.slice(0,-1)+(journey.endsWith('0')?'1':'0')),s,env,now);const row=[...map].find(([k])=>k.startsWith('productPurchase:'))[1];assert.equal(row.joined,false);assert.equal(map.get('productDay:2026-10-10').funnel.purchased,0);
});
test('purchase deduplication remains intact when metadata changes during reconciliation',async()=>{
 const {s,map}=setup();await productAnalytics(purchase(undefined),s,env,now);await productAnalytics(purchase(undefined,{mp_source:'reddit'}),s,env,now+1000);assert.equal(map.get('productDay:2026-10-10').purchases,1);assert.equal(map.get('productDay:2026-10-10').grossMinor.usd,2900);
});
test('arrival reordering preserves correctly ordered client milestones',async()=>{
 const {s,map}=setup();for(const [name,offset] of [['practice_complete',2000],['practice_first_answer',1000],['practice_start',0]])await productAnalytics(event(name,{occurredAt:now+offset}),s,env,now+3000);
 const f=map.get('productDay:2026-10-10').funnel;assert.equal(f.practiceStarted,1);assert.equal(f.answered,1);assert.equal(f.completed,1);
});
test('purchase arriving before checkout event joins once when delayed checkout arrives',async()=>{
 const {s,map}=setup();const {journey}=await(await productAnalytics(event('page_view'),s,env,now)).json();await productAnalytics(purchase(journey),s,env,now+1000);
 await productAnalytics(event('begin_checkout',{occurredAt:now}),s,env,now+2000);await productAnalytics(event('plans_view'),s,env,now+3000);
 assert.equal(map.get('productDay:2026-10-10').funnel.purchased,1);
});
test('joined purchase is not counted again on later browsing events',async()=>{
 const {s,map}=setup();const {journey}=await(await productAnalytics(event('begin_checkout'),s,env,now)).json();await productAnalytics(purchase(journey),s,env,now+1000);await productAnalytics(event('page_view'),s,env,now+2000);assert.equal(map.get('productDay:2026-10-10').funnel.purchased,1);
});
test('incomplete unsaved attempts expose answer count and language in authenticated report',async()=>{
 const {s}=setup(),attempt=crypto.randomUUID();await productAnalytics(event('practice_start',{attempt}),s,env,now);await productAnalytics(event('practice_answer',{attempt,round:0,correct:0}),s,env,now+1000);
 const r=await productAnalytics(new Request('https://local/admin/analytics',{headers:{Authorization:'Bearer admin'}}),s,env,now+31*60000);const report=await r.json();assert.deepEqual(report.attemptSummary['2026-10-10|fr|fr-u-y'],{attempts:1,answeredRounds:1,completed:0,exited:0,inactiveIncomplete:1});assert.ok(!JSON.stringify(report).includes('192.0.2.9'));
});

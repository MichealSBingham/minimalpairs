import test from 'node:test';
import assert from 'node:assert/strict';
import {productAnalytics,cleanEvent,pruneProductAnalytics} from './product-analytics.mjs';
function setup(){const map=new Map();const s={get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v)),delete:async k=>map.delete(k),transaction:async f=>f(s),getAlarm:async()=>0,setAlarm:async()=>{},list:async({prefix,startAfter,limit=10000})=>new Map([...map].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit))};return {s,map};}
const env={ADMIN_TOKEN:'admin',REPORTING_TOKEN:'test-only-secret'},now=Date.parse('2026-10-10T12:00:00Z');
const event=(name,extra={})=>({event:name,id:crypto.randomUUID(),path:'/learn/fr-u-y',source:'google',medium:'organic',ui_locale:'en',language:'fr',contrast:'fr-u-y',...extra});
const request=x=>new Request('https://local/events',{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.1','User-Agent':'Mozilla test browser'},body:JSON.stringify(x)});
const paid=(journey,id='cs_live_example')=>new Request('https://local/internal/purchase',{method:'POST',headers:{Authorization:'Bearer test-only-secret'},body:JSON.stringify({purchaseId:id,amount:2900,currency:'usd',created:Math.floor(now/1000),metadata:{mp_journey:journey,mp_source:'google',mp_medium:'organic',mp_ui_locale:'en',mp_language:'fr'}})});
test('visitor to practice, partial answers, checkout and verified purchase join without browser cookies',async()=>{
 const {s,map}=setup();let token;
 for(const name of ['page_view','practice_start','practice_first_answer','practice_answer','practice_exit','begin_checkout']){const r=await productAnalytics(request(event(name,{attempt:'00000000-0000-4000-8000-000000000001',correct:1,round:0})),s,env,now);token=(await r.json()).journey;}
 const d=map.get('productDay:2026-10-10');assert.equal(d.funnel.visitors,1);assert.equal(d.funnel.completed,0);assert.equal(d.events.practice_exit,1);assert.equal(d.languages['answered_rounds|fr|fr-u-y'],1);
 assert.equal((await productAnalytics(paid(token),s,env,now)).status,200);await productAnalytics(paid(token),s,env,now);
 const after=map.get('productDay:2026-10-10');assert.equal(after.purchases,1);assert.equal(after.funnel.purchased,1);assert.equal(after.purchaseLanguages.fr,1);assert.equal(after.grossMinor.usd,2900);
 assert.ok(!JSON.stringify([...map]).includes('192.0.2.1'));assert.ok(!JSON.stringify([...map]).includes('Mozilla test browser'));
});
test('duplicate events and unauthorized or browser-forged payments cannot inflate counts',async()=>{
 const {s,map}=setup(),e=event('page_view');await productAnalytics(request(e),s,env,now);await productAnalytics(request(e),s,env,now);assert.equal(map.get('productDay:2026-10-10').events.page_view,1);
 const bad=new Request('https://local/internal/purchase',{method:'POST',body:'{}'});assert.equal((await productAnalytics(bad,s,env,now)).status,401);
 assert.equal(cleanEvent({...e,email:'private@example.com'}),null);assert.equal(cleanEvent({...e,event:'purchase'}),null);
});
test('unknown historical purchases remain unattributed and repeat polls are idempotent',async()=>{
 const {s,map}=setup();const p=()=>new Request('https://local/internal/purchase',{method:'POST',headers:{Authorization:'Bearer test-only-secret'},body:JSON.stringify({purchaseId:'cs_live_old',created:Math.floor(now/1000),amount:2900,currency:'usd',metadata:{}})});await productAnalytics(p(),s,env,now);await productAnalytics(p(),s,env,now);assert.equal(map.get('productDay:2026-10-10').purchaseSources.unattributed,1);
});
test('daily rollover does not create a persistent visitor ID; old journeys are deleted',async()=>{
 const {s,map}=setup();const a=await (await productAnalytics(request(event('page_view')),s,env,now)).json(),b=await (await productAnalytics(request(event('page_view')),s,env,now+86400000)).json();assert.notEqual(a.journey,b.journey);await pruneProductAnalytics(s,now+4*86400000);assert.equal([...map.keys()].filter(k=>k.startsWith('productJourney:')).length,0);assert.ok(map.has('productDay:2026-10-10'));
});
test('known automated traffic is excluded and aggregate report is private',async()=>{const {s,map}=setup();const req=request(event('page_view'));req.headers.set('User-Agent','Googlebot');assert.equal((await productAnalytics(req,s,env,now)).status,204);assert.equal(map.size,0);assert.equal((await productAnalytics(new Request('https://local/admin/analytics'),s,env,now)).status,401);});
test('approved checkout context queues one real revenue event and expires from journeys',async()=>{
 const {s,map}=setup(),enabled={...env,PLAUSIBLE_ENABLED:'true'};
 const {journey}=await (await productAnalytics(request(event('checkout_context')),s,enabled,now)).json();
 assert.ok(!JSON.stringify([...map]).includes('192.0.2.1'));
 const req=paid(journey);const body=await req.json();body.plan='lifetime';
 const purchase=()=>new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(body)});
 await productAnalytics(purchase(),s,enabled,now);await productAnalytics(purchase(),s,enabled,now);
 const queued=[...map.entries()].filter(([k])=>k.startsWith('plausiblePurchase:'));
 assert.equal(queued.length,1);assert.equal(queued[0][1].state,'queued');
 assert.equal(queued[0][1].payload.name,'Purchase');assert.deepEqual(queued[0][1].payload.revenue,{currency:'USD',amount:29});assert.equal(queued[0][1].payload.props.plan,'lifetime');
 assert.ok(!JSON.stringify(queued[0][1].payload).includes('cs_live_example'));
 await pruneProductAnalytics(s,now+2*86400000+1);
 for(const [k,v] of map)if(k.startsWith('productJourney:'))assert.equal(v.plausibleContext,undefined);
});

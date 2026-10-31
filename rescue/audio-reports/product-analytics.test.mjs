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
test('daily rollover does not create a persistent visitor ID; journeys remain available after four days',async()=>{
 const {s,map}=setup();const a=await (await productAnalytics(request(event('page_view')),s,env,now)).json(),b=await (await productAnalytics(request(event('page_view')),s,env,now+86400000)).json();assert.notEqual(a.journey,b.journey);await pruneProductAnalytics(s,now+4*86400000);assert.equal([...map.keys()].filter(k=>k.startsWith('productJourney:')).length,2);assert.ok(map.has('productDay:2026-10-10'));
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
test('diagnostic length survives navigation and attributes verified purchase, unknown stays unknown',async()=>{
 const {s,map}=setup();let journey;
 for(const e of ['diagnostic_start','diagnostic_complete','diagnostic_offer_click','begin_checkout','checkout_context']){
  const data=event(e,{...(e.startsWith('diagnostic_')?{diagnostic_length:'full',kind:'diagnostic'}:{})});
  const response=await (await productAnalytics(request(data),s,{...env,PLAUSIBLE_ENABLED:'true'},now)).json();journey=response.journey;
  assert.equal(response.diagnostic_length,'full');
 }
 await productAnalytics(paid(journey),s,{...env,PLAUSIBLE_ENABLED:'true'},now);
 const day=map.get('productDay:2026-10-10');assert.equal(day.diagnostics.full.diagnostic_start,1);assert.equal(day.diagnostics.full.diagnostic_complete,1);assert.equal(day.diagnostics.full.begin_checkout,1);assert.equal(day.diagnostics.full.purchases,1);
 const purchases=[...map].filter(([k])=>k.startsWith('productPurchase:'));assert.equal(purchases[0][1].diagnosticLength,'full');
 const queued=[...map].find(([k])=>k.startsWith('plausiblePurchase:'))[1];assert.equal(queued.payload.props.diagnostic_length,'full');
 assert.equal(cleanEvent(event('diagnostic_start',{diagnostic_length:'invented'})).diagnostic_length,undefined);
});
test('audio failures aggregate by safe category without retaining raw error details',async()=>{
 const {s,map}=setup();
 await productAnalytics(request(event('practice_audio_error',{failure_kind:'blocked'})),s,env,now);
 await productAnalytics(request(event('practice_audio_error')),s,env,now);
 assert.deepEqual(map.get('productDay:2026-10-10').audioFailures,{'fr|fr-u-y|blocked':1,'fr|fr-u-y|unknown':1});
 assert.equal(cleanEvent(event('practice_audio_error',{failure_kind:'private error details'})).failure_kind,undefined);
});
test('experiment exposures count daily visitor estimates once, attempts distinctly and payments from explicit metadata',async()=>{
 const {s,map}=setup(),labels={experiment_id:'diag-paywall-v1',experiment_variant:'paid',offer_placement:'diagnostic-report'};
 for(const name of ['experiment_exposure','experiment_exposure','diagnostic_start','diagnostic_start','plan_selected'])await productAnalytics(request(event(name,{...labels,...(name==='diagnostic_start'?{attempt:'00000000-0000-4000-8000-000000000001'}:{})})),s,env,now);
 const before=map.get('productDay:2026-10-10').experiments['diag-paywall-v1|paid'];
 assert.equal(before.events.experiment_exposure,2);assert.equal(before.visitorEstimates.experiment_exposure,1);assert.equal(before.attempts,1);
 const buy=new Request('https://local/internal/purchase',{method:'POST',headers:{Authorization:'Bearer test-only-secret'},body:JSON.stringify({purchaseId:'cs_live_experiment',created:now/1000,amount:2900,currency:'usd',metadata:{mp_source:'google',mp_medium:'organic',mp_ui_locale:'en',...Object.fromEntries(Object.entries(labels).map(([k,v])=>['mp_'+k,v]))}})});
 await productAnalytics(buy,s,env,now);
 assert.equal(map.get('productDay:2026-10-10').experiments['diag-paywall-v1|paid'].purchases,1);
 const receipt=[...map].find(([k])=>k.startsWith('productPurchase:'))[1];assert.equal(receipt.offer_placement,'diagnostic-report');
 assert.equal(cleanEvent(event('experiment_exposure',{experiment_id:'invalid',experiment_variant:'paid'})).experiment_id,undefined);
});
test('trusted replay repairs missing offer metadata once without duplicate revenue or Plausible',async()=>{
 const {s,map}=setup();await productAnalytics(paid(undefined),s,env,now);
 const replay=variant=>new Request('https://local/internal/purchase',{method:'POST',headers:{Authorization:'Bearer test-only-secret'},body:JSON.stringify({purchaseId:'cs_live_example',created:now/1000,amount:2900,currency:'usd',metadata:{mp_source:'google',mp_medium:'organic',mp_ui_locale:'en',mp_experiment_id:'diag-paywall-v1',mp_experiment_variant:variant,mp_offer_placement:'diagnostic-report'}})});
 assert.equal((await (await productAnalytics(replay('preview'),s,env,now)).json()).metadataRepaired,true);
 assert.equal((await (await productAnalytics(replay('preview'),s,env,now)).json()).metadataRepaired,undefined);
 assert.equal((await productAnalytics(replay('paid'),s,env,now)).status,409);
 const d=map.get('productDay:2026-10-10');assert.equal(d.purchases,1);assert.equal(d.grossMinor.usd,2900);assert.equal(d.experiments['diag-paywall-v1|preview'].purchases,1);assert.equal(d.offers['diagnostic-report'].purchases,1);assert.equal([...map.keys()].filter(k=>k.startsWith('plausiblePurchase:')).length,0);
});
test('journeys survive 30 days; only encrypted checkout context expires at 48h; 90-day cleanup remains',async()=>{
 const {s,map}=setup();await productAnalytics(request(event('checkout_context')),s,{...env,PLAUSIBLE_ENABLED:'true'},now);
 const key=[...map.keys()].find(k=>k.startsWith('productJourney:'));
 await pruneProductAnalytics(s,now+30*86400000);assert.ok(map.has(key));assert.equal(map.get(key).plausibleContext,undefined);
 await pruneProductAnalytics(s,now+91*86400000);assert.equal(map.has(key),false);
});
test('accepted event history preserves order and timing without duplicate events or raw IP',async()=>{
 const {s,map}=setup();const e=event('diagnostic_start',{attempt:'00000000-0000-4000-8000-000000000001',occurredAt:now-1000,diagnostic_length:'full'});
 await productAnalytics(request(e),s,env,now);await productAnalytics(request(e),s,env,now);
 const j=[...map].find(([k])=>k.startsWith('productJourney:'))[1];assert.equal(j.eventHistory.length,1);assert.equal(j.eventHistory[0].occurredAt,now-1000);assert.equal(j.eventHistory[0].diagnostic_length,'full');assert.equal(j.lastSeen,now);assert.ok(!JSON.stringify(j).includes('192.0.2.1'));
});
test('next-step exposures and verified payments retain their separate experiment arms',async()=>{
 const {s,map}=setup();const labels={experiment_id:'diag-next-step-v1',experiment_variant:'personalized',offer_placement:'diagnostic-report'};
 await productAnalytics(request(event('experiment_exposure',{...labels,attempt:'00000000-0000-4000-8000-000000000001'})),s,env,now);
 const req=new Request('https://local/internal/purchase',{method:'POST',headers:{Authorization:'Bearer test-only-secret'},body:JSON.stringify({purchaseId:'cs_live_newarm',created:now/1000,amount:2900,currency:'usd',metadata:{mp_source:'google',mp_medium:'organic',mp_ui_locale:'en',...Object.fromEntries(Object.entries(labels).map(([k,v])=>['mp_'+k,v]))}})});
 await productAnalytics(req,s,env,now);
 const e=map.get('productDay:2026-10-10').experiments['diag-next-step-v1|personalized'];assert.equal(e.attempts,1);assert.equal(e.purchases,1);assert.equal(e.grossMinor.usd,2900);
});
test('regional pricing exposure is deduplicated per browser day and tracks plan clicks',async()=>{
 const {s,map}=setup();for(const name of ['plans_view','plans_view','plan_selected'])await productAnalytics(request(event(name,{market_country:'BR',market_tier:'value',plan:'lifetime'})),s,env,now);
 const m=map.get('productDay:2026-10-10').markets['BR|value'];assert.equal(m.visitorEstimates.plans_view,1);assert.equal(m.events.plans_view,2);assert.equal(m.visitorEstimates.plan_selected,1);
 assert.equal(cleanEvent(event('plans_view',{market_country:'private@email.com',market_tier:'value'})).market_country,undefined);
});
test('private journey lookup requires admin and signed receipt and excludes encrypted context',async()=>{
 const {s,map}=setup();const {journey}=await(await productAnalytics(request(event('page_view')),s,env,now)).json();
 const key=[...map.keys()].find(k=>k.startsWith('productJourney:'));map.get(key).plausibleContext={secret:'excluded'};
 const url='https://local/admin/analytics?journey='+journey;
 assert.equal((await productAnalytics(new Request(url),s,env,now)).status,401);
 assert.equal((await productAnalytics(new Request(url+'x',{headers:{Authorization:'Bearer admin'}}),s,env,now)).status,400);
 const r=await productAnalytics(new Request(url,{headers:{Authorization:'Bearer admin'}}),s,env,now);assert.equal(r.status,200);const d=await r.json();assert.equal(d.journey.source,'google');assert.equal(d.journey.plausibleContext,undefined);assert.equal(d.journey.events,undefined);
});
test('retain first referring domain across internal navigation without raw URL storage',async()=>{
 const {s,map}=setup();await productAnalytics(request(event('page_view',{referrer_host:'example.com'})),s,env,now);
 await productAnalytics(request(event('page_view',{path:'/account',referrer_host:'accounts.google.com'})),s,env,now+1000);
 const j=[...map].find(([k])=>k.startsWith('productJourney:'))[1];assert.equal(j.referrerHost,'example.com');
 assert.equal(cleanEvent(event('page_view',{referrer_host:'example.com/private?q=secret'})).referrer_host,undefined);
});
test('entrance page activity separates repeated events from daily browser estimates',async()=>{
 const {s,map}=setup();for(let i=0;i<2;i++)await productAnalytics(request(event('challenge_start',{path:'/mandarin-chinese-minimal-pairs',language:'zh',contrast:'zh-tone-1-4'})),s,env,now+i);
 const p=map.get('productDay:2026-10-10').entrancePages['/mandarin-chinese-minimal-pairs'];assert.equal(p.events.challenge_start,2);assert.equal(p.visitorEstimates.challenge_start,1);
});
test('first internal arrival retains attribution-gap reason without claiming an external referral',async()=>{
 const {s,map}=setup();await productAnalytics(request(event('page_view',{source:'unknown',medium:'none',referrer_kind:'internal',referrer_host:'accounts.google.com'})),s,env,now);
 const j=[...map].find(([k])=>k.startsWith('productJourney:'))[1];assert.equal(j.source,'unknown');assert.equal(j.medium,'none');assert.equal(j.referrerKind,'internal');assert.equal(j.referrerHost,undefined);
 assert.equal(cleanEvent(event('page_view',{referrer_kind:'private text'})).referrer_kind,undefined);
});

test('educational article is a retained landing page with course signup measurement',async()=>{
 const {s,map}=setup();const path='/resources/read-french-but-cant-understand';await productAnalytics(request(event('page_view',{path})),s,env,now);await productAnalytics(request(event('course_signup',{path,language:'fr'})),s,env,now+1);const j=[...map].find(([k])=>k.startsWith('productJourney:'))[1];assert.equal(j.landing,path);assert.equal(map.get('productDay:2026-10-10').entrancePages[path].events.course_signup,1);
});

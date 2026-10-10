import test from 'node:test';import assert from 'node:assert/strict';
import {plausibleEvents,plausibleProperties} from '../src/lib/plausible-events.mjs';
test('browser events cannot report paid purchases or raw payment context',()=>{assert.equal(plausibleEvents.purchase,undefined);assert.equal(plausibleEvents.checkout_context,undefined);assert.equal(plausibleEvents.begin_checkout,'Checkout started');assert.equal(plausibleEvents.practice_answer,'Answer submitted');});
test('properties preserve useful context and exclude identifiers and words',()=>{assert.deepEqual(plausibleProperties({language_id:'fr',contrast_id:'fr-u-y',round:2,correct:0,email:'learner@example.com',attempt_id:'private',word:'tu',plan:'lifetime',firebaseUid:'private'}),{language:'fr',contrast:'fr-u-y',plan:'lifetime',round:2,correct:0});assert.deepEqual(plausibleProperties({language_id:'private@example.com',total:-1}),{});});
test('repeat offer visibility callbacks send one first-party and Plausible exposure',async()=>{
 const {readFileSync}=await import('node:fs');const ts=(await import('typescript')).default;
 const source=readFileSync(new URL('../src/lib/product-reporting.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const events=[],requests=[],exports={};let excluded=false;
 const location={hostname:'minimalpairs.co',pathname:'/pricing',origin:'https://minimalpairs.co',search:''};
 const imports={'./plausible-reporting':{reportToPlausible:(...args)=>events.push(args)},'./measurement-data':{acquisitionDetails:()=>({channel:'direct'}),measurementPath:x=>x,landingPath:x=>x}};
 new Function('require','exports','window','document','navigator','localStorage','fetch',compiled)(name=>imports[name],exports,{location},{documentElement:{dataset:{measurementEnvironment:'production'},lang:'en'},referrer:''},{webdriver:false},{getItem:()=>String(excluded)},async(...args)=>{requests.push(args);return {ok:true,status:204};});
 await exports.productEvent('plans_view',{surface:'pricing'});await exports.productEvent('plans_view',{surface:'pricing'});
 assert.equal(events.length,1);assert.equal(requests.length,1);
 excluded=true;await exports.productEvent('begin_checkout',{plan:'lifetime'});assert.equal(events.length,1);
});

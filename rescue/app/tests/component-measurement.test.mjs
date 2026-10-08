import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Exercise the actual submit handler with transport and React adapters; never send a request.
function supportFixture(response) {
 const events=[];
 const source=readFileSync(new URL('../src/components/SupportForm.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};
 const imports={
  react:{useRef:value=>({current:value}),useState:value=>[value,()=>{}]},
  'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  '../lib/commerce-i18n':{commerce:()=>key=>key,commercePath:(_locale,path)=>path},
  '../lib/measurement':{trackMeasurement:(event,data)=>events.push({event,data})},
 };
 class FormData {get(key){return {email:'private@example.test',message:'Private support content',topic:'billing'}[key];}}
 new Function('require','exports','fetch','FormData',compiled)(name=>imports[name],exports,async()=>response,FormData);
 return {events,submit:()=>exports.default({locale:'fr'}).props.onSubmit({preventDefault(){},currentTarget:{}})};
}
test('support confirmation measures only topic and surface, never submitted personal data',async()=>{
 const f=supportFixture({ok:true,json:async()=>({saved:true,ticketId:'private-ticket'})});
 await f.submit();
 assert.deepEqual(f.events,[{event:'support_submitted',data:{surface:'support',ui_locale:'fr',topic:'billing'}}]);
});
test('support transport failure does not invent a submitted conversion',async()=>{
 const f=supportFixture({ok:false,status:503,json:async()=>({saved:false})});
 await f.submit();assert.deepEqual(f.events,[]);
});

test('visible offers respect late consent and deduplicate rerenders and visibility callbacks',()=>{
 const source=readFileSync(new URL('../src/components/useMeasuredExposure.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let observer,consentListener,cleanup,permitted=false;
 const events=[],refs=[];let slot=0;
 const node={};
 const exports={};
 const imports={react:{useRef:value=>refs[slot++] ||= {current:value},useEffect:fn=>{cleanup=fn();}},'../lib/measurement':{trackMeasurement:(event,data)=>{if(!permitted)return false;events.push({event,data});return true;},watchAnalyticsChoice:fn=>{consentListener=fn;return()=>{};}}};
 class IntersectionObserver {constructor(fn){observer=fn;}observe(){}disconnect(){}}
 const document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 new Function('require','exports','document','IntersectionObserver',compiled)(name=>imports[name],exports,document,IntersectionObserver);
 const render=()=>{slot=0;exports.useMeasuredExposure(node,'pricing:en','plans_view',{surface:'pricing'});};
 render();observer([{target:node,isIntersecting:true,intersectionRatio:0.2}]);permitted=true;consentListener();assert.equal(events.length,0);
 permitted=false;observer([{target:node,isIntersecting:true,intersectionRatio:0.5}]);assert.equal(events.length,0);
 permitted=true;consentListener();assert.equal(events.length,1);
 consentListener();observer([{target:node,isIntersecting:true,intersectionRatio:1}]);assert.equal(events.length,1);
 cleanup();render();observer([{target:node,isIntersecting:true,intersectionRatio:1}]);assert.equal(events.length,1);cleanup();
});

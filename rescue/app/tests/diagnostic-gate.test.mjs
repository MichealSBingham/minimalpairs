import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
async function component(name){const out=await build({entryPoints:[`src/components/${name}.tsx`],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime'],plugins:[{name:'boundaries',setup(b){b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));b.onLoad({filter:/MembershipPanel\.tsx$/},()=>({contents:`export default function Membership(){return <div>EXISTING_PLANS</div>}`,loader:'tsx'}));}}]});const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);return m.exports.default;}
const Results=await component('DiagnosticResults');const language={id:'en',locale:'en-US',contrasts:[0,1].map(n=>({id:`c${n}`,phonemes:['i','ɪ'],pairs:[{id:`p${n}`,words:[{text:`word${n}a`,ipa:'/i/'},{text:`word${n}b`,ipa:'/ɪ/'}]}]}))};const attempts=[0,1,1].map((n,i)=>({contrastId:`c${n}`,pairId:`p${n}`,word:`heard${i}`,chosenWord:'wrong',correctWord:'right',correct:false}));
test('free report keeps true chart and exactly one real mistake; paid shows all',()=>{const props={language,attempts,onPractice:()=>{}};const free=renderToStaticMarkup(React.createElement(Results,{...props,fullAccess:false}));const paid=renderToStaticMarkup(React.createElement(Results,{...props,fullAccess:true}));assert.equal((free.match(/class="diagnostic-mistake"/g)||[]).length,1);assert.equal((paid.match(/class="diagnostic-mistake"/g)||[]).length,3);assert.match(free,/diagnostic-overview/);assert.match(free,/EXISTING_PLANS/);assert.doesNotMatch(paid,/EXISTING_PLANS/);assert.match(free,/heard0/);assert.doesNotMatch(free,/heard1/);});
const History=await component('DiagnosticHistory');
test('saved-history free gate cannot reveal additional wrong answers; paid history restores them',()=>{const sessions=attempts.map((a,i)=>({id:`diagnostic-${i}`,languageId:'en',contrastId:a.contrastId,purpose:'diagnostic',mode:'abx-cross-word',completedAt:'2026-10-09T00:00:00Z',correct:0,total:1,mistakes:[a]}));const free=renderToStaticMarkup(React.createElement(History,{language,sessions,fullAccess:false}));const paid=renderToStaticMarkup(React.createElement(History,{language,sessions,fullAccess:true}));assert.equal((free.match(/class="diagnostic-mistake"/g)||[]).length,1);assert.equal((paid.match(/class="diagnostic-mistake"/g)||[]).length,3);assert.match(free,/EXISTING_PLANS/);assert.doesNotMatch(paid,/EXISTING_PLANS/);});
test('new paid arm reveals no personal score or answers; premium restores all',()=>{
 const props={language,attempts,onPractice:()=>{},variant:'paid'};
 const free=renderToStaticMarkup(React.createElement(Results,{...props,fullAccess:false}));
 const paid=renderToStaticMarkup(React.createElement(Results,{...props,fullAccess:true}));
 assert.doesNotMatch(free,/diagnostic-donut|diagnostic-overview|heard0|heard1|heard2|class="diagnostic-mistake"/);
 assert.match(free,/Your report is ready/);assert.match(free,/Example results · not your score/);assert.match(free,/EXISTING_PLANS/);
 assert.equal((paid.match(/class="diagnostic-mistake"/g)||[]).length,3);assert.match(paid,/diagnostic-overview/);assert.doesNotMatch(paid,/EXISTING_PLANS/);
});
test('new preview arm shows overall score and one answer but no full contrast chart',()=>{
 const free=renderToStaticMarkup(React.createElement(Results,{language,attempts,onPractice:()=>{},variant:'preview',fullAccess:false}));
 assert.match(free,/diagnostic-donut/);assert.doesNotMatch(free,/diagnostic-overview|heard1|heard2/);assert.equal((free.match(/class="diagnostic-mistake"/g)||[]).length,1);assert.match(free,/heard0/);
});
test('paid-arm saved history hides score and every personal answer until entitlement; legacy is preserved',()=>{
 const sessions=attempts.map((a,i)=>({id:`diagnostic-${i}`,languageId:'en',contrastId:a.contrastId,purpose:'diagnostic',mode:'abx-cross-word',completedAt:'2026-10-28T00:00:00Z',correct:0,total:1,mistakes:[a],diagnosticExperimentVariant:'paid'}));
 const free=renderToStaticMarkup(React.createElement(History,{language,sessions,fullAccess:false}));const paid=renderToStaticMarkup(React.createElement(History,{language,sessions,fullAccess:true}));
 assert.doesNotMatch(free,/0 \/ 3|heard0|heard1|heard2|class="diagnostic-mistake"|class="diagnostic-bar"/);assert.match(free,/Your report is ready/);
 assert.match(paid,/0 \/ 3/);assert.equal((paid.match(/class="diagnostic-mistake"/g)||[]).length,3);
 const legacy=renderToStaticMarkup(React.createElement(History,{language,sessions:sessions.map(({diagnosticExperimentVariant,...s})=>s),fullAccess:false}));assert.match(legacy,/0 \/ 3/);assert.match(legacy,/heard0/);
});

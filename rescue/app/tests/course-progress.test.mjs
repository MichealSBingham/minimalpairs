import test from 'node:test';
import assert from 'node:assert/strict';
import {courseProgress} from '../src/lib/course-progress.ts';
const contrasts=Array.from({length:5},(_,i)=>({id:`c${i}`,phonemes:['a','b']}));
const record=(extra={})=>({id:'focused-1',purpose:'focused',languageId:'en',contrastId:'c0',mode:'abx-cross-word',audioCollectionId:'chatterbox-us-four-voices-v1',mistakes:[],textHintsUsed:false,total:12,correct:9,completedAt:'2026-10-04T10:00:00Z',...extra});
test('course advances from sound matching to identification then next contrast',()=>{
 let p=courseProgress(contrasts,[record()],'en',false); assert.equal(p.next.mode,'word-identification');
 p=courseProgress(contrasts,[record(),record({id:'i',mode:'word-identification',textHintsUsed:true})],'en',false);assert.equal(p.next.contrast.id,'c1');assert.equal(p.completed,2);
});
test('diagnostics, mixed and short sessions cannot complete course steps',()=>{
 const p=courseProgress(contrasts,[record({id:'diagnostic-1'}),record({id:'x',purpose:'diagnostic'}),record({id:'mixed-1'}),record({id:'short',total:4,correct:4})],'en',true);assert.equal(p.completed,0);assert.equal(p.trends[0].sessions.length,2);
});
test('mode trends stay separate, duplicates ignored and free course never enters paid step',()=>{
 const sessions=contrasts.slice(0,3).flatMap((c,i)=>['abx-cross-word','word-identification'].map(mode=>record({id:`${i}-${mode}`,contrastId:c.id,mode})));
 const p=courseProgress(contrasts,[...sessions,sessions[0]],'en',false);assert.equal(p.completed,6);assert.equal(p.next,null);assert.equal(p.trends[0].sessions.length,3);assert.equal(p.trends[1].sessions.length,3);assert.equal(p.steps.filter(s=>s.locked).length,4);
});

test('experimental recordings do not mingle with course progress',()=>{assert.equal(courseProgress(contrasts,[record({audioCollectionId:'experimental'})],'en',true).completed,0)});

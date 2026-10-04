import test from 'node:test';
import assert from 'node:assert/strict';
import {runAnswerFeedback} from '../src/lib/answer-feedback.ts';
for (const reference of ['a','b']) test(`practice replays correct ${reference} then X before advancing`, async()=>{
 const events=[];
 await runAnswerFeedback({diagnostic:false,reference,play:async s=>events.push(s),wait:async()=>{},active:()=>true,advance:()=>events.push('next')});
 assert.deepEqual(events,[reference,'x','next']);
});
test('diagnostic advances without revealing any sound',async()=>{
 const events=[];
 await runAnswerFeedback({diagnostic:true,reference:'a',play:async s=>events.push(s),wait:async()=>{},active:()=>true,advance:()=>events.push('next')});
 assert.deepEqual(events,['next']);
});
test('leaving during feedback prevents X and automatic advance',async()=>{
 let active=true;const events=[];
 await runAnswerFeedback({diagnostic:false,reference:'b',play:async s=>{events.push(s);active=false;},wait:async()=>{},active:()=>active,advance:()=>events.push('next')});
 assert.deepEqual(events,['b']);
});
test('audio failure does not silently skip feedback',async()=>{
 let advanced=false;
 await assert.rejects(runAnswerFeedback({diagnostic:false,reference:'a',play:async()=>{throw Error('missing');},wait:async()=>{},active:()=>true,advance:()=>{advanced=true;}}));
 assert.equal(advanced,false);
});

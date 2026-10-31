import {test} from 'node:test';import assert from 'node:assert/strict';
import {nextStepAssignment,nextStepFocus} from '../src/lib/diagnostic-next-step.mjs';
import {offerAttribution} from '../src/lib/offer-attribution.mjs';
test('sticky assignment does not reallocate returning browsers',()=>{let value;const s={getItem:()=>value,setItem:(_,v)=>value=v};assert.equal(nextStepAssignment(s,()=>.1,Date.parse('2026-10-29T00:00:00Z')),'control');assert.equal(nextStepAssignment(s,()=>.9),'control');});
test('unavailable persistence excludes rather than repeatedly randomizes',()=>assert.equal(nextStepAssignment({getItem(){throw Error();}}),null));
test('perfect results do not invent a weakness',()=>assert.equal(nextStepFocus([{results:[{correct:true}],ratio:1,index:0}]),null));
test('new experiment survives shared attribution sanitizer; invalid arms fail closed',()=>{assert.equal(offerAttribution({experiment_id:'diag-next-step-v1',experiment_variant:'personalized'}).experiment_variant,'personalized');assert.deepEqual(offerAttribution({experiment_id:'diag-next-step-v1',experiment_variant:'paid'}),{});});

test('regional pricing rollout stops new next-step enrollment',()=>assert.equal(nextStepAssignment({getItem:()=>null,setItem:()=>{throw Error('must not enroll')}},()=>.2,Date.parse('2026-10-30T21:01:00Z')),null));

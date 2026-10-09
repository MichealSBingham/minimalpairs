import test from 'node:test';import assert from 'node:assert/strict';
import {selectDiagnosticContrasts} from '../src/lib/diagnostic-plan.ts';
import {diagnosticLengthCopy} from '../src/lib/diagnostic-length.ts';
import {selectJourneyContrasts} from '../src/lib/journey.ts';
const contrasts=Array.from({length:10},(_,i)=>({id:`test-${i}`,pairs:[{},{}]}));
test('short defaults to six groups; free full check includes every eligible contrast',()=>{assert.equal(selectDiagnosticContrasts(contrasts,'en').length,6);assert.equal(selectJourneyContrasts(contrasts,[],'en',false,'diagnostic','test-0','abx-cross-word','','full').length,10);assert.equal(selectDiagnosticContrasts([...contrasts,{id:'empty',pairs:[]}],'en','','full').length,10);});
test('localized labels and estimates adapt to actual rounds',()=>{for(const locale of ['en','fr','es','pt','de','it','ru','ja','zh']){const a=diagnosticLengthCopy(locale,12),b=diagnosticLengthCopy(locale,64);assert.notEqual(a.short,a.full);assert.ok(!a.duration.includes('{'));assert.notEqual(a.duration,b.duration);}assert.match(diagnosticLengthCopy('en',12).duration,/2–4/);assert.match(diagnosticLengthCopy('en',64).duration,/11–22/);});

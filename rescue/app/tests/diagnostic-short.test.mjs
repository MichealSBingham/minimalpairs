import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectDiagnosticContrasts,DIAGNOSTIC_ROUNDS_PER_GROUP} from '../src/lib/diagnostic-plan.ts';
import {diagnosticHistory} from '../src/lib/diagnostic-history.ts';
test('every production bank has six actual groups and twelve rounds',()=>{
 for(const bank of ['us','fr','es','de','it','pt','ru','ja','zh']){
  const {contrasts}=JSON.parse(readFileSync(new URL(`../src/data/${bank}-chatterbox-curriculum.json`,import.meta.url)));
  const selected=selectDiagnosticContrasts(contrasts,bank==='us'?'en':bank);
  assert.equal(selected.length,6,bank);assert.equal(new Set(selected.map(c=>c.id)).size,6);
  assert.equal(selected.length*DIAGNOSTIC_ROUNDS_PER_GROUP,12);
  assert.ok(selected.every(c=>contrasts.includes(c)));
 }
});
test('French sample includes rounded/nasal contrasts',()=>{
 const {contrasts}=JSON.parse(readFileSync(new URL('../src/data/fr-chatterbox-curriculum.json',import.meta.url)));
 const ids=selectDiagnosticContrasts(contrasts,'fr').map(c=>c.id);
 assert.ok(ids.includes('fr-eu-closed-open'));assert.ok(ids.includes('fr-an-in'));
});
test('history preserves scores and separates practice and languages',()=>{
 const row={id:'diagnostic-123-fr-u-y',purpose:'diagnostic',languageId:'fr',completedAt:'2026-10-08T10:00:00Z',contrastId:'fr-u-y',correct:1,total:2,mistakes:[]};
 const other={...row,id:'diagnostic-123-fr-an-on',contrastId:'fr-an-on',correct:2};
 const runs=diagnosticHistory([row,other,row,{...row,id:'focused-1',purpose:'focused'},{...row,languageId:'en'},{...row,id:'invalid',correct:5}],'fr');
 assert.equal(runs.length,1);assert.equal(runs[0].total,4);assert.equal(runs[0].correct,3);
});

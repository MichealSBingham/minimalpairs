import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectDiagnosticContrasts,DIAGNOSTIC_MAX_GROUPS,DIAGNOSTIC_ROUNDS_PER_GROUP} from '../src/lib/diagnostic-plan.ts';
import {DIAGNOSTIC_LANGUAGES,DIAGNOSTIC_NATIVE_LANGUAGES,DIAGNOSTIC_PRIORITIES,DIRECT_STUDY_PRIORITIES,normalizeDiagnosticLanguage} from '../src/lib/diagnostic-priorities.ts';
const banks=Object.fromEntries(DIAGNOSTIC_LANGUAGES.map(id=>[id,JSON.parse(fs.readFileSync(new URL(`../src/data/${id==='en'?'us':id}-chatterbox-curriculum.json`,import.meta.url))).contrasts]));
test('all L1-to-L2 selections use six distinct real production groups, twelve rounds and diverse families',()=>{
 for(const target of DIAGNOSTIC_LANGUAGES){
  const known=new Set(banks[target].map(c=>c.id));
  for(const p of DIAGNOSTIC_PRIORITIES[target])assert.ok(known.has(p.id),p.id);
  for(const native of [...DIAGNOSTIC_NATIVE_LANGUAGES,'Other',undefined]){
   const result=selectDiagnosticContrasts(banks[target],target,native);
   assert.equal(result.length,DIAGNOSTIC_MAX_GROUPS);assert.equal(result.length*DIAGNOSTIC_ROUNDS_PER_GROUP,12);
   assert.equal(new Set(result.map(c=>c.id)).size,6);assert.ok(result.every(c=>known.has(c.id)));
   const families=result.map(c=>DIAGNOSTIC_PRIORITIES[target].find(p=>p.id===c.id)?.family);
   assert.ok(new Set(families).size>=3,`${native}->${target}: ${families}`);
   for(const family of new Set(families))assert.ok(families.filter(f=>f===family).length<=(family==='tones'?3:2));
  }
 }
});
test('stored names, locale codes and new native-language names normalize consistently',()=>{
 for(const [name,id] of [['English','en'],['Spanish','es'],['French','fr'],['German','de'],['Italian','it'],['Portuguese','pt'],['Russian','ru'],['Japanese','ja'],['Mandarin Chinese','zh'],['Arabic','ar'],['Hindi','hi'],['Korean','ko']]){
  assert.equal(normalizeDiagnosticLanguage(name),id);
  assert.deepEqual(selectDiagnosticContrasts(banks.en,'en',name),selectDiagnosticContrasts(banks.en,'en',id));
 }
 assert.equal(normalizeDiagnosticLanguage('pt-BR'),'pt');assert.equal(normalizeDiagnosticLanguage('en-US-ga'),'en');assert.equal(normalizeDiagnosticLanguage('Other'),undefined);
});
test('same-language and unknown backgrounds use broad fallback instead of an artificial hardest set',()=>{
 for(const target of DIAGNOSTIC_LANGUAGES){const baseline=selectDiagnosticContrasts(banks[target],target);assert.deepEqual(selectDiagnosticContrasts(banks[target],target,target),baseline);assert.deepEqual(selectDiagnosticContrasts(banks[target],target,'Other'),baseline);}
});
test('population-specific evidence and inventory predictions change selection without changing supplied records',()=>{
 assert.ok(selectDiagnosticContrasts(banks.en,'en','Japanese').some(c=>c.id==='en-r-l'));
 assert.equal(selectDiagnosticContrasts(banks.es,'es','French')[0].id,'es-stress');
 assert.equal(selectDiagnosticContrasts(banks.ru,'ru','Spanish')[0].id,'ru-y-i');
 assert.ok(selectDiagnosticContrasts(banks.en,'en','Arabic').some(c=>c.id==='en-p-b'));
 assert.ok(selectDiagnosticContrasts(banks.en,'en','Hindi').some(c=>c.id==='en-v-w'));
 assert.ok(selectDiagnosticContrasts(banks.en,'en','Korean').some(c=>c.id==='en-r-l'));
 assert.notDeepEqual(selectDiagnosticContrasts(banks.en,'en','Spanish').map(c=>c.id),selectDiagnosticContrasts(banks.en,'en','Japanese').map(c=>c.id));
 const original=JSON.stringify(banks);selectDiagnosticContrasts(banks.fr,'fr','English');assert.equal(JSON.stringify(banks),original);
 for(const [target,profiles] of Object.entries(DIRECT_STUDY_PRIORITIES))for(const ids of Object.values(profiles))for(const id of ids)assert.ok(banks[target].some(c=>c.id===id));
});
test('temporarily unavailable groups are skipped, sparse banks stay bounded, unknown targets degrade safely',()=>{
 const sparse=banks.en.filter(c=>['en-i-ih','en-th-s','en-s-z'].includes(c.id));const selected=selectDiagnosticContrasts(sparse,'en','Japanese');assert.equal(selected.length,3);assert.ok(selected.every(c=>sparse.includes(c)));
 assert.deepEqual(selectDiagnosticContrasts([],'en','Japanese'),[]);assert.equal(selectDiagnosticContrasts(banks.en,'unknown','Japanese').length,6);
});
test('evidence separates exact contrast studies, broader feature studies and inventory predictions',()=>{
 const evidence=JSON.parse(fs.readFileSync(new URL('../../research/diagnostic-l1-evidence.json',import.meta.url)));
 const sources=new Map(evidence.sources.map(s=>[s.id,s]));
 assert.ok(!DIRECT_STUDY_PRIORITIES.en.ja.includes('en-i-ih'));
 assert.equal(evidence.supportTypeByLink['en:ko']['en-i-ih'],'study-feature-supported');
 assert.equal(evidence.supportTypeByLink['fr:en']['fr-y-i'],'direct-study-supported');
 assert.deepEqual(evidence.directStudyLinks['es:fr']['es-stress'],['stress-schwab2017']);
 for(const [target,profiles] of Object.entries(DIRECT_STUDY_PRIORITIES))for(const [native,ids] of Object.entries(profiles))for(const id of ids){
  const sourceIds=evidence.directStudyLinks[`${target}:${native}`]?.[id];assert.ok(sourceIds?.length,`${target}:${native}:${id}`);
  for(const sourceId of sourceIds){const source=sources.get(sourceId);assert.ok(source);assert.ok(!source.kind.includes('inventory'));}
 }
});

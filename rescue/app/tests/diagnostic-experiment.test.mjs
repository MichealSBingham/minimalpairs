import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/diagnostic-experiment.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};new Function('module','exports',compiled)(m,m.exports);const {diagnosticAssignment,EXPERIMENT_KEY:K}=m.exports;
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}};
test('rollout always gives preview and replaces previous paid assignment',()=>{for(const previous of [null,'paid','preview']){const s=storage();if(previous)s.setItem(K,JSON.stringify({experiment:'diag-paywall-v1',variant:previous}));assert.equal(diagnosticAssignment(s),'preview');assert.equal(JSON.parse(s.getItem(K)).variant,'preview');}});
test('storage failure cannot remove the preview offer',()=>{assert.equal(diagnosticAssignment({getItem(){throw Error('blocked')},setItem(){throw Error('quota')}}),'preview');});
test('malformed or foreign assignments cannot reinstate paid variant',()=>{for(const raw of ['broken',JSON.stringify({experiment:'other',variant:'paid'})]){const s=storage();s.setItem(K,raw);assert.equal(diagnosticAssignment(s),'preview');}});

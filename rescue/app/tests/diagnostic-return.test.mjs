import test from 'node:test';
import assert from 'node:assert/strict';
import {saveDiagnosticReturn,diagnosticReturnPath,DIAGNOSTIC_RETURN_KEY} from '../src/lib/diagnostic-return.ts';
const make=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};};
test('saved report returns to the exact language and run after checkout',()=>{const s=make();saveDiagnosticReturn(s,'fr','2026-10-09T10:00:00Z',1000);assert.equal(diagnosticReturnPath(s,1001),'/practice?language=fr&session=diagnostic&report=2026-10-09T10%3A00%3A00Z#diagnostic-history');assert.equal(diagnosticReturnPath(s,8*86400000),null);});
test('malformed and injected destinations cannot redirect',()=>{const s=make();for(const value of ['bad',JSON.stringify({language:'https://evil.test',completedAt:'2026-10-09',createdAt:1000}),JSON.stringify({language:'fr',completedAt:'bad',createdAt:1000})]){s.setItem(DIAGNOSTIC_RETURN_KEY,value);assert.equal(diagnosticReturnPath(s,1001),null);}});

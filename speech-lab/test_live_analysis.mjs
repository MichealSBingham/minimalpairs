import {analyzeLive} from './speaking/live-analysis.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const input=JSON.parse(fs.readFileSync('/tmp/minimalpairs-speaking-qa/live-probe.json'));
const rows=input.rows.map(({samples,sr,...row})=>{const start=performance.now();const result=analyzeLive(samples,sr);return {...row,result,ms:performance.now()-start};});
const controls=input.controls.map(({samples,sr,id})=>({id,...analyzeLive(samples,sr)}));
const mean=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const quant=(x,p)=>x.sort((a,b)=>a-b)[Math.floor((x.length-1)*p)]??null;
const groups={};
for(const condition of ['clean','noise20db','noise10db','telephone'])for(const group of ['all','m','w']){
 const subset=rows.filter(r=>r.condition===condition&&(group==='all'||r.group===group)),accepted=subset.filter(r=>r.result.ok);
 const large=accepted.filter(r=>Math.abs(r.result.f1-r.ref.f1)>150||Math.abs(r.result.f2-r.ref.f2)>300);
 groups[`${condition}/${group}`]={total:subset.length,accepted:accepted.length,large_errors:large.length,f2_mae_hz:mean(accepted.map(r=>Math.abs(r.result.f2-r.ref.f2))),compute_p95_ms:quant(subset.map(r=>r.ms),.95)};
}
const out='speech-lab/qa/speaking-v2';
const hashes=Object.fromEntries(['live-analysis.mjs','live-baseline.mjs','live.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync('speech-lab/speaking/'+f)).digest('hex')]));
fs.writeFileSync(out+'/acoustic-probe.json',JSON.stringify({notice:'Reused corpus. Development sensitivity probe. Not held-out speech, mobile microphone or pronunciation accuracy.',frame_ms:60,seed:20261007,hashes,groups,controls,rows},null,2));
console.log(JSON.stringify({groups,controls},null,2));
for(const c of controls)assert.equal(c.ok,false,c.id+' falsely accepted');
assert.ok(rows.some(r=>r.condition==='clean'&&r.result.ok),'No speech accepted');

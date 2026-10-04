import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIdentificationSession} from '../src/lib/identification.ts';
import {assignAvailableVoices} from '../src/lib/round-voices.ts';
const pairs=[{id:'ship-sheep',words:[{text:'ship',ipa:'/ʃɪp/'},{text:'sheep',ipa:'/ʃip/'}]},{id:'bit-beat',words:[{text:'bit',ipa:'/bɪt/'},{text:'beat',ipa:'/bit/'}]}];
test('identification target is exactly one displayed choice, not a cross-word ABX exemplar',()=>{
 for(const q of buildIdentificationSession(pairs,50)){assert.equal(q.pair,q.testPair);assert.ok(q.order.includes(q.target));assert.deepEqual([...q.order].sort(),[0,1]);}
});
test('identification works with a single pair and ignores indistinguishable choices',()=>{
 assert.equal(buildIdentificationSession([pairs[0]],6).length,6);
 assert.equal(buildIdentificationSession([{id:'same',words:[pairs[0].words[0],pairs[0].words[0]]}],6).length,0);
});
test('identification feedback can replay the same word in a distinct voice',()=>{
 const clips=pairs.flatMap(p=>p.words.flatMap(w=>['A','B','C'].map(voiceId=>({...w,languageId:'en',voiceId,url:`/${voiceId}/${w.text}`}))));
 for(const q of assignAvailableVoices(buildIdentificationSession(pairs,30),clips,'en')){assert.notEqual(q.referenceVoiceId,q.testVoiceId);assert.equal(q.pair.words[q.target].text,q.testPair.words[q.target].text);}
});

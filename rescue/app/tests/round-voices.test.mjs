import test from 'node:test';import assert from 'node:assert/strict';
import {assignAvailableVoices,wordVoices,referenceVoices} from '../src/lib/round-voices.ts';
const w=(text,ipa=text)=>({text,ipa,meaning:''});const a=w('a'),b=w('b'),x=w('x');
const pair={id:'ab',words:[a,b]},testPair={id:'xy',words:[x,w('y')]};
const clip=(word,voice,status='unreviewed')=>({languageId:'en',text:word.text,ipa:word.ipa,voiceId:voice,url:`/audio/${word.text}-${voice}.wav`,status});
test('each round chooses real clips despite no lesson-wide common voice',()=>{
 const clips=[clip(a,'A'),clip(a,'B'),clip(b,'B'),clip(b,'C'),clip(x,'C'),clip(x,'D')];
 const q=assignAvailableVoices([{pair,testPair,target:0,order:[0,1]}],clips,'en',()=>0)[0];assert.equal(q.referenceVoiceId,'B');assert.equal(q.testVoiceId,'C');
});
test('rejected and wrong-IPA recordings never count, and missing coverage fails explicitly',()=>{
 const clips=[clip(a,'A','rejected'),clip(w('a','wrong'),'B'),clip(a,'new-voice')];assert.deepEqual(wordVoices(clips,'en',a),['new-voice']);assert.deepEqual(referenceVoices(clips,'en',pair),[]);
 assert.throws(()=>assignAvailableVoices([{pair,testPair,target:0,order:[0,1]}],clips,'en'),/replacement recordings/);
});
test('X always uses a different voice, including when new profiles are added',()=>{
 const clips=[a,b,x].flatMap(w=>['new-a','new-b','new-c'].map(v=>clip(w,v)));
 for(let i=0;i<100;i++){const q=assignAvailableVoices([{pair,testPair,target:0,order:[0,1]}],clips,'en')[0];assert.notEqual(q.referenceVoiceId,q.testVoiceId);}
});

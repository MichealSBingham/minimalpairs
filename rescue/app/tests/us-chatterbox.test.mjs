import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {buildSession} from '../src/lib/practice-engine.ts';import {wordVoices,referenceVoices,assignAvailableVoices,playablePairs} from '../src/lib/round-voices.ts';
const rejected=new Set(JSON.parse(fs.readFileSync(new URL('../src/data/rejected-audio.json',import.meta.url))).map(c=>c.id+'|'+c.sha256));
for(const code of ['us','fr','de','es','it','zh','pt','ru','ja'])test(`${code}: every playable word and every round has exact-IPA, diverse, intact audio`,()=>{
 const language=JSON.parse(fs.readFileSync(new URL(`../src/data/${code}-chatterbox-curriculum.json`,import.meta.url)));const manifest=JSON.parse(fs.readFileSync(new URL(`../public/audio/chatterbox-${code}/manifest.json`,import.meta.url)));
 for(const clip of manifest.clips){assert.notEqual(clip.status,'rejected');assert.ok(!rejected.has(clip.id+'|'+clip.sha256),'Rejected render reintroduced: '+clip.id);const bytes=fs.readFileSync(new URL('../public'+clip.url,import.meta.url));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),clip.sha256,clip.id);}
 const exclusions=new Set((manifest.practiceExclusions||[]).map(w=>w.text+'|'+w.ipa));
 for(const word of manifest.practiceExclusions||[])assert.ok(wordVoices(manifest.clips,language.id,word).length<2,'Stale practice exclusion: '+word.text);
 for(const contrast of language.contrasts){
  for(const pair of contrast.pairs)for(const word of pair.words) {
   const covered=wordVoices(manifest.clips,language.id,word).length>=2;
   assert.ok(covered||exclusions.has(word.text+'|'+word.ipa),`${contrast.id}: undeclared coverage loss for ${word.text}`);
  }
  const pairs=playablePairs(contrast.pairs,manifest.clips,language.id);
  assert.ok(pairs.length,`${contrast.id}: no playable pairs`);
  for(const pair of pairs)assert.ok(referenceVoices(manifest.clips,language.id,pair).length,`${contrast.id}: no shared reference voice`);
  const rounds=assignAvailableVoices(buildSession(pairs,24,Math.random,p=>referenceVoices(manifest.clips,language.id,p).length>0),manifest.clips,language.id);assert.equal(rounds.length,24,contrast.id);
  for(const q of rounds)for(const w of [...q.pair.words,...q.testPair.words])assert.ok(!exclusions.has(w.text+'|'+w.ipa),'Excluded word sampled: '+w.text);
  for(const q of rounds){assert.notEqual(q.referenceVoiceId,q.testVoiceId);for(const w of q.pair.words)assert.ok(wordVoices(manifest.clips,language.id,w).includes(q.referenceVoiceId));assert.ok(wordVoices(manifest.clips,language.id,q.testPair.words[q.target]).includes(q.testVoiceId));}
 }
});

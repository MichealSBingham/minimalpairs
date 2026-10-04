import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildSession} from '../src/lib/practice-engine.ts';
import {wordVoices,referenceVoices,assignAvailableVoices} from '../src/lib/round-voices.ts';
for(const bank of ['fr','de','es','it','zh','pt','ru','ja'])test(`${bank}: flexible voice coverage and cross-word ABX`,()=>{
 const lang=JSON.parse(fs.readFileSync(new URL(`../src/data/${bank}-chatterbox-curriculum.json`,import.meta.url)));
 const manifest=JSON.parse(fs.readFileSync(new URL(`../public/audio/chatterbox-${bank}/manifest.json`,import.meta.url)));
 const voices=manifest.voicesByLanguage[bank].map(v=>v.id);assert.equal(voices.length,4);
 for(const contrast of lang.contrasts){
  for(const pair of contrast.pairs){assert.ok(referenceVoices(manifest.clips,bank,pair).length);for(const w of pair.words)assert.ok(wordVoices(manifest.clips,bank,w).length>=2,`${bank}: ${w.text}`);}
  const trials=assignAvailableVoices(buildSession(contrast.pairs,40),manifest.clips,bank);assert.equal(trials.length,40,contrast.id);
  for(const q of trials){assert.notEqual(q.referenceVoiceId,q.testVoiceId);assert.equal(q.pair.abx.trialGroup,q.testPair.abx.trialGroup);assert.ok(q.pair.words.every(w=>w.text!==q.testPair.words[q.target].text&&w.ipa!==q.testPair.words[q.target].ipa));}
 }
 assert.ok(manifest.clips.every(c=>c.status==='unreviewed'&&c.id&&c.wordId&&c.sha256&&c.bankId===bank));
});

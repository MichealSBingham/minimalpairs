import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getAudioReviewCatalog} from '../src/lib/audio-review-catalog.ts';
test('audition has complete word-by-voice coverage and exact bytes, isolated from training',()=>{
  const data=JSON.parse(fs.readFileSync('public/audio/voice-audition-v2/manifest.json','utf8'));
  const balance=JSON.parse(fs.readFileSync('../content/phoneme-research/mandarin-balance.json','utf8'));
  const live=new Set(getAudioReviewCatalog().clips.map(c=>c.url));
  assert.equal(data.kind,'minimalpairs-voice-audition');assert.equal(data.clips.length,48);
  assert.equal(new Set(data.clips.map(c=>c.voiceId)).size,3);
  const seen=new Set();
  for(const clip of data.clips){
    const word=balance.lexicalItems.find(w=>w.id===clip.wordId);
    assert.ok(word&&word.split==='train'&&balance.audition.wordIds.includes(word.id));
    assert.equal(clip.text,word.text);assert.equal(clip.ipa,word.ipa);assert.equal(clip.reading,word.romanization);
    assert.equal(clip.locale,'cmn-CN');assert.equal(clip.reviewStatus,'unreviewed');assert.ok(clip.aiAudit);
    assert.equal(live.has(clip.url),false);assert.match(clip.url,/^\/audio\/voice-audition-v2\/clips\/[a-zA-Z0-9_-]+\.wav$/);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join('public',clip.url))).digest('hex'),clip.sha256);
    const key=`${clip.wordId}:${clip.voiceId}`;assert.equal(seen.has(key),false);seen.add(key);
  }
  for(const id of balance.audition.wordIds)assert.equal(data.clips.filter(c=>c.wordId===id).length,3);
});

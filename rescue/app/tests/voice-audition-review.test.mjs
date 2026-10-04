import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeAuditionReviews,parseAuditionReviews,playedThrough} from '../src/lib/voice-audition-review.ts';
const first=`clip-a:${'a'.repeat(64)}`,second=`clip-b:${'b'.repeat(64)}`;
const review=(note,date='2026-10-01T00:00:00.000Z')=>({status:'unsure',note,updatedAt:date});
test('stale-tab edits preserve other clip notes and newer decisions',()=>{
  const saved={[first]:review('first'),[second]:review('newer','2026-10-01T00:01:00.000Z')};
  const merged=mergeAuditionReviews(saved,{[second]:review('stale')});
  assert.equal(merged[first].note,'first');assert.equal(merged[second].note,'newer');
  assert.deepEqual(parseAuditionReviews(JSON.stringify(merged)),merged);
  assert.deepEqual(parseAuditionReviews(JSON.stringify({[first]:{...review('bad'),'updatedAt':'invalid'}})),{});
});
test('approval coverage rejects seek-to-end and unplayed gaps',()=>{
  const ranges=items=>({length:items.length,start:i=>items[i][0],end:i=>items[i][1]});
  assert.equal(playedThrough(1,ranges([[0.9,1]])),false);
  assert.equal(playedThrough(1,ranges([[0,.3],[.7,1]])),false);
  assert.equal(playedThrough(1,ranges([[0,.98]])),true);
});

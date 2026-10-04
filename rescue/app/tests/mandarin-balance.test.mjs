import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateMandarinBalance } from '../src/lib/mandarin-balance.ts';
const load=()=>({packs:[JSON.parse(fs.readFileSync('../content/phoneme-research/other-languages.json','utf8'))],balance:JSON.parse(fs.readFileSync('../content/phoneme-research/mandarin-balance.json','utf8'))});
test('all six comparisons have equal syllable distributions, with separate unfamiliar assessment frames',()=>{
  const {packs,balance}=load();const result=validateMandarinBalance(packs,balance);
  assert.ok(result.trainingWords>=48);assert.ok(result.heldoutWords>=8);
  for(const comparison of balance.trainingComparisons)assert.ok(comparison.segmentalFrames.length>=12);
  assert.equal(balance.audition.wordIds.length,16);
});
test('rejects a category-specific syllable shortcut instead of only counting words',()=>{
  const {packs,balance}=load();balance.trainingComparisons[0].wordIdsByTone[0].pop();
  assert.throws(()=>validateMandarinBalance(packs,balance),/Unbalanced/);
});
test('reserved Mandarin frames cannot leak into any consonant or tone training pool',()=>{
  const {packs,balance}=load(),word=balance.lexicalItems.find(w=>w.split==='heldout');
  packs[0].contrasts.find(c=>c.languageId==='zh').pools[0].push({...word,position:'syllable tone',group:'isolated-citation'});
  assert.throws(()=>validateMandarinBalance(packs,balance),/leaked/);
});
test('auditions exclude assessment words and reject duplicate item identities',()=>{
  const {packs,balance}=load();balance.audition.wordIds.push(balance.lexicalItems.find(w=>w.split==='heldout').id);
  assert.throws(()=>validateMandarinBalance(packs,balance),/reserved assessment/);
  const fresh=load();fresh.balance.lexicalItems.push(fresh.balance.lexicalItems[0]);
  assert.throws(()=>validateMandarinBalance(fresh.packs,fresh.balance),/Duplicate/);
});

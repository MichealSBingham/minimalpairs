import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { practiceFocus } from '../src/lib/practice-focus.ts';
import { buildSession, assignSessionVoices, revisitMistake } from '../src/lib/practice-engine.ts';

const pair = (id, group, position = 'medial') => ({ id, kind: 'minimal', words: [{ text: `secret-${id}-a`, ipa: `/secret-${id}-a/`, meaning: 'hidden a' }, { text: `secret-${id}-b`, ipa: `/secret-${id}-b/`, meaning: 'hidden b' }], abx: { trialGroup: group, targetPosition: position } });
const contrasts = { id: 'fixture', label: 'Hidden label', description: 'Hidden description', phonemes: ['u', 'y'], pairs: [], targetSoundFocus: 'A neutral introduction.' };
const mixed = { ...contrasts, pairs: [pair('one', 'final', 'final'), pair('two', 'final', 'final'), pair('three', 'first'), pair('four', 'first')], abx: { requireSameTargetPosition: true, focusByTrialGroup: { final: { unit: 'vowel', position: 'final' }, first: { unit: 'vowel', position: 'first' } } } };
function seeded(seed) { let value = seed; return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; }; }

test('explicit reference groups support vowel positions and vowel order without exposing examples', () => {
  const expected = {
    initial: 'Focus on the vowel at the beginning of each word.',
    medial: 'Focus on the vowel inside each word.',
    final: 'Focus on the vowel at the end of each word.',
    first: 'Listen to the first vowel in each word.',
    last: 'Listen to the last vowel in each word.',
  };
  for (const [position, phrase] of Object.entries(expected)) {
    const contrast = { ...mixed, abx: { ...mixed.abx, focusByTrialGroup: { selected: { unit: 'vowel', position } } } };
    const reference = pair('secret', 'selected', 'initial');
    assert.equal(practiceFocus(contrast, reference), phrase);
    reference.words.reverse(); reference.words[0].text = 'do not show';
    assert.equal(practiceFocus(contrast, reference), phrase);
  }
  assert.equal(practiceFocus(mixed), mixed.targetSoundFocus);
});

test('new sound/consonant descriptors are explicit; missing or malformed group metadata stays neutral', () => {
  for (const unit of ['sound', 'consonant']) {
    const contrast = { ...contrasts, abx: { focusByTrialGroup: { all: { unit, position: 'medial' } } } };
    assert.equal(practiceFocus(contrast, pair('a', undefined)), `Focus on the ${unit} inside each word.`);
  }
  for (const descriptor of [undefined, null, 'dessous /dəsu/', { unit: 'vowel', position: 'dessous /dəsu/' }, { unit: 'dessous', position: 'final' }, { unit: '__proto__', position: 'final' }, { unit: 'vowel', position: 'constructor' }]) {
    assert.equal(practiceFocus({ ...mixed, abx: { ...mixed.abx, focusByTrialGroup: { final: descriptor } } }, mixed.pairs[0]), 'Listen for the target sound in each word.');
  }
  assert.equal(practiceFocus(mixed, pair('missing', 'unknown', 'final')), 'Listen for the target sound in each word.');
  assert.equal(practiceFocus(mixed, pair('prototype', '__proto__', 'final')), 'Listen for the target sound in each word.');
});

test('malformed JSON descriptor fields, maps and group keys cannot coerce property lookups', () => {
  const neutral = 'Listen for the target sound in each word.';
  const descriptors = JSON.parse(`[
    {"unit":{"toString":null},"position":"final"},
    {"unit":"vowel","position":{"toString":null}},
    {"unit":["vowel"],"position":"final"},
    {"unit":"vowel","position":["final"]},
    {"unit":null,"position":"final"},
    {"unit":"vowel","position":1},
    [], ["vowel","final"], false, 1
  ]`);
  for (const descriptor of descriptors) {
    const contrast = { ...mixed, abx: { ...mixed.abx, focusByTrialGroup: { final: descriptor } } };
    assert.equal(practiceFocus(contrast, mixed.pairs[0]), neutral);
  }
  for (const map of JSON.parse('[null,false,0,"final",[],[{"unit":"vowel","position":"final"}]]')) {
    assert.equal(practiceFocus({ ...mixed, abx: { ...mixed.abx, focusByTrialGroup: map } }, mixed.pairs[0]), neutral);
  }
  for (const group of JSON.parse('[null,1,true,["final"],{"toString":null}]')) {
    assert.equal(practiceFocus(mixed, pair('malformed', group)), neutral);
  }
});

test('every existing main-curriculum pair retains its prior focus behavior', () => {
  const curriculum = JSON.parse(readFileSync(new URL('../../content/curriculum.json', import.meta.url)));
  for (const language of curriculum.languages) for (const contrast of language.contrasts) {
    assert.equal(practiceFocus(contrast), contrast.targetSoundFocus);
    for (const reference of contrast.pairs) {
      const previous = contrast.abx?.requireSameTargetPosition ? (reference.abx?.targetPosition === 'initial' ? 'Focus on the consonant at the beginning of each word.' : reference.abx?.targetPosition === 'final' ? 'Focus on the consonant at the end of each word.' : contrast.targetSoundFocus) : contrast.targetSoundFocus;
      assert.equal(practiceFocus(contrast, reference), previous, reference.id);
    }
  }
});

test('mixed sessions and mistake revisits select focus from the current reference group', () => {
  let changedRevisits = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const queue = assignSessionVoices(buildSession(mixed.pairs, 12, seeded(seed)), ['profile-a', 'profile-b'], seeded(seed + 40));
    const expected = reference => reference.abx.trialGroup === 'final' ? 'Focus on the vowel at the end of each word.' : 'Listen to the first vowel in each word.';
    for (const question of queue) {
      assert.equal(practiceFocus(mixed, question.pair), expected(question.pair));
      assert.equal(question.pair.abx.trialGroup, question.testPair.abx.trialGroup);
      assert.notEqual(question.referenceVoiceId, question.testVoiceId);
    }
    const revised = revisitMistake(queue, 0);
    revised.forEach((question, index) => {
      assert.equal(practiceFocus(mixed, question.pair), expected(question.pair));
      if (question.pair.abx.trialGroup !== queue[index].pair.abx.trialGroup) changedRevisits++;
    });
  }
  assert.ok(changedRevisits > 0, 'exercise a revisit that changes the target group');
});

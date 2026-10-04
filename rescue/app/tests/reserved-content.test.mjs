import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertReservedContentExcluded } from '../scripts/reserved-content.mjs';

const pool = JSON.parse(readFileSync(new URL('../../content/transfer-candidates.json', import.meta.url), 'utf8'));
const curriculum = JSON.parse(readFileSync(new URL('../../content/curriculum.json', import.meta.url), 'utf8')).languages;
const training = (text, ipa, languageId = 'fr') => [{ id: languageId, contrasts: [{ pairs: [{ id: 'new-pair', words: [{ text, ipa }] }] }] }];

test('current shared training excludes all twelve reserved lexical and phonemic forms', () => {
  assert.deepEqual(assertReservedContentExcluded(curriculum, pool), { reservedWords: 12, audioManifestsChecked: 0, collisions: 0 });
});
test('reserved spelling and differently spelled homophones cannot enter training', () => {
  assert.throws(() => assertReservedContentExcluded(training(' POUCE ', '/different/'), pool), /Reserved assessment material/);
  assert.throws(() => assertReservedContentExcluded(training('homophone', '[ ˈp.u.s ]'), pool), /phonemic form/);
  assert.throws(() => assertReservedContentExcluded(training('homophone', '/liːk/', 'en'), pool), /phonemic form/);
  assert.doesNotThrow(() => assertReservedContentExcluded(training('bin', '/different/', 'fr'), pool));
});
test('independent public audio cannot bypass the reserved curriculum guard', () => {
  assert.throws(() => assertReservedContentExcluded(curriculum, pool, [{ path: 'public/audio/new.json', manifest: { clips: [{ languageId: 'fr', text: 'moule' }] } }]), /public\/audio\/new.json/);
  assert.throws(() => assertReservedContentExcluded(curriculum, pool, [{ path: 'public/audio/new.json', manifest: { clips: [{ languageId: 'fr', text: 'homophone', targetIPA: '/myl/' }] } }]), /phonemic form/);
  assert.throws(() => assertReservedContentExcluded(curriculum, { sets: [] }), /missing or invalid/);
  for (const pair of [{}, { words: [] }, { words: [{ text: 'pouce', ipa: '/pus/' }] }, { words: [{ text: 'pouce', ipa: '/' }, { text: 'puce', ipa: '/pys/' }] }]) {
    assert.throws(() => assertReservedContentExcluded([], { sets: [{ languageId: 'fr', pairs: [pair] }] }), /incomplete/);
  }
});

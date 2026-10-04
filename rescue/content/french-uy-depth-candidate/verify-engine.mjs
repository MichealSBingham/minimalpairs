/** Isolated content verification against the real app engine; never imports into app data. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSession, assignSessionVoices, revisitMistake } from '../../app/src/lib/practice-engine.ts';

const candidateUrl = new URL('./candidates.json', import.meta.url);
const engineUrl = new URL('../../app/src/lib/practice-engine.ts', import.meta.url);
const candidate = JSON.parse(readFileSync(candidateUrl, 'utf8'));
const sets = candidate.sets;
const allPairs = sets.flatMap(set => set.pairs);
const pairToSet = new Map(sets.flatMap(set => set.pairs.map(pair => [pair.id, set])));
// These are identifiers for complete hypothetical profiles, not approved recordings.
const voices = ['unapproved-fr-profile-a', 'unapproved-fr-profile-b'];
const key = word => word.normalize('NFC').trim().toLowerCase();
const sha = url => createHash('sha256').update(readFileSync(url)).digest('hex');
function seeded(seed) {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}
function check(question) {
  const { pair, testPair, target, order, referenceVoiceId, testVoiceId } = question;
  const set = pairToSet.get(pair.id);
  assert.ok(set);
  assert.equal(pairToSet.get(testPair.id).id, set.id, 'X must stay in the reference set');
  assert.equal(pair.abx.trialGroup, testPair.abx.trialGroup);
  assert.notEqual(pair.id, testPair.id);
  assert.deepEqual([...order].sort(), [0, 1]);
  assert.ok(target === 0 || target === 1);
  assert.ok(pair.words.every(word => key(word.text) !== key(testPair.words[target].text)));
  assert.equal(pair.words[target].phonemes[pair.abx.targetTokenIndex], ['u', 'y'][target]);
  assert.equal(testPair.words[target].phonemes[testPair.abx.targetTokenIndex], ['u', 'y'][target]);
  assert.equal(pair.words[1 - target].phonemes[pair.abx.targetTokenIndex], ['u', 'y'][1 - target]);
  assert.notEqual(referenceVoiceId, testVoiceId);
  assert.ok(voices.includes(referenceVoiceId) && voices.includes(testVoiceId));
  assert.equal(set.targetSoundFocus, set.abx.targetSoundFocus);
  return `${pair.id}|${testPair.id}|${target}|${order.indexOf(target)}|${referenceVoiceId}`;
}
const sessions = [];
for (const scope of [...sets.map(set => ({ id: set.id, pairs: set.pairs })), { id: 'mixed-engine-only', pairs: allPairs }]) {
  const observed = new Set();
  let questions = 0, revisitChecks = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const queue = assignSessionVoices(buildSession(scope.pairs, 12, seeded(seed)), voices, seeded(seed + 1000));
    assert.equal(queue.length, 12);
    for (const question of queue) { observed.add(check(question)); questions++; }
    for (let answeredIndex = 0; answeredIndex < 9; answeredIndex++) {
      const revised = revisitMistake(queue, answeredIndex);
      revised.forEach(check);
      assert.deepEqual(revised.map(q => [q.target, q.order, q.referenceVoiceId, q.testVoiceId]), queue.map(q => [q.target, q.order, q.referenceVoiceId, q.testVoiceId]));
      revisitChecks++;
    }
  }
  const expectedCells = scope.pairs.length * 2 * 2 * 2 * 2;
  assert.equal(observed.size, expectedCells);
  sessions.push({ scope: scope.id, sessions: 50, questions, observedCells: observed.size, expectedCells, revisitChecks });
}
// Force every legal reference/X/category/answer/profile choice through the real engine.
let forcedMappings = 0;
for (const set of sets) for (const pair of set.pairs) for (const xPair of set.pairs.filter(p => p.id !== pair.id)) {
  for (const target of [0, 1]) for (const answer of [0, 1]) for (const referenceProfile of [0, 1]) {
    const draws = [0.9, target ? 0.8 : 0.2, answer ? 0.8 : 0.2, 0.25];
    const [question] = assignSessionVoices(buildSession([pair, xPair], 1, () => draws.shift()), voices, () => referenceProfile ? 0.8 : 0.2);
    assert.equal(question.pair.id, pair.id);
    assert.equal(question.testPair.id, xPair.id);
    assert.equal(question.target, target);
    assert.equal(question.order.indexOf(target), answer);
    assert.equal(question.referenceVoiceId, voices[referenceProfile]);
    check(question); forcedMappings++;
  }
}
const valid = assignSessionVoices(buildSession(sets[0].pairs, 1, seeded(3)), voices, seeded(7))[0];
const negativeControls = [
  ['X repeats reference pair', q => { q.testPair = q.pair; }],
  ['X comes from wrong focus set', q => { q.testPair = sets[1].pairs[0]; }],
  ['same voice for references and X', q => { q.testVoiceId = q.referenceVoiceId; }],
  ['X uses reference word token index', q => { q.testPair.abx.targetTokenIndex = 0; }],
].map(([name, mutate]) => {
  const q = structuredClone(valid); mutate(q);
  assert.throws(() => check(q));
  return { name, rejected: true };
});
const result = {
  checkedAt: new Date().toISOString(), passed: true,
  candidateSha256: sha(candidateUrl), engineSha256: sha(engineUrl),
  sessions, forcedMappings, negativeControls,
  limitations: [
    'No app content import, playback, rendering, real profile coverage or listening review.',
    'The engine preserves groups. Current Trainer focus is contrast-wide; a mixed revisit must implement per-reference-set focus before release.',
    'Both words in each pair must retain the declared category ordering. Engine metadata does not repair incorrectly ordered content.',
  ],
};
writeFileSync(new URL('./engine-validation.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

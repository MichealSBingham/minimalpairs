import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assignSessionVoices, buildSession, revisitMistake } from '../src/lib/practice-engine.ts';

const pairs = Array.from({ length: 5 }, (_, index) => ({ id: `pair-${index}`, kind: 'minimal', words: [{ text: `a${index}`, ipa: '', meaning: '' }, { text: `b${index}`, ipa: '', meaning: '' }] }));
function seeded(seed) { let state = seed; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; }; }
const normalize = text => text.normalize('NFC').trim().toLowerCase();
const scheduledChoices = queue => queue.map(({ target, order, referenceVoiceId, testVoiceId }) => ({ target, order, referenceVoiceId, testVoiceId }));
function cellCounts(queue) {
  return queue.reduce((cells, question) => {
    const answer = question.order.indexOf(question.target);
    const key = `${question.referenceVoiceId}/${answer}/${question.target}`;
    cells[key] = (cells[key] || 0) + 1; return cells;
  }, {});
}

test('cross-word sessions cover reference pairs and use a different word for X', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const queue = buildSession(pairs, 12, seeded(seed));
    assert.equal(queue.length, 12);
    assert.equal(new Set(queue.slice(0, pairs.length).map(question => question.pair.id)).size, pairs.length);
    const counts = pairs.map(pair => queue.filter(question => question.pair.id === pair.id).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    for (let index = 1; index < queue.length; index++) assert.notEqual(queue[index].pair.id, queue[index - 1].pair.id);
    for (const question of queue) {
      assert.deepEqual([...question.order].sort(), [0, 1]);
      assert.notEqual(question.pair.id, question.testPair.id);
      assert.ok(question.pair.words.every(word => normalize(word.text) !== normalize(question.testPair.words[question.target].text)));
    }
  }
});

test('target category and correct reference use separate draws', () => {
  for (const target of [0, 1]) for (const answer of [0, 1]) {
    // One shuffle draw, then the independent category and answer draws.
    const draws = [0.1, target ? 0.8 : 0.2, answer ? 0.8 : 0.2, 0.1];
    const question = buildSession(pairs.slice(0, 2), 1, () => draws.shift() ?? 0.1)[0];
    assert.equal(question.target, target);
    assert.equal(question.order.indexOf(question.target), answer);
  }
});

test('voice draws ignore target category, answer position and content', () => {
  const queue = buildSession(pairs, 12, seeded(5));
  const changed = queue.map(question => ({ ...question, target: 1 - question.target, order: [...question.order].reverse(), pair: pairs[0], testPair: pairs[1] }));
  const voices = ['one', 'two', 'three', 'four'];
  const originalVoices = assignSessionVoices(queue, voices, seeded(18));
  const changedVoices = assignSessionVoices(changed, voices, seeded(18));
  const identities = items => items.map(({ referenceVoiceId, testVoiceId }) => [referenceVoiceId, testVoiceId]);
  assert.deepEqual(identities(originalVoices), identities(changedVoices));
  for (const question of originalVoices) {
    assert.notEqual(question.referenceVoiceId, question.testVoiceId);
    assert.ok(voices.includes(question.referenceVoiceId));
    assert.ok(voices.includes(question.testVoiceId));
  }
  const reassigned = assignSessionVoices(queue, voices, seeded(99));
  const withoutVoices = items => items.map(({ referenceVoiceId, testVoiceId, ...question }) => question);
  assert.deepEqual(withoutVoices(reassigned), queue);
});

test('the entire voice pool is eligible and X draws independently from the other voices', () => {
  const question = buildSession(pairs, 1, seeded(5))[0];
  const voices = ['one', 'two', 'three', 'four'];
  for (let reference = 0; reference < voices.length; reference++) {
    const alternatives = voices.filter((_, index) => index !== reference);
    for (let x = 0; x < alternatives.length; x++) {
      const draws = [(reference + 0.5) / voices.length, (x + 0.5) / alternatives.length];
      const result = assignSessionVoices([question], voices, () => draws.shift())[0];
      assert.equal(result.referenceVoiceId, voices[reference]);
      assert.equal(result.testVoiceId, alternatives[x]);
    }
  }
});

test('answer, category and voice totals are not fixed quotas', () => {
  const answerTotals = new Set(), categoryTotals = new Set(), voiceTotals = new Set();
  const nextAnswers = new Map();
  let repeatedSameCategory = false;
  for (let seed = 1; seed <= 1000; seed++) {
    const queue = assignSessionVoices(buildSession(pairs.slice(0, 2), 12, seeded(seed)), ['one', 'two'], seeded(seed + 500));
    const answers = queue.map(question => question.order.indexOf(question.target));
    answerTotals.add(answers.filter(answer => answer === 0).length);
    categoryTotals.add(queue.filter(question => question.target === 0).length);
    voiceTotals.add(queue.filter(question => question.referenceVoiceId === 'one').length);
    const prefix = answers.slice(0, 4).join('');
    const following = nextAnswers.get(prefix) || new Set();
    following.add(answers[4]); nextAnswers.set(prefix, following);
    const targets = queue.filter(question => question.pair.id === pairs[0].id).map(question => question.target);
    if (targets.some((target, index) => index > 0 && targets[index - 1] === target)) repeatedSameCategory = true;
  }
  for (const totals of [answerTotals, categoryTotals, voiceTotals]) assert.ok(totals.size >= 8);
  assert.equal(nextAnswers.size, 16);
  for (const following of nextAnswers.values()) assert.deepEqual([...following].sort(), [0, 1]);
  assert.ok(repeatedSameCategory, 'An earlier category cannot mandate a later flip');
});

test('mistake review preserves completed rounds and every future answer and voice draw', () => {
  const queue = assignSessionVoices(buildSession(pairs, 12, seeded(1)), ['one', 'two'], seeded(2));
  const original = JSON.stringify(queue);
  const next = revisitMistake(queue, 2, 3);
  assert.equal(next.length, 12);
  assert.deepEqual(next.slice(0, 5), queue.slice(0, 5));
  const expectedIndex = queue.findIndex((question, index) => index >= 5 && question.target === queue[2].target);
  assert.ok(expectedIndex >= 5);
  assert.equal(next[expectedIndex].pair.id, queue[2].pair.id);
  assert.equal(next[expectedIndex].testPair.id, queue[2].testPair.id);
  assert.equal(next[expectedIndex].target, queue[2].target);
  assert.deepEqual(cellCounts(next), cellCounts(queue));
  assert.deepEqual(scheduledChoices(next), scheduledChoices(queue));
  assert.equal(JSON.stringify(queue), original);
});

test('late mistakes never extend the session or overwrite completed work', () => {
  const queue = buildSession(pairs, 12, seeded(20));
  assert.deepEqual(revisitMistake(queue, 10, 3), queue);
  assert.deepEqual(revisitMistake(queue, -1, 3), queue);
});

test('insufficient content cannot silently fall back to same-word identification', () => {
  assert.deepEqual(buildSession([]), []);
  assert.deepEqual(buildSession(pairs, 0), []);
  assert.deepEqual(buildSession(pairs.slice(0, 1)), []);
  const sameWords = pairs.slice(0, 2).map((pair, index) => ({ ...pair, id: `same-${index}`, words: pairs[0].words }));
  assert.deepEqual(buildSession(sameWords), []);
  assert.equal(buildSession(pairs, 3).length, 3);
});

test('repeated spellings are excluded from X even with case, spacing or Unicode differences', () => {
  const overlapping = [
    { ...pairs[0], id: 'one', words: [{ text: 'Shared', ipa: '', meaning: '' }, { text: 'first', ipa: '', meaning: '' }] },
    { ...pairs[0], id: 'two', words: [{ text: ' shared ', ipa: '', meaning: '' }, { text: 'second', ipa: '', meaning: '' }] },
    { ...pairs[0], id: 'three', words: [{ text: 'third', ipa: '', meaning: '' }, { text: 'fourth', ipa: '', meaning: '' }] },
  ];
  for (const question of buildSession(overlapping, 12, seeded(12))) {
    const x = normalize(question.testPair.words[question.target].text);
    assert.ok(question.pair.words.every(word => normalize(word.text) !== x));
  }
});

test('all curated contrasts produce cross-word ABX with target position/trial group preserved', () => {
  const data = JSON.parse(readFileSync(new URL('../../content/curriculum.json', import.meta.url), 'utf8'));
  const languages = Array.isArray(data) ? data : data.languages;
  assert.equal(languages.length, 8);
  for (const language of languages) for (const contrast of language.contrasts) {
    for (let seed = 1; seed <= 12; seed++) {
      const queue = buildSession(contrast.pairs, 12, seeded(seed));
      assert.equal(queue.length, 12, `${language.id}/${contrast.id} needs distinct eligible X words`);
      for (const question of queue) {
        assert.equal(question.pair.abx?.trialGroup || 'all', question.testPair.abx?.trialGroup || 'all');
        assert.notEqual(question.pair.id, question.testPair.id);
        assert.ok(question.pair.words.every(word => normalize(word.text) !== normalize(question.testPair.words[question.target].text)));
        assert.deepEqual(question.pair.abx?.categoryByWordIndex, [0, 1]);
        assert.deepEqual(question.testPair.abx?.categoryByWordIndex, [0, 1]);
      }
    }
  }
});

test('no synthetic identity claims or extra voices are invented', () => {
  const queue = buildSession(pairs, 12, seeded(5));
  assert.ok(assignSessionVoices(queue, []).every(question => question.referenceVoiceId === undefined && question.testVoiceId === undefined));
  assert.ok(assignSessionVoices(queue, ['only']).every(question => question.referenceVoiceId === 'only' && question.testVoiceId === 'only'));
  const varied = assignSessionVoices(queue, ['a', 'b', 'c', 'd'], seeded(3));
  assert.ok(new Set(varied.flatMap(question => [question.referenceVoiceId, question.testVoiceId])).size > 2);
  assert.ok(varied.every(question => ['a', 'b', 'c', 'd'].includes(question.referenceVoiceId)));
});

test('cumulative mistake revisits preserve cross-word categories and independent answer/voice draws', () => {
  const data = JSON.parse(readFileSync(new URL('../../content/curriculum.json', import.meta.url), 'utf8'));
  const languages = Array.isArray(data) ? data : data.languages;
  for (const language of languages) for (const contrast of language.contrasts) {
    for (let seed = 1; seed <= 30; seed++) {
      let queue = assignSessionVoices(buildSession(contrast.pairs, 12, seeded(seed)), ['voice-a', 'voice-b', 'voice-c', 'voice-d'], seeded(seed + 90));
      const originalCells = cellCounts(queue);
      const originalChoices = scheduledChoices(queue);
      // Every round is treated as a mistake, including previously scheduled revisits.
      for (let answered = 0; answered < 12; answered++) {
        const before = queue;
        queue = revisitMistake(queue, answered);
        assert.deepEqual(queue.slice(0, answered + 1), before.slice(0, answered + 1));
        assert.deepEqual(cellCounts(queue), originalCells);
        assert.deepEqual(scheduledChoices(queue), originalChoices);
        for (const question of queue) {
          assert.equal(question.pair.abx?.trialGroup || 'all', question.testPair.abx?.trialGroup || 'all');
          assert.equal(question.pair.abx.categoryByWordIndex[question.order[question.order.indexOf(question.target)]], question.testPair.abx.categoryByWordIndex[question.target]);
          assert.ok(question.pair.words.every(word => normalize(word.text) !== normalize(question.testPair.words[question.target].text)));
          assert.notEqual(question.referenceVoiceId, question.testVoiceId);
        }
      }
    }
  }
});

test('an X word and voice combination has no permanent correct A/B label across sessions', () => {
  const answersByRecording = new Map();
  for (let seed = 1; seed <= 100; seed++) {
    const queue = assignSessionVoices(buildSession(pairs, 12, seeded(seed)), ['one', 'two'], seeded(seed + 400));
    for (const question of queue) {
      const recordingKey = `${question.testPair.words[question.target].text}/${question.testVoiceId}`;
      const answers = answersByRecording.get(recordingKey) || new Set();
      answers.add(question.order.indexOf(question.target)); answersByRecording.set(recordingKey, answers);
    }
  }
  assert.equal(answersByRecording.size, pairs.length * 2 * 2);
  for (const answers of answersByRecording.values()) assert.deepEqual([...answers].sort(), [0, 1]);
});

test('insufficient matching-position examples cannot borrow X from another trial group', () => {
  const grouped = pairs.slice(0, 3).map((pair, index) => ({ ...pair, abx: { trialGroup: index === 0 ? 'initial' : 'final', categoryByWordIndex: [0, 1] } }));
  const queue = buildSession(grouped, 12, seeded(6));
  assert.equal(queue.length, 12);
  assert.ok(queue.every(question => question.pair.abx.trialGroup === 'final' && question.testPair.abx.trialGroup === 'final'));
  assert.deepEqual(buildSession(grouped.slice(0, 2), 12, seeded(6)), []);
});

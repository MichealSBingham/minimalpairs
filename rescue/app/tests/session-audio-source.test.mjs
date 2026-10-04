import test from 'node:test';
import assert from 'node:assert/strict';
import { getVoices } from '../src/lib/audio.ts';
import { assignSessionVoices, buildSession } from '../src/lib/practice-engine.ts';
import { actualSessionAudioCollection, fallbackAudioSourceLabel, DEVICE_AUDIO_COLLECTION, MIXED_AUDIO_COLLECTION, UNKNOWN_AUDIO_COLLECTION } from '../src/lib/session-audio-source.ts';
import { createListeningPlan, derivePlanProgress } from '../src/lib/listening-plan.ts';
import { recommendReview } from '../src/lib/review-recommendation.ts';
import { normalizeSession } from '../src/lib/progress-data.ts';
import { measurementData } from '../src/lib/measurement-data.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-28T12:00:00Z');
const pairs = ['one', 'two'].map(id => ({ id, words: [{ text: `${id}-a` }, { text: `${id}-b` }] }));
const languages = [{ id: 'fr', name: 'French', audioCollectionId: 'qwen-starter-v1', contrasts: ['fr-first', 'fr-second'].map(id => ({ id, label: id, soundLabel: id, pairs, profileCount: 2, reviewed: false })) }];
const plan = createListeningPlan(languages, 'fr', 'fr-first', { id: 'source-check', now: NOW - 12 * DAY });
const session = (id, days, audioCollectionId, contrastId = 'fr-first') => ({ id, mode: 'abx-cross-word', schemaVersion: 2,
  audioCollectionId, textHintsUsed: false, completedAt: new Date(NOW - days * DAY).toISOString(), languageId: 'fr', contrastId,
  correct: 0, total: 12, mistakes: Array.from({ length: 12 }, () => ({ pairId: 'one', word: 'one-a', chosenWord: 'one-b' })) });

test('selected cached profiles preserve ordinary, comparison and human-pilot identities', () => {
  for (const collection of ['qwen-starter-v1', 'comparison-human-v1', 'comparison-fixed-reference-v1', 'human-fr-u-y-v1']) {
    assert.equal(actualSessionAudioCollection(collection, ['cached-a', 'cached-b']), collection);
  }
});

test('device, mixed and incomplete queues cannot masquerade as the requested cached collection', () => {
  assert.equal(actualSessionAudioCollection('qwen-starter-v1', ['device:one', 'device:two']), DEVICE_AUDIO_COLLECTION);
  assert.equal(actualSessionAudioCollection('human-fr-u-y-v1', ['device:one']), DEVICE_AUDIO_COLLECTION);
  assert.equal(actualSessionAudioCollection('qwen-starter-v1', ['cached-a', 'device:one']), MIXED_AUDIO_COLLECTION);
  for (const voices of [[], [undefined], [''], ['device:'], ['cached-a', undefined]]) {
    assert.equal(actualSessionAudioCollection('qwen-starter-v1', voices), UNKNOWN_AUDIO_COLLECTION);
  }
  assert.equal(actualSessionAudioCollection('../bad-source', ['cached-a']), UNKNOWN_AUDIO_COLLECTION);
  assert.equal(actualSessionAudioCollection(DEVICE_AUDIO_COLLECTION, ['cached-a']), UNKNOWN_AUDIO_COLLECTION);
});

test('actual default-manifest failure produces device history excluded from the plan and review', async t => {
  const descriptors = ['window', 'speechSynthesis', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, descriptor] of descriptors) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const speech = { getVoices: () => [{ voiceURI: 'fr-preview', name: 'Device French', lang: 'fr-FR' }] };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { speechSynthesis: speech } });
  Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: speech });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({ ok: false }) });
  const voices = await getVoices('fr', undefined, pairs.flatMap(pair => pair.words.map(word => word.text)));
  assert.equal(voices[0].source, 'device');
  const queue = assignSessionVoices(buildSession(pairs, 12), voices.map(voice => voice.id));
  const actual = actualSessionAudioCollection('qwen-starter-v1', queue.flatMap(item => [item.referenceVoiceId, item.testVoiceId]));
  assert.equal(actual, DEVICE_AUDIO_COLLECTION);
  const history = [session('first', 9, actual), session('return', 6, actual), session('explore', 3, actual, 'fr-second')];
  assert.equal(derivePlanProgress(plan, history, NOW).completed, 0);
  assert.equal(recommendReview(languages, history, { now: NOW }).kind, 'start');
  assert.equal(normalizeSession(history[0]).audioCollectionId, DEVICE_AUDIO_COLLECTION, 'Device practice remains valid saved history');
  assert.equal(fallbackAudioSourceLabel(actual), 'Device voice preview');
  const measured = measurementData('practice_start', { language_id: 'fr', contrast_id: 'fr-first', audio_collection: actual, attempt_id: '00000000-0000-4000-8000-000000000001' });
  assert.equal(measured.audio_collection, DEVICE_AUDIO_COLLECTION);
});

test('mixed or unconfirmed sessions neither fill a plan slot nor postpone an ordinary review', () => {
  const ordinary = [session('one', 9, 'qwen-starter-v1'), session('two', 6, 'qwen-starter-v1'), session('three', 3, 'qwen-starter-v1')];
  for (const actual of [DEVICE_AUDIO_COLLECTION, MIXED_AUDIO_COLLECTION, UNKNOWN_AUDIO_COLLECTION]) {
    const excluded = [session('preview-one', 2, actual), session('preview-two', 1, actual), session('preview-three', 0, actual, 'fr-second')];
    assert.equal(derivePlanProgress(plan, excluded, NOW).completed, 0);
    assert.equal(derivePlanProgress(plan, [...ordinary, ...excluded], NOW).completed, 2, 'Excluded explore cannot finish the ordinary plan');
    const result = recommendReview(languages, [...ordinary, ...excluded], { now: NOW });
    assert.equal(result.kind, 'review-due');
    assert.ok(result.reason.includes('3 days'), 'Excluded recent practice must not restart the ordinary review interval');
    assert.equal(normalizeSession(excluded[0]).audioCollectionId, actual);
    assert.ok(fallbackAudioSourceLabel(actual));
  }
});

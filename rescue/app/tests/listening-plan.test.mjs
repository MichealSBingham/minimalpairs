import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildListeningPlanCatalog, getListeningPlanCatalog } from '../src/lib/listening-plan-catalog.ts';
import { createListeningPlan, derivePlanProgress, LISTENING_PLAN_KEY, loadListeningPlan, normalizeListeningPlan, planIsAvailable, planPracticeHref, saveListeningPlan } from '../src/lib/listening-plan.ts';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const HOUR = 3_600_000;
const catalog = ['fr', 'es'].map(id => ({ id, name: id === 'fr' ? 'French' : 'Spanish', audioCollectionId: 'qwen-starter-v1', contrasts: [1, 2, 3].map(index => ({ id: `${id}-${index}`, soundLabel: `Sound contrast 0${index}`, profileCount: 2, reviewed: false })) }));
const plan = () => createListeningPlan(catalog, 'fr', 'fr-1', { id: 'plan-1', now: NOW });
const session = (id, hour, contrastId = 'fr-1', extra = {}) => ({ id, mode: 'abx-cross-word', schemaVersion: 2, audioCollectionId: 'qwen-starter-v1', languageId: 'fr', contrastId, completedAt: new Date(NOW + hour * HOUR).toISOString(), correct: 12, total: 12, mistakes: [], textHintsUsed: false, ...extra });
const progress = history => derivePlanProgress(plan(), history, NOW + 100 * HOUR);
function memoryStorage() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; }

test('creation freezes an explicit language, starting sound, revisit and different sound with exact links', () => {
  assert.equal(createListeningPlan(catalog, '', '', { id: 'plan', now: NOW }), null);
  assert.equal(createListeningPlan(catalog, 'removed', 'fr-1', { id: 'plan', now: NOW }), null);
  assert.equal(createListeningPlan(catalog, 'fr', 'removed', { id: 'plan', now: NOW }), null);
  const selected = createListeningPlan(catalog, 'es', 'es-2', { id: 'explicit-plan', now: NOW });
  assert.equal(selected.languageId, 'es');
  assert.equal(selected.audioCollectionId, 'qwen-starter-v1');
  assert.deepEqual(selected.slots.map(slot => slot.contrastId), ['es-2', 'es-2', 'es-1']);
  assert.equal(planPracticeHref(selected, 1), '/practice?language=es&contrast=es-2');
  assert.equal(planPracticeHref(selected, 3), null);
  assert.equal(createListeningPlan([{ ...catalog[0], contrasts: catalog[0].contrasts.slice(0, 1) }], 'fr', 'fr-1', { id: 'plan', now: NOW }), null);
});

test('three valid chronological sessions complete the plan and preserve assistance and elapsed time', () => {
  const result = progress([session('one', 1), session('two', 26, 'fr-1', { textHintsUsed: true }), session('three', 50, 'fr-2', { textHintsUsed: undefined })]);
  assert.equal(result.completed, 3);
  assert.equal(result.nextIndex, null);
  assert.deepEqual(result.completions.map(item => item.sessionId), ['one', 'two', 'three']);
  assert.deepEqual(result.completions.map(item => item.textHintsUsed), [false, true, undefined]);
  assert.deepEqual(result.completions.map(item => item.elapsedSincePrevious), [null, 25 * HOUR, 24 * HOUR]);
});

test('same-day practice counts without manufacturing a later-day revisit or locking progress', () => {
  const result = progress([session('one', 0.1), session('two', 0.2), session('three', 0.3, 'fr-2')]);
  assert.equal(result.completed, 3);
  assert.equal(result.completions[1].elapsedSincePrevious, 0.1 * HOUR);
});

test('old, simultaneous-with-creation and future completions do not count', () => {
  assert.equal(progress([session('old', -1), session('created', 0), session('future', 101)]).completed, 0);
  assert.equal(derivePlanProgress(plan(), [session('one', 1)], NOW - 1).completed, 0);
  assert.equal(derivePlanProgress(plan(), [session('one', 1)], NaN).completed, 0);
});

test('source, language and old identification results cannot fill plan slots', () => {
  const invalid = [
    session('comparison', 1, 'fr-1', { audioCollectionId: 'comparison-generated-v1' }),
    session('human', 2, 'fr-1', { audioCollectionId: 'human-fr-u-y-v1' }),
    session('unknown', 3, 'fr-1', { audioCollectionId: undefined }),
    session('future-version', 4, 'fr-1', { audioCollectionId: 'qwen-starter-v2' }),
    session('language', 5, 'fr-1', { languageId: 'es' }),
    session('identification', 6, 'fr-1', { mode: 'word-identification' }),
  ];
  assert.equal(progress(invalid).completed, 0);
  assert.equal(progress([...invalid, session('valid', 7)]).completed, 1);
});

test('partial or malformed completed-session records cannot be counted', () => {
  const invalid = [session('partial', 1, 'fr-1', { total: 4, correct: 4 }), session('score', 2, 'fr-1', { correct: 13 }), session('assistance', 3, 'fr-1', { textHintsUsed: 'false' }), session('mistakes', 4, 'fr-1', { correct: 4, mistakes: [] }), session('schema', 5, 'fr-1', { schemaVersion: 1 }), { id: 'not-a-session' }];
  assert.equal(progress(invalid).completed, 0);
  const lower = session('lower', 6, 'fr-1', { correct: 10, mistakes: [{ pairId: 'pair-1', word: 'one', chosenWord: 'two' }, { pairId: 'pair-2', word: 'one', chosenWord: 'two' }] });
  assert.equal(progress([...invalid, lower]).completed, 1);
});

test('chronological order is independent of input order and does not backfill a later slot', () => {
  const records = [session('too-early-explore', 1, 'fr-2'), session('first', 2), session('second', 3), session('third', 4, 'fr-2')];
  assert.deepEqual(progress(records.reverse()).completions.map(item => item?.sessionId), ['first', 'second', 'third']);
  assert.equal(progress([session('too-early-explore', 1, 'fr-2'), session('first', 2), session('second', 3)]).completed, 2);
});

test('duplicate IDs and ambiguous simultaneous records cannot count twice', () => {
  const first = session('one', 1);
  assert.equal(progress([first, first, session('same-time', 1)]).completed, 1);
  assert.equal(progress([first, { ...first, completedAt: new Date(NOW + 2 * HOUR).toISOString() }]).completed, 0);
});

test('a newly saved week starts over without reusing earlier completed history', () => {
  const history = [session('one', 1), session('two', 2), session('three', 3, 'fr-2')];
  const next = createListeningPlan(catalog, 'fr', 'fr-2', { id: 'next-plan', now: NOW + 4 * HOUR });
  assert.equal(derivePlanProgress(next, history, NOW + 5 * HOUR).completed, 0);
  assert.equal(derivePlanProgress(next, [...history, session('new', 6, 'fr-2')], NOW + 7 * HOUR).completed, 1);
});

test('stored plans round-trip and invalid/corrupt data never becomes an active plan', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadListeningPlan(storage), { plan: null, error: null });
  saveListeningPlan(storage, plan());
  assert.deepEqual(loadListeningPlan(storage), { plan: plan(), error: null });
  storage.setItem(LISTENING_PLAN_KEY, '{bad json');
  assert.equal(loadListeningPlan(storage).plan, null);
  assert.ok(loadListeningPlan(storage).error);
  for (const invalid of [{ ...plan(), schemaVersion: 2 }, { ...plan(), audioCollectionId: 'comparison-human-v1' }, { ...plan(), slots: plan().slots.slice(0, 2) }, { ...plan(), slots: [plan().slots[0], { ...plan().slots[1], contrastId: 'fr-2' }, plan().slots[2]] }]) assert.equal(normalizeListeningPlan(invalid), null);
});

test('read, write and silent storage failure are surfaced without a success result', () => {
  assert.ok(loadListeningPlan({ getItem() { throw new Error('blocked'); } }).error);
  assert.throws(() => saveListeningPlan({ getItem() { return null; }, setItem() { throw new Error('quota'); } }, plan()), /could not save/);
  assert.throws(() => saveListeningPlan({ getItem() { return null; }, setItem() {} }, plan()), /could not save/);
});

test('a removed contrast or collection disables the frozen plan instead of silently substituting', () => {
  assert.equal(planIsAvailable(plan(), catalog), true);
  assert.equal(planIsAvailable(plan(), [{ ...catalog[0], contrasts: catalog[0].contrasts.filter(item => item.id !== 'fr-2') }]), false);
  assert.equal(planIsAvailable(plan(), [{ ...catalog[0], audioCollectionId: 'qwen-starter-v2' }]), false);
});

const fakeLanguages = [{ id: 'fr', name: 'French', contrasts: [1, 2, 3, 4].map(index => ({ id: `fr-${index}`, pairs: [1, 2].map(pair => ({ id: `pair-${index}-${pair}`, words: [{ text: `${index}-${pair}-a` }, { text: `${index}-${pair}-b` }] })) })) }];
const fakeManifest = () => ({ voicesByLanguage: { fr: [{ id: 'a' }, { id: 'b' }] }, clips: fakeLanguages[0].contrasts.flatMap(contrast => contrast.pairs.flatMap(pair => pair.words.flatMap(word => ['a', 'b'].map(voiceId => ({ languageId: 'fr', voiceId, text: word.text, url: `/audio/${word.text}-${voiceId}.mp3`, status: 'generated-unreviewed' }))))) });

test('catalog requires two complete profiles and excludes device-only, rejected and missing-file coverage', () => {
  const manifest = fakeManifest();
  manifest.clips = manifest.clips.filter(clip => !(clip.text === '1-1-a' && clip.voiceId === 'b'));
  for (const clip of manifest.clips) if (clip.text === '2-1-a') clip.status = 'rejected';
  const result = buildListeningPlanCatalog(fakeLanguages, manifest, () => true);
  assert.deepEqual(result[0].contrasts.map(item => [item.id, item.profileCount, item.reviewed]), [['fr-3', 2, false], ['fr-4', 2, false]]);
  assert.deepEqual(buildListeningPlanCatalog(fakeLanguages, manifest, url => !url.includes('3-1-a')), []);
  assert.deepEqual(buildListeningPlanCatalog(fakeLanguages, { voicesByLanguage: {}, clips: [] }, () => true), []);
});

test('catalog does not offer a contrast with no cross-word ABX candidate', () => {
  const incomplete = structuredClone(fakeLanguages);
  incomplete[0].contrasts[0].pairs = incomplete[0].contrasts[0].pairs.slice(0, 1);
  const result = buildListeningPlanCatalog(incomplete, fakeManifest(), () => true);
  assert.deepEqual(result[0].contrasts.map(item => item.id), ['fr-2', 'fr-3', 'fr-4']);
});

test('the current build catalog offers all eight languages and no source-incomplete contrast', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../../content/curriculum.json', import.meta.url), 'utf8'));
  const actual = getListeningPlanCatalog(data.languages || data);
  assert.equal(actual.length, 8);
  for (const language of actual) {
    assert.ok(language.contrasts.length >= 2);
    assert.equal(language.audioCollectionId, 'qwen-starter-v1');
    assert.ok(language.contrasts.every(contrast => contrast.profileCount >= 2));
  }
  assert.ok(actual.every(language => language.contrasts.every(contrast => !contrast.reviewed)), 'Current generated preview has no pronunciation-reviewed contrasts.');
});

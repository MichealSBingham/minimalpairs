import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ownerEnglishLanguages, ownerEnglishScopes, ownerEnglishHistoryHref, OWNER_ENGLISH_COLLECTION, OWNER_ENGLISH_MANIFEST } from '../src/lib/owner-audio-preview.ts';
import { assignSessionVoices, buildSession } from '../src/lib/practice-engine.ts';
import { recommendReview } from '../src/lib/review-recommendation.ts';
import { createListeningPlan, derivePlanProgress, PLAN_AUDIO_COLLECTION } from '../src/lib/listening-plan.ts';

const app = path.resolve(import.meta.dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(app, file), 'utf8'));
const main = read('../content/curriculum.json').languages;
const languages = ownerEnglishLanguages(main);
const manifest = read(`public${OWNER_ENGLISH_MANIFEST}`);
const handoff = '../audio/fixed-reference-expansion/owner-validation-handoff-2026-09-28';
const inventory = read(`${handoff}/integration-inventory.json`);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

test('owner preview copies exactly 34 selected files and two sanitized metadata files', () => {
  assert.equal(manifest.collectionId, OWNER_ENGLISH_COLLECTION);
  assert.equal(manifest.clips.length, 34);
  assert.deepEqual(read(`public${OWNER_ENGLISH_MANIFEST}`), read(`${handoff}/manifest.preview.json`));
  assert.deepEqual(read('public/audio/fixed-reference-expansion/reference-provenance.json'), read(`${handoff}/references.public.json`));
  assert.deepEqual(fs.readdirSync(path.join(app, 'public/audio/fixed-reference-expansion')).sort(), ['clips', 'manifest.json', 'reference-provenance.json']);
  assert.deepEqual(fs.readdirSync(path.join(app, 'public/audio/fixed-reference-expansion/clips')).sort(), inventory.copyAllowlist.map(clip => path.basename(clip.destinationUrl)).sort());
  let bytes = 0;
  for (const selected of inventory.copyAllowlist) {
    const data = fs.readFileSync(path.join(app, 'public', selected.destinationUrl));
    assert.equal(sha(data), selected.sha256); assert.equal(data.length, selected.bytes); bytes += data.length;
    assert.equal(manifest.clips.find(clip => clip.url === selected.destinationUrl).sha256, selected.sha256);
  }
  assert.equal(bytes, 687896);
  assert.doesNotMatch(JSON.stringify(manifest), /\/Users\/|private\/|sourcePath|privateReferencePath/);
  assert.equal(read('public/audio/fixed-reference-expansion/reference-provenance.json').rawReferenceAudioIncluded, false);
  assert.equal(read('public/audio/manifest.json').clips.some(clip => clip.url.startsWith('/audio/fixed-reference-expansion/')), false);
});

test('exact scopes and unresolved special readings are preserved without editing the curriculum', () => {
  const before = JSON.stringify(main); ownerEnglishLanguages(main); assert.equal(JSON.stringify(main), before);
  assert.deepEqual(languages.map(language => language.id), ['en']);
  assert.deepEqual(languages[0].contrasts.map(contrast => [contrast.id, contrast.pairs.map(pair => pair.id)]), ownerEnglishScopes.map(scope => [scope.contrastId, [...scope.pairIds]]));
  assert.equal(manifest.phoneticListeningVerified, false); assert.equal(manifest.speakerConsistencyVerified, false); assert.equal(manifest.defaultReplacementApproved, false);
  assert.ok(manifest.clips.every(clip => clip.synthetic === true && clip.status === 'generated-unreviewed' && clip.assessmentApproved === false));
  const lesion = manifest.clips.find(clip => clip.text === 'lesion' && clip.voiceId.includes('-b-'));
  assert.equal(lesion.ttsText, 'Lesion.'); assert.equal(lesion.generationSettings.text, 'Lesion.'); assert.equal(lesion.id, '0eab4550dfac495acdc586100824');
  assert.ok(manifest.ownerReviewWarnings.some(note => /cap.*clipping/i.test(note)));
  assert.deepEqual(manifest.conditionalPairs[0].requiredReadings, ['ˈvɝʒən', 'ˈvɝdʒən']);
  const changed = structuredClone(main); changed.find(l => l.id === 'en').contrasts.find(c => c.id === 'en-zh-j').pairs.find(p => p.id === 'en-version-virgin').words[1].ipa = '/ˈvɝdʒɪn/';
  assert.throws(() => ownerEnglishLanguages(changed), /shared-schwa/);
  assert.throws(() => ownerEnglishLanguages([]), /requires/);
});

test('every A/B/X mapping resolves across all three contrasts, different words and profiles', () => {
  const voices = manifest.voicesByLanguage.en.map(voice => voice.id);
  assert.equal(voices.length, 2);
  for (const contrast of languages[0].contrasts) {
    for (const pair of contrast.pairs) for (const word of pair.words) for (const voiceId of voices) {
      const clips = manifest.clips.filter(clip => clip.text === word.text && clip.voiceId === voiceId);
      assert.equal(clips.length, 1); assert.equal(clips[0].targetIPA, word.ipa);
    }
    for (let seed = 1; seed <= 50; seed++) {
      let state = seed; const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      const questions = assignSessionVoices(buildSession(contrast.pairs, 12, random), voices, random);
      assert.equal(questions.length, 12);
      for (const q of questions) {
        assert.notEqual(q.pair.id, q.testPair.id); assert.notEqual(q.referenceVoiceId, q.testVoiceId);
        assert.equal(q.pair.abx.trialGroup, q.testPair.abx.trialGroup);
        const refs = q.order.map(side => q.pair.words[side]); const x = q.testPair.words[q.target];
        assert.ok(refs.every(word => word.text !== x.text));
        for (const [word, voiceId] of [...refs.map(word => [word, q.referenceVoiceId]), [x, q.testVoiceId]]) assert.equal(manifest.clips.filter(clip => clip.text === word.text && clip.voiceId === voiceId).length, 1);
      }
    }
  }
});

test('owner preview history routes to its own source and contributes no ordinary review or plan completion', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const records = [1,2,3].map(day => ({ id: `owner_english_${day}`, mode: 'abx-cross-word', schemaVersion: 2, languageId: 'en', contrastId: 'en-zh-j', audioCollectionId: OWNER_ENGLISH_COLLECTION, textHintsUsed: false, total: 12, correct: 12, mistakes: [], completedAt: new Date(now - day * 86400000).toISOString() }));
  assert.deepEqual(recommendReview(main, records, { languageId: 'en', now }), recommendReview(main, [], { languageId: 'en', now }));
  const catalog = [{ id: 'en', name: 'English', audioCollectionId: PLAN_AUDIO_COLLECTION, contrasts: ownerEnglishScopes.map(scope => ({ id: scope.contrastId, soundLabel: scope.contrastId, profileCount: 2, reviewed: false })) }];
  const plan = createListeningPlan(catalog, 'en', 'en-zh-j', { id: 'plan_owner_test', now: now - 4 * 86400000 });
  assert.equal(derivePlanProgress(plan, records, now).completed, 0);
  for (const scope of ownerEnglishScopes) assert.equal(ownerEnglishHistoryHref(scope.contrastId), `/english-audio-preview?language=en&contrast=${scope.contrastId}`);
  assert.equal(ownerEnglishHistoryHref('fr-u-y'), '/english-audio-preview');
});

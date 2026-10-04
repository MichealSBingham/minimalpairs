import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { humanLibraryLanguages, humanLibraryScopes, HUMAN_LIBRARY_COLLECTION } from '../src/lib/human-library.ts';
import { buildSession, assignSessionVoices } from '../src/lib/practice-engine.ts';
import { normalizeSession } from '../src/lib/progress-data.ts';
import { recommendReview } from '../src/lib/review-recommendation.ts';

const app = path.resolve(import.meta.dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(app, name), 'utf8'));
const curriculum = read('../content/curriculum.json');
const languages = humanLibraryLanguages(curriculum.languages || curriculum);
const manifest = read('public/audio/human-library.json');

test('human library has complete licensed audio for its exact cross-word scopes', () => {
  assert.equal(manifest.collectionId, HUMAN_LIBRARY_COLLECTION);
  assert.equal(manifest.clips.length, 44);
  assert.equal(new Set(manifest.clips.map(c => `${c.languageId}:${c.voiceId}:${c.text}`)).size, 44);
  assert.deepEqual(languages.map(l => [l.id, l.contrasts.length]), [['fr', 1], ['en', 2], ['de', 1]]);
  assert.equal(manifest.phoneticListeningVerified, false);
  for (const language of languages) for (const contrast of language.contrasts) {
    assert.deepEqual(contrast.pairs.map(p => p.id), humanLibraryScopes.find(s => s.contrastId === contrast.id).pairIds);
    assert.equal(buildSession(contrast.pairs, 12).length, 12);
    assert.equal(manifest.voicesByLanguage[language.id].length, 2);
    for (const voice of manifest.voicesByLanguage[language.id]) for (const word of contrast.pairs.flatMap(p => p.words)) {
      const clips = manifest.clips.filter(c => c.languageId === language.id && c.voiceId === voice.id && c.text === word.text);
      assert.equal(clips.length, 1);
      const clip = clips[0];
      assert.equal(clip.synthetic, false);
      assert.equal(clip.status, 'source-verified-unreviewed');
      assert.equal(clip.phoneticListeningVerified, false);
      const bytes = fs.readFileSync(path.join(app, 'public', clip.url.slice(1)));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), clip.sha256);
    }
  }
});

test('German stays an exact isolated two-pair curriculum with no invented or mixed recordings', () => {
  const main = curriculum.languages || curriculum;
  const before = JSON.stringify(main);
  const candidate = read('../audio/human-german-pilot/curriculum.candidate.json');
  const german = humanLibraryLanguages(main).find(language => language.id === 'de');
  assert.equal(JSON.stringify(main), before);
  assert.equal(main.find(language => language.id === 'de').contrasts.some(contrast => contrast.id === 'de-i-length-pronouns'), false);
  assert.deepEqual(german.contrasts, candidate.languages[0].contrasts);
  assert.equal(german.contrasts[0].pairs.length, 2);
  const clips = manifest.clips.filter(clip => clip.languageId === 'de');
  const staged = read('../audio/human-german-pilot/manifest.preview.json');
  assert.deepEqual(clips, staged.clips);
  assert.equal(clips.length, 8);
  assert.deepEqual([...new Set(clips.map(clip => clip.text))].sort(), ['ihm', 'ihn', 'im', 'in']);
  const publicFiles = fs.readdirSync(path.join(app, 'public/audio/human-de-i-length')).sort();
  assert.deepEqual(publicFiles, ['ATTRIBUTION.md', 'attribution.json', 'clips']);
  assert.deepEqual(fs.readdirSync(path.join(app, 'public/audio/human-de-i-length/clips')).sort(), clips.map(clip => path.basename(clip.url)).sort());
});

test('German clips retain per-file license versions, notices, exact bytes and unresolved review warnings', () => {
  const credits = read('public/audio/human-de-i-length/attribution.json');
  assert.deepEqual(credits, read('../audio/human-german-pilot/attribution.json'));
  assert.equal(credits.records.length, 8);
  for (const clip of manifest.clips.filter(clip => clip.languageId === 'de')) {
    const credit = credits.records.find(item => item.voiceId === clip.voiceId && item.text === clip.text);
    assert.ok(credit);
    for (const [field, value] of Object.entries({ sourcePage: clip.sourcePage, sourceRevision: clip.sourceRevision, changes: clip.changes, license: clip.license.id, licenseUrl: clip.license.url })) assert.equal(credit[field], value);
    assert.equal(credit.license, clip.voiceId === 'human-de-jeuwre' ? 'CC-BY-SA-4.0' : 'CC-BY-SA-3.0');
    assert.equal(clip.speakerConsistencyVerified, false);
    assert.match(clip.recordingConditionWarning, /correlate with target category/);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(app, 'public', clip.url.slice(1)))).digest('hex'), clip.sha256);
  }
  assert.doesNotMatch(JSON.stringify(credits), /\/Users\/|privateReferencePath|originalPrivatePath/);
});

test('German two-pair sessions retain cross-word categories and a different contributor for X', () => {
  const german = languages.find(language => language.id === 'de');
  const voices = manifest.voicesByLanguage.de.map(voice => voice.id);
  for (let seed = 1; seed <= 100; seed++) {
    let state = seed;
    const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
    const session = assignSessionVoices(buildSession(german.contrasts[0].pairs, 12, random), voices, random);
    assert.equal(session.length, 12);
    for (const question of session) {
      assert.notEqual(question.pair.id, question.testPair.id);
      assert.notEqual(question.referenceVoiceId, question.testVoiceId);
      assert.deepEqual([...question.order].sort(), [0, 1]);
      assert.equal(question.testPair.abx.categoryByWordIndex[question.target], question.pair.abx.categoryByWordIndex[question.target]);
      const references = question.order.map(index => question.pair.words[index].text);
      const x = question.testPair.words[question.target].text;
      assert.equal(references.includes(x), false);
      for (const [word, voice] of [...references.map(word => [word, question.referenceVoiceId]), [x, question.testVoiceId]]) {
        assert.equal(manifest.clips.filter(clip => clip.languageId === 'de' && clip.text === word && clip.voiceId === voice).length, 1);
      }
    }
  }
});

test('German human history retains source identity and cannot schedule ordinary weaknesses', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const records = [1, 2, 3].map(day => normalizeSession({ id: `german_human_${day}`, mode: 'abx-cross-word', schemaVersion: 2,
    languageId: 'de', contrastId: 'de-i-length-pronouns', audioCollectionId: HUMAN_LIBRARY_COLLECTION,
    completedAt: new Date(now - day * 86_400_000).toISOString(), correct: 0, total: 12, textHintsUsed: false,
    mistakes: Array.from({ length: 12 }, () => ({ pairId: 'de-in-ihn', word: 'ihm', chosenWord: 'in' })) }));
  assert.ok(records.every(record => record?.audioCollectionId === HUMAN_LIBRARY_COLLECTION));
  assert.deepEqual(recommendReview(curriculum.languages || curriculum, records, { languageId: 'de', now }),
    recommendReview(curriculum.languages || curriculum, [], { languageId: 'de', now }));
});

test('new English files preserve exact source licenses and notices without private paths', () => {
  const credits = read('public/audio/human-en-ae-strut/attribution.json').records;
  const clips = manifest.clips.filter(c => c.url.startsWith('/audio/human-en-ae-strut/'));
  assert.equal(credits.length, 12); assert.equal(clips.length, 12);
  for (const clip of clips) {
    const credit = credits.find(c => c.voiceId === clip.voiceId && c.text === clip.text);
    assert.ok(credit);
    for (const [field, value] of Object.entries({ sourcePage: clip.sourcePage, sourceRevision: clip.sourceRevision, changes: clip.changes, license: clip.license.id, licenseUrl: clip.license.url })) assert.equal(credit[field], value);
    assert.ok(['CC0-1.0', 'CC-BY-SA-3.0'].includes(credit.license));
  }
  assert.doesNotMatch(JSON.stringify(manifest), /\/Users\/|privateReferencePath|originalPrivatePath/);
  assert.throws(() => humanLibraryLanguages([]), /requires/);
});

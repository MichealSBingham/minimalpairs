import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getAudioReviewCatalog, buildAudioReviewCatalog, readReviewAudioFile } from '../src/lib/audio-review-catalog.ts';
import { comparisonLanguages, comparisonSources } from '../src/lib/audio-comparison.ts';
import { humanLibraryLanguages, HUMAN_LIBRARY_COLLECTION } from '../src/lib/human-library.ts';
import { ownerEnglishLanguages, OWNER_ENGLISH_COLLECTION } from '../src/lib/owner-audio-preview.ts';

const app = path.resolve(import.meta.dirname, '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(app, file), 'utf8'));
const main = read('../content/curriculum.json').languages;
const normalize = text => text.normalize('NFC').trim().toLocaleLowerCase();
const catalog = getAudioReviewCatalog();
const clipMap = new Map(catalog.clips.map(clip => [clip.id, clip]));
const selected = new Map([
  ['qwen-starter-v1', main], [HUMAN_LIBRARY_COLLECTION, humanLibraryLanguages(main)],
  [OWNER_ENGLISH_COLLECTION, ownerEnglishLanguages(main)], ...comparisonSources.map(source => [source.collectionId, comparisonLanguages(main)]),
]);

test('published inventory covers all six routed collections and exact selected linguistic groups', () => {
  assert.equal(catalog.schemaVersion, 1); assert.match(catalog.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(catalog.collections.length, 15); assert.equal(catalog.groups.length, 206);
  assert.ok(catalog.clips.filter(clip => clip.exists).length > 0);
  assert.equal(catalog.clips.filter(clip => !clip.exists).length, 34);
  assert.equal(catalog.unassignedClipIds.length, 0);
  for (const [collection, languages] of selected) for (const language of languages) for (const contrast of language.contrasts) {
    const group = catalog.groups.find(group => group.collectionId === collection && group.contrastId === contrast.id);
    assert.ok(group); assert.equal(group.languageId, language.id); assert.equal(group.dialect, language.dialect);
    assert.deepEqual(group.phonemes, contrast.phonemes); assert.match(group.id, new RegExp(`^${collection}:${contrast.id}:[a-f0-9]{64}$`));
    assert.deepEqual(group.pairs.map(pair => ({ ...pair, words: pair.words.map(({ clipIds, ...word }) => word) })), contrast.pairs.map(pair => ({
      id: pair.id, trialGroup: pair.abx?.trialGroup || 'all', targetPosition: pair.abx?.targetPosition || 'unspecified',
      words: pair.words.map(({ text, ipa, meaning }) => ({ text, ipa, meaning })),
    })));
    assert.equal(group.focus, contrast.targetSoundFocus || contrast.abx?.targetSoundFocus || contrast.description);
  }
});

test('every public training manifest recording is present with exact actual bytes and duplicates share one clip', () => {
  // Public-only inventory walk also covers the two older human subset manifests.
  const audio = path.join(app, 'public/audio'); const declarations = [];
  for (const relative of fs.readdirSync(audio, { recursive: true }).filter(name => name.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(audio, relative), 'utf8'));
    // The separately routed audition has its own inventory/hash/isolation test.
    if (data.kind === 'minimalpairs-voice-audition') { assert.equal(relative,'voice-audition-v2/manifest.json'); continue; }
    if (Array.isArray(data.clips)) declarations.push(...data.clips);
  }
  assert.ok(declarations.length > 0);
  for (const raw of declarations) {
    const records = catalog.clips.filter(clip => clip.url === raw.url && clip.languageId === raw.languageId && clip.voiceId === raw.voiceId && clip.text === raw.text);
    assert.equal(records.length, 1, raw.url);
    assert.equal(records[0].sha256, sha(fs.readFileSync(path.join(app, 'public', raw.url.slice(1)))));
    assert.equal(records[0].sha256, raw.sha256); assert.equal(records[0].synthetic, raw.synthetic);
    assert.equal(records[0].sourceStatus, raw.status);
  }
  const ship = catalog.clips.find(clip => clip.languageId === 'en' && clip.text === 'ship' && clip.voiceId === 'qwen-en-a');
  assert.deepEqual(ship.collectionIds, ['comparison-generated-v1', 'qwen-starter-v1']);
  assert.doesNotMatch(JSON.stringify(catalog), /\/Users\/|privateReferencePath|privateWavPath|originalPrivatePath|device:/);
});

test('word mappings retain every declared voice within their own collection and exact word', () => {
  for (const group of catalog.groups) for (const pair of group.pairs) for (const word of pair.words) {
    const records = word.clipIds.map(id => clipMap.get(id));
    assert.ok(records.length > 0);
    if (group.collectionId.startsWith('chatterbox-')) { assert.ok(records.length >= 2); assert.ok(records.every(clip => group.voices.some(v => v.id === clip.voiceId))); }
    else assert.deepEqual([...new Set(records.map(clip => clip.voiceId))].sort(), group.voices.map(voice => voice.id).sort());
    for (const clip of records) {
      assert.equal(clip.languageId, group.languageId); assert.equal(normalize(clip.text), normalize(word.text));
      assert.ok(clip.collectionIds.includes(group.collectionId));
    }
  }
  for (const id of ['en-zh-j', 'en-foot-strut', 'en-ae-strut']) {
    const group = catalog.groups.find(group => group.collectionId === 'qwen-starter-v1' && group.contrastId === id);
    assert.equal(group.pairs.length, 3); assert.equal(group.voices.length, 2);
    const slots = group.pairs.flatMap(pair => pair.words.flatMap(word => word.clipIds.map(id => clipMap.get(id))));
    assert.equal(slots.length, 12); assert.ok(slots.every(clip => clip.exists === false && clip.url === null && clip.sha256 === null && clip.sourceStatus === 'missing'));
  }
});

test('catalog fingerprints are repeatable and human/owner recording warnings remain available', () => {
  assert.deepEqual(getAudioReviewCatalog(), catalog);
  const german = catalog.groups.find(group => group.contrastId === 'de-i-length-pronouns');
  assert.ok(german.notes.some(note => /correlate with target category/.test(note)));
  const conditional = catalog.groups.find(group => group.collectionId === OWNER_ENGLISH_COLLECTION && group.contrastId === 'en-zh-j');
  assert.ok(conditional.notes.some(note => /schwa/.test(note)));
  for (const group of catalog.groups.filter(group => group.collectionId.startsWith('comparison-'))) {
    const href = new URL(group.practiceHref, 'https://example.invalid');
    assert.equal(href.pathname, '/audio-comparison'); assert.equal(href.searchParams.get('contrast'), group.contrastId);
    assert.ok(['generated', 'reference', 'human'].includes(href.searchParams.get('source')));
  }
});

const recording = (text = 'one', voiceId = 'voice-a', extra = {}) => ({ languageId: 'en', text, voiceId, url: `/audio/${voiceId}-${text}.mp3`,
  status: 'generated-unreviewed', provider: 'fixture', synthetic: true, sha256: sha('original'), ...extra });
function fixture() {
  return { id: 'fixture', label: 'Fixture', manifest: { voicesByLanguage: { en: [{ id: 'voice-a', name: 'A' }, { id: 'voice-b', name: 'B' }] },
    clips: ['one', 'two'].flatMap(text => ['voice-a', 'voice-b'].map(voice => recording(text, voice))) },
  languages: [{ id: 'en', name: 'English', nativeName: 'English', locale: 'en-US', dialect: 'Fixture dialect', tagline: '', contrasts: [{
    id: 'contrast', label: 'One or two?', phonemes: ['a', 'b'], description: 'A fixture.', targetSoundFocus: 'The middle vowel.',
    pairs: [{ id: 'pair', kind: 'minimal', abx: { trialGroup: 'group', targetPosition: 'medial' }, words: [
      { text: 'one', ipa: '/a/', meaning: 'First meaning' }, { text: 'two', ipa: '/b/', meaning: 'Second meaning' },
    ] }],
  }] }] };
}
const file = () => ({ exists: true, sha256: sha('original') });

test('orphan and undeclared-voice recordings are retained outside word groups, including rejected files', () => {
  const input = fixture(); input.manifest.clips.push(recording('orphan'), recording('one', 'undeclared'), recording('rejected', 'voice-a', { status: 'rejected' }));
  const result = buildAudioReviewCatalog([input], file);
  assert.equal(result.unassignedClipIds.length, 3);
  const orphan = result.clips.filter(clip => result.unassignedClipIds.includes(clip.id));
  assert.deepEqual(orphan.map(clip => clip.text).sort(), ['one', 'orphan', 'rejected']);
  assert.ok(orphan.find(clip => clip.text === 'rejected').exists);
  assert.match(orphan.find(clip => clip.voiceId === 'undeclared').voiceName, /not declared/);
});

test('missing words and entirely absent voice declarations remain explicit nonplayable slots', () => {
  const input = fixture(); input.manifest.clips = [recording('one')];
  let result = buildAudioReviewCatalog([input], file);
  assert.equal(result.clips.filter(clip => !clip.exists).length, 3);
  assert.equal(result.groups[0].pairs[0].words[0].clipIds.length, 2);
  input.manifest.voicesByLanguage = {}; input.manifest.clips = [];
  result = buildAudioReviewCatalog([input], file);
  assert.deepEqual(result.groups[0].voices, [{ id: 'missing-profile', name: 'No voice profile declared' }]);
  assert.equal(result.clips.length, 2); assert.ok(result.clips.every(clip => !clip.exists && clip.url === null && clip.synthetic === null));
});

test('changed actual audio or recording metadata invalidates clip and group identity', () => {
  const input = fixture(); const before = buildAudioReviewCatalog([input], file);
  const changedBytes = buildAudioReviewCatalog([input], () => ({ exists: true, sha256: sha('changed') }));
  assert.notEqual(changedBytes.fingerprint, before.fingerprint); assert.notEqual(changedBytes.groups[0].id, before.groups[0].id);
  assert.ok(changedBytes.clips.every(clip => /manifest checksum mismatch/.test(clip.sourceStatus)));
  assert.ok(changedBytes.clips.every(clip => !before.clips.some(old => old.id === clip.id)));
  input.manifest.clips[0].status = 'rejected'; const changedMetadata = buildAudioReviewCatalog([input], file);
  assert.notEqual(changedMetadata.groups[0].id, before.groups[0].id); assert.notEqual(changedMetadata.fingerprint, before.fingerprint);
});

test('each linguistic or grouping change invalidates group approval without duplicating unchanged files', () => {
  const before = buildAudioReviewCatalog([fixture()], file);
  for (const mutate of [
    contrast => { contrast.pairs[0].words[0].ipa = '/changed/'; },
    contrast => { contrast.pairs[0].words[0].meaning = 'Changed sense'; },
    contrast => { contrast.pairs[0].abx.trialGroup = 'new-group'; },
    contrast => { contrast.pairs[0].abx.targetPosition = 'final'; },
    contrast => { contrast.targetSoundFocus = 'A new target.'; },
    contrast => { contrast.phonemes = ['x', 'y']; },
  ]) {
    const input = fixture(); mutate(input.languages[0].contrasts[0]); const after = buildAudioReviewCatalog([input], file);
    assert.notEqual(after.groups[0].id, before.groups[0].id); assert.notEqual(after.fingerprint, before.fingerprint);
    assert.deepEqual(after.clips, before.clips);
  }
});

test('collection ordering and manifest listing order do not change deterministic identity', () => {
  const a = fixture(); const b = structuredClone(a); b.id = 'second'; b.label = 'Second';
  const before = buildAudioReviewCatalog([a, b], file);
  a.manifest.clips.reverse(); a.manifest.voicesByLanguage.en.reverse();
  b.manifest.clips.reverse(); b.manifest.voicesByLanguage.en.reverse();
  const after = buildAudioReviewCatalog([b, a], file);
  assert.deepEqual(after, before); assert.equal(after.clips.length, 4);
  assert.ok(after.clips.every(clip => clip.collectionIds.length === 2));
});

test('invalid, external and protected paths are retained as unavailable without a file read', () => {
  const input = fixture(); input.manifest.clips = [
    recording('one', 'voice-a', { url: 'https://example.invalid/file.mp3' }),
    recording('two', 'voice-a', { url: '/audio/../outside.mp3' }),
    recording('one', 'voice-b', { url: '/audio/private/file.mp3' }),
    recording('two', 'voice-b', { url: '/audio/reserved/file.mp3' }),
  ];
  let reads = 0; const result = buildAudioReviewCatalog([input], () => { reads++; return file(); });
  assert.equal(reads, 0); assert.ok(result.clips.every(clip => clip.url === null && !clip.exists));
});

test('local file reader hashes actual bytes, reports missing files and refuses symlink escapes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-review-catalog-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const publicDir = path.join(root, 'public'); fs.mkdirSync(path.join(publicDir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'audio/inside.mp3'), 'actual bytes'); fs.writeFileSync(path.join(root, 'outside.mp3'), 'outside');
  assert.deepEqual(readReviewAudioFile('/audio/inside.mp3', publicDir), { exists: true, sha256: sha('actual bytes') });
  assert.deepEqual(readReviewAudioFile('/audio/missing.mp3', publicDir), { exists: false, sha256: null });
  fs.symlinkSync(path.join(root, 'outside.mp3'), path.join(publicDir, 'audio/link.mp3'));
  assert.deepEqual(readReviewAudioFile('/audio/link.mp3', publicDir), { exists: false, sha256: null });
  fs.renameSync(path.join(publicDir, 'audio'), path.join(root, 'moved-audio')); fs.symlinkSync(path.join(root, 'moved-audio'), path.join(publicDir, 'audio'));
  assert.deepEqual(readReviewAudioFile('/audio/inside.mp3', publicDir), { exists: false, sha256: null });
});

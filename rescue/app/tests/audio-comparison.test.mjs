import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { comparisonScopes, comparisonSources, comparisonLanguages } from '../src/lib/audio-comparison.ts';

const app = path.resolve(import.meta.dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const raw = read(path.resolve(app, '../content/curriculum.json'));
const languages = comparisonLanguages(Array.isArray(raw) ? raw : raw.languages);
const publicFile = url => path.join(app, 'public', url.replace(/^\//, ''));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('comparison keeps exactly the same three valid pairs per language across all sources', () => {
  assert.deepEqual(languages.map(language => language.id), ['fr', 'en']);
  for (const language of languages) {
    assert.equal(language.contrasts.length, 1);
    assert.deepEqual(language.contrasts[0].pairs.map(pair => pair.id), comparisonScopes.find(scope => scope.languageId === language.id).pairIds);
  }
  assert.throws(() => comparisonLanguages([]), /requires all three/);
  assert.equal(new Set(comparisonSources.map(source => source.collectionId)).size, 3);
  for (const source of comparisonSources) {
    const manifest = read(publicFile(source.manifestPath));
    assert.equal(manifest.collectionId, source.collectionId);
    assert.equal(manifest.clips.length, 24);
    assert.equal(manifest.defaultReplacementApproved, false);
    assert.equal(manifest.phoneticListeningVerified, false);
    for (const language of languages) {
      const words = language.contrasts[0].pairs.flatMap(pair => pair.words.map(word => word.text));
      assert.equal(manifest.voicesByLanguage[language.id].length, 2);
      for (const voice of manifest.voicesByLanguage[language.id]) {
        const clips = manifest.clips.filter(clip => clip.languageId === language.id && clip.voiceId === voice.id);
        assert.deepEqual(clips.map(clip => clip.text).sort(), [...words].sort());
        for (const clip of clips) { assert.notEqual(clip.status, 'rejected'); assert.equal(sha(fs.readFileSync(publicFile(clip.url))), clip.sha256); }
      }
    }
  }
});

test('comparison publishes only primary fixed-reference takes with public-safe provenance', () => {
  const source = comparisonSources.find(source => source.id === 'reference');
  const manifest = read(publicFile(source.manifestPath));
  assert.ok(manifest.clips.every(clip => clip.take === 0 && clip.synthetic === true && clip.speakerConsistencyVerified === false));
  const actual = fs.readdirSync(publicFile('/audio/fixed-speaker-pilot/clips')).sort();
  assert.deepEqual(actual, manifest.clips.map(clip => path.basename(clip.url)).sort());
  assert.deepEqual(fs.readdirSync(publicFile('/audio/fixed-speaker-pilot')).sort(), ['clips', 'manifest.json', 'reference-provenance.json']);
  for (const file of [source.manifestPath, '/audio/fixed-speaker-pilot/reference-provenance.json', '/audio/human-en-i-ih/manifest.json', '/audio/comparison/human.json']) {
    const json = fs.readFileSync(publicFile(file), 'utf8');
    assert.doesNotMatch(json, /private\/|\/Users\/|privateReferencePath|privateWavPath|originalPrivatePath/);
  }
  const provenance = read(publicFile('/audio/fixed-speaker-pilot/reference-provenance.json'));
  assert.equal(provenance.rawReferenceAudioIncluded, false);
});

test('English human recordings retain exact per-file attribution and selected licenses', () => {
  const manifest = read(publicFile('/audio/human-en-i-ih/manifest.json'));
  const credits = read(publicFile('/audio/human-en-i-ih/attribution.json')).records;
  assert.equal(credits.length, 12);
  assert.ok(manifest.clips.every(clip => clip.synthetic === false && clip.phoneticListeningVerified === false && clip.status === 'source-verified-unreviewed'));
  for (const clip of manifest.clips) {
    const credit = credits.find(credit => credit.voiceId === clip.voiceId && credit.text === clip.text);
    assert.ok(credit);
    assert.equal(credit.license, clip.license.id);
    assert.equal(credit.licenseUrl, clip.license.url);
    assert.equal(credit.sourcePage, clip.sourcePage);
    assert.equal(credit.sourceRevision, clip.sourceRevision);
    assert.equal(credit.changes, clip.changes);
    assert.ok(credit.changes.includes('44100 Hz mono'));
  }
  const fill = credits.find(credit => credit.author === 'Dvortygirl' && credit.text === 'fill');
  assert.equal(fill.license, 'CC-BY-SA-3.0');
  assert.equal(fill.additionalAttribution, 'Betsy Megas');
  assert.equal(fill.originalLicenseNotice, 'Creative Commons BY-CA');
});

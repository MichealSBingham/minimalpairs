import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { comparisonScopes, comparisonSources } from '../src/lib/audio-comparison.ts';

const app = path.resolve(import.meta.dirname, '..');
const audio = path.resolve(app, '../audio');
const publicRoot = path.join(app, 'public');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !/private/i.test(key)).map(([key, item]) => [key, clean(item)])) : value;
const norm = text => text.normalize('NFC').trim().toLowerCase();
const curriculum = read(path.resolve(app, '../content/curriculum.json'));
const languages = Array.isArray(curriculum) ? curriculum : curriculum.languages;
const wordsByLanguage = new Map(comparisonScopes.map(scope => {
  const contrast = languages.find(language => language.id === scope.languageId)?.contrasts.find(contrast => contrast.id === scope.contrastId);
  const pairs = scope.pairIds.map(id => contrast?.pairs.find(pair => pair.id === id));
  if (pairs.some(pair => !pair)) throw new Error(`Missing comparison pairs for ${scope.languageId}`);
  return [scope.languageId, new Set(pairs.flatMap(pair => pair.words.map(word => norm(word.text))))];
}));
const withinScope = clip => wordsByLanguage.get(clip.languageId)?.has(norm(clip.text));
const preview = (manifest, sourceId) => {
  const result = clean(manifest);
  delete result.publicDeploymentApproved;
  result.status = 'preview-unreviewed';
  result.defaultReplacementApproved = false;
  result.phoneticListeningVerified = false;
  result.collectionId = comparisonSources.find(source => source.id === sourceId).collectionId;
  result.clips = result.clips.filter(withinScope);
  result.eligibleContrasts = comparisonScopes.map(scope => {
    const original = languages.find(language => language.id === scope.languageId)?.contrasts.find(contrast => contrast.id === scope.contrastId);
    return { ...scope, completeForListedPairs: true, completeForEntireContrast: original?.pairs.every(pair => scope.pairIds.includes(pair.id)) === true };
  });
  result.voicesByLanguage = Object.fromEntries(comparisonScopes.map(scope => [scope.languageId, result.voicesByLanguage[scope.languageId] || []]));
  return result;
};
const verify = manifest => {
  if (manifest.clips.length !== 24) throw new Error('Comparison requires exactly 24 primary recordings.');
  if (/private\/|\/Users\/|privateReferencePath|privateWavPath|originalPrivatePath/.test(JSON.stringify(manifest))) throw new Error('Private metadata cannot be copied.');
  for (const [languageId, words] of wordsByLanguage) {
    const voices = manifest.voicesByLanguage[languageId];
    if (voices.length !== 2) throw new Error(`Two complete profiles required for ${languageId}`);
    for (const voice of voices) for (const text of words) {
      const clips = manifest.clips.filter(clip => clip.languageId === languageId && clip.voiceId === voice.id && norm(clip.text) === text && clip.status !== 'rejected');
      if (clips.length !== 1) throw new Error(`Ambiguous or missing ${languageId}/${voice.id}/${text}`);
    }
  }
};
const copyClips = (manifest, sourceDirectory) => {
  for (const clip of manifest.clips) {
    const source = path.join(sourceDirectory, 'clips', path.basename(clip.url));
    const data = fs.readFileSync(source);
    if (crypto.createHash('sha256').update(data).digest('hex') !== clip.sha256) throw new Error(`Checksum mismatch: ${clip.id}`);
    const destination = path.join(publicRoot, clip.url.replace(/^\//, ''));
    if (!destination.startsWith(path.join(publicRoot, 'audio') + path.sep) || !destination.endsWith('.mp3')) throw new Error('Invalid public media destination.');
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination);
  }
};

const generated = preview(read(path.join(publicRoot, 'audio/manifest.json')), 'generated');
generated.scopeNote = 'Current generated recordings, limited to the common comparison pairs. Existing media files are reused unchanged.';
verify(generated); write(path.join(publicRoot, 'audio/comparison/generated.json'), generated);

const fixedDirectory = path.join(audio, 'fixed-speaker-pilot');
const fixed = preview(read(path.join(fixedDirectory, 'manifest.preview.json')), 'reference');
if (fixed.clips.some(clip => clip.take !== 0 || clip.synthetic !== true)) throw new Error('Only synthetic primary take 0 may be integrated.');
verify(fixed); copyClips(fixed, fixedDirectory);
write(path.join(publicRoot, 'audio/fixed-speaker-pilot/manifest.json'), fixed);
write(path.join(publicRoot, 'audio/fixed-speaker-pilot/reference-provenance.json'), read(path.join(fixedDirectory, 'references.public-metadata.json')));

const englishDirectory = path.join(audio, 'human-english-pilot');
const humanEnglish = clean(read(path.join(englishDirectory, 'manifest.candidate.json')));
delete humanEnglish.publicDeploymentApproved;
humanEnglish.status = 'preview-unreviewed'; humanEnglish.defaultReplacementApproved = false;
humanEnglish.scopeNote = 'English human recordings for the optional audio comparison. Source provenance is checked; phonetic listening review is pending.';
copyClips(humanEnglish, englishDirectory);
write(path.join(publicRoot, 'audio/human-en-i-ih/manifest.json'), humanEnglish);
write(path.join(publicRoot, 'audio/human-en-i-ih/attribution.json'), { ...clean(read(path.join(englishDirectory, 'attribution.json'))), scope: 'Only these 12 English comparison recordings; licenses remain per clip.' });
const humanFrench = read(path.join(publicRoot, 'audio/human-fr-u-y/manifest.json'));
const human = preview({ schemaVersion: 1, voicesByLanguage: { ...humanFrench.voicesByLanguage, ...humanEnglish.voicesByLanguage }, clips: [...humanFrench.clips, ...humanEnglish.clips] }, 'human');
human.scopeNote = 'Human recordings with per-file licenses and attribution at /audio-credits. Regional accents and phonetic suitability remain unreviewed.';
verify(human); write(path.join(publicRoot, 'audio/comparison/human.json'), human);
console.log('Prepared 3 isolated comparison manifests; copied 24 primary synthetic clips and 12 English human clips. Default audio unchanged.');

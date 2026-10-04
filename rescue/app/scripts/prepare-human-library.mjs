import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { humanLibraryScopes, HUMAN_LIBRARY_COLLECTION } from '../src/lib/human-library.ts';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(app, 'public');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function copyCandidate(folder, publicFolder, count) {
  const candidate = path.resolve(app, '../audio', folder);
  const manifest = read(path.join(candidate, 'manifest.preview.json'));
  const destination = path.join(publicRoot, 'audio', publicFolder);
  const credits = read(path.join(candidate, 'attribution.json'));
  if (manifest.clips.length !== count || credits.records.length !== count) throw new Error('Unexpected candidate coverage.');
  fs.mkdirSync(path.join(destination, 'clips'), { recursive: true });
  for (const clip of manifest.clips) {
    if (!clip.url.startsWith(`/audio/${publicFolder}/clips/`) || !/^[a-f0-9]+\.mp3$/.test(clip.url.split('/').at(-1))
      || clip.url.split('/').length !== 5) throw new Error('Unexpected human recording path.');
    const bytes = fs.readFileSync(path.join(candidate, 'clips', path.basename(clip.url)));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== clip.sha256) throw new Error(`Human recording checksum mismatch: ${clip.id}`);
    if (clip.synthetic !== false || clip.status !== 'source-verified-unreviewed' || clip.phoneticListeningVerified !== false) throw new Error('Unexpected human recording review state.');
    const credit = credits.records.find(item => item.voiceId === clip.voiceId && item.text === clip.text);
    if (!credit || credit.license !== clip.license.id || credit.licenseUrl !== clip.license.url || credit.sourceRevision !== clip.sourceRevision) throw new Error('Recording attribution mismatch.');
    fs.writeFileSync(path.join(publicRoot, clip.url.slice(1)), bytes);
  }
  for (const name of ['attribution.json', 'ATTRIBUTION.md']) fs.copyFileSync(path.join(candidate, name), path.join(destination, name));
  return manifest;
}
const expansion = copyCandidate('human-english-expansion', 'human-en-ae-strut', 12);
const german = copyCandidate('human-german-pilot', 'human-de-i-length', 8);
const candidateCurriculum = read(path.resolve(app, '../audio/human-german-pilot/curriculum.candidate.json'));
const appCurriculum = read(path.join(app, 'src/data/human-german-curriculum.json'));
if (JSON.stringify(candidateCurriculum) !== JSON.stringify(appCurriculum)) throw new Error('Isolated German curriculum differs from the staged candidate.');
const french = read(path.join(publicRoot, 'audio/human-fr-u-y/manifest.json'));
const english = read(path.join(publicRoot, 'audio/human-en-i-ih/manifest.json'));
const library = {
  schemaVersion: 1, collectionId: HUMAN_LIBRARY_COLLECTION, status: 'source-checked-listening-review-pending',
  phoneticListeningVerified: false, speakerConsistencyVerified: false,
  scopeNote: 'Four explicitly listed contrasts in French, English and German. Two credited contributors per language; French and English scopes have three pairs, German has two. Regional accents, pronunciation and audible speaker consistency remain unreviewed. German file-version dates correlate with target categories, so recording cues need review. This optional collection does not replace the default generated library.',
  voicesByLanguage: { fr: french.voicesByLanguage.fr, en: english.voicesByLanguage.en, de: german.voicesByLanguage.de },
  clips: [...french.clips, ...english.clips, ...expansion.clips, ...german.clips],
  eligibleContrasts: [...french.eligibleContrasts, ...english.eligibleContrasts, ...expansion.eligibleContrasts, ...german.eligibleContrasts],
};
const keys = library.clips.map(clip => `${clip.languageId}:${clip.voiceId}:${clip.text.normalize('NFC').toLowerCase()}`);
if (new Set(keys).size !== keys.length || library.clips.length !== 44) throw new Error('Unexpected human library coverage.');
if (library.eligibleContrasts.some((scope, index) => scope.contrastId !== humanLibraryScopes[index].contrastId
  || JSON.stringify(scope.pairIds) !== JSON.stringify(humanLibraryScopes[index].pairIds))) throw new Error('Human library scope does not match the curriculum selection.');
const serialized = JSON.stringify(library, null, 2);
if (/\/Users\/|privateReferencePath|originalPrivatePath/.test(serialized)) throw new Error('Private provenance cannot be published.');
fs.writeFileSync(path.join(publicRoot, 'audio/human-library.json'), serialized + '\n');
console.log(`Prepared ${library.clips.length} licensed human recordings for ${library.eligibleContrasts.length} contrasts; listening review remains pending.`);

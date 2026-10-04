import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ownerEnglishLanguages, OWNER_ENGLISH_COLLECTION } from '../src/lib/owner-audio-preview.ts';

const app = path.resolve(import.meta.dirname, '..');
const workspace = path.resolve(app, '../..');
const handoff = path.join(app, '../audio/fixed-reference-expansion/owner-validation-handoff-2026-09-28');
const destination = path.join(app, 'public/audio/fixed-reference-expansion');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = read(path.join(handoff, 'integration-inventory.json'));
const manifestBytes = fs.readFileSync(path.join(handoff, 'manifest.preview.json'));
const manifest = JSON.parse(manifestBytes);
const referenceBytes = fs.readFileSync(path.join(handoff, 'references.public.json'));
const curriculum = read(path.join(app, '../content/curriculum.json'));
const languages = ownerEnglishLanguages(curriculum.languages);
if (inventory.collectionId !== OWNER_ENGLISH_COLLECTION || manifest.collectionId !== OWNER_ENGLISH_COLLECTION || inventory.copyAllowlist.length !== 34 || manifest.clips.length !== 34 || sha(manifestBytes) !== inventory.manifestSha256) throw new Error('Preview identity/inventory mismatch.');
if (/\/Users\/|private\/|sourcePath|privateReferencePath|privateWavPath/.test(manifestBytes.toString() + referenceBytes.toString())) throw new Error('Private metadata cannot be published.');
if (manifest.voicesByLanguage.en.length !== 2 || Object.keys(manifest.voicesByLanguage).length !== 1) throw new Error('Only two English profiles are allowed.');
for (const contrast of languages[0].contrasts) for (const pair of contrast.pairs) for (const word of pair.words) for (const voice of manifest.voicesByLanguage.en) {
  const matches = manifest.clips.filter(clip => clip.languageId === 'en' && clip.text === word.text && clip.voiceId === voice.id);
  if (matches.length !== 1 || matches[0].targetIPA !== word.ipa) throw new Error('Missing, ambiguous or mismatched word/profile mapping.');
}
const copies = inventory.copyAllowlist.map(item => {
  if (!/^rescue\/audio\/fixed-reference-expansion\/clips\/[a-f0-9]+\.mp3$/.test(item.sourcePath) || !/^\/audio\/fixed-reference-expansion\/clips\/[a-f0-9]+\.mp3$/.test(item.destinationUrl)) throw new Error('Unexpected source or destination.');
  const clip = manifest.clips.find(clip => clip.url === item.destinationUrl);
  const bytes = fs.readFileSync(path.join(workspace, item.sourcePath));
  if (!clip || clip.sha256 !== item.sha256 || sha(bytes) !== item.sha256 || bytes.length !== item.bytes || clip.synthetic !== true || clip.status !== 'generated-unreviewed') throw new Error('Selected clip integrity/status mismatch.');
  return { bytes, file: path.join(app, 'public', item.destinationUrl.slice(1)) };
});
const allowed = new Set(copies.map(copy => path.basename(copy.file)));
if (allowed.size !== 34) throw new Error('Duplicate selected media destination.');
if (fs.existsSync(path.join(destination, 'clips')) && fs.readdirSync(path.join(destination, 'clips')).some(file => !allowed.has(file))) throw new Error('Unexpected media already present; refusing to silently publish extras.');
fs.mkdirSync(path.join(destination, 'clips'), { recursive: true });
for (const copy of copies) fs.writeFileSync(copy.file, copy.bytes);
fs.writeFileSync(path.join(destination, 'manifest.json'), manifestBytes);
fs.writeFileSync(path.join(destination, 'reference-provenance.json'), referenceBytes);
console.log('Prepared exactly 34 isolated English MP3s and two sanitized metadata files. Default source unchanged.');

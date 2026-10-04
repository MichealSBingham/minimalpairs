import fs from 'node:fs';
import path from 'node:path';
import { assertReservedContentExcluded, withMandarinReservations } from './reserved-content.mjs';
const raw = JSON.parse(fs.readFileSync(new URL('../../content/curriculum.json', import.meta.url), 'utf8'));
const languages = Array.isArray(raw) ? raw : raw.languages;
if (!Array.isArray(languages) || languages.length !== 8) throw new Error('Expected the complete eight-language curriculum.');
const ids = new Set();
for (const language of languages) {
  if (ids.has(language.id)) throw new Error(`Duplicate language ${language.id}`);
  ids.add(language.id);
  if (!language.contrasts?.length) throw new Error(`${language.id} has no contrasts`);
  for (const contrast of language.contrasts) {
    if (!contrast.pairs?.length) throw new Error(`${contrast.id} has no pairs`);
    for (const pair of contrast.pairs) {
      if (pair.words?.length !== 2 || pair.words.some(word => !word.text || !word.ipa)) throw new Error(`Invalid pair ${pair.id}`);
      if (pair.words[0].text === pair.words[1].text && pair.words[0].ipa === pair.words[1].ipa) throw new Error(`Identical pair ${pair.id}`);
    }
  }
}
const balanceFile = new URL('../../content/phoneme-research/mandarin-balance.json', import.meta.url);
const balance = fs.existsSync(balanceFile) ? JSON.parse(fs.readFileSync(balanceFile,'utf8')) : undefined;
const reserved = withMandarinReservations(JSON.parse(fs.readFileSync(new URL('../../content/transfer-candidates.json', import.meta.url), 'utf8')), balance);
const audioManifests = [];
function inspectAudioDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inspectAudioDirectory(file);
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(manifest.clips)) audioManifests.push({ path: path.relative(process.cwd(), file), manifest });
    }
  }
}
inspectAudioDirectory(path.resolve('public/audio'));
const reservation = assertReservedContentExcluded(languages, reserved, audioManifests);
fs.mkdirSync(path.resolve('public/data'), { recursive: true });
fs.writeFileSync(path.resolve('public/data/curriculum.json'), JSON.stringify(languages));
console.log(`Validated ${languages.length} language packs; reserved ${reservation.reservedWords} assessment words are excluded from training and ${reservation.audioManifestsChecked} public audio manifests.`);

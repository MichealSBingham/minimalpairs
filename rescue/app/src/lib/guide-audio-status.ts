import fs from 'node:fs';
import path from 'node:path';
import type { Contrast } from './types';

type Clip = { languageId: string; text: string; ipa?: string; voiceId: string; url: string; status?: string; synthetic?: boolean };
type Manifest = { voicesByLanguage: Record<string, { id: string }[]>; clips: Clip[] };
const cachedManifests = new Map<string, Manifest>();
const normalize = (word: string) => word.normalize('NFC').trim().toLowerCase();

/** Build-time guide copy; complete word coverage does not certify pronunciation. */
export function guideAudioStatus(languageId: string, contrast: Contrast) {
  const filename = ['en','fr','de','es','it','zh','pt','ru','ja'].includes(languageId) ? `public/audio/chatterbox-${languageId === 'en' ? 'us' : languageId}/manifest.json` : 'public/audio/manifest.json';
  let cachedManifest = cachedManifests.get(filename);
  if (!cachedManifest) {
    try { cachedManifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filename), 'utf8')); }
    catch { cachedManifest = { voicesByLanguage: {}, clips: [] }; }
  }
  cachedManifests.set(filename,cachedManifest!);
  const manifest = cachedManifest!;
  const requiredWords = contrast.pairs.flatMap(pair => pair.words);
  const required = new Set(requiredWords.map(word=>normalize(word.text))); 
  const clips = (manifest.clips || []).filter(clip => clip.languageId === languageId && clip.status !== 'rejected' && clip.url && required.has(normalize(clip.text)));
  const profiles = (manifest.voicesByLanguage?.[languageId] || []).filter(voice => clips.some(clip => clip.voiceId === voice.id));
  const covered = requiredWords.every(word => clips.some(clip => normalize(clip.text) === normalize(word.text) && clip.ipa === word.ipa)) && contrast.pairs.every(pair => profiles.some(voice => pair.words.every(word => clips.some(clip => clip.voiceId === voice.id && normalize(clip.text) === normalize(word.text) && clip.ipa === word.ipa))));
  if (!covered || !profiles.length) return {
    hasCachedAudio: false,
    profileCount: 0,
    shortLabel: 'Device voice preview only · where supported',
    note: 'Cached recordings are not ready for this contrast. Practice can use a compatible device voice if your browser provides one. Accent and quality vary, and these readings have not been checked against the target pronunciations. Without a compatible voice, the exercise is unavailable.',
  };
  const selected = clips.filter(clip => profiles.some(voice => voice.id === clip.voiceId));
  const source = selected.every(clip => clip.synthetic === false) ? 'Audio recordings' : selected.every(clip => clip.synthetic === true) ? 'Audio recordings' : 'Cached audio';
  const reviewed = selected.every(clip => clip.status === 'verified');
  return {
    hasCachedAudio: true,
    profileCount: profiles.length,
    shortLabel: `${source} · ${reviewed ? 'listening reviewed' : 'listening review pending'}`,
    note: `Cached recordings cover every word in this contrast across ${profiles.length} voice ${profiles.length === 1 ? 'profile' : 'profiles'}. ${reviewed ? 'These clips are marked listening reviewed.' : 'Pronunciation listening review is still pending; this is preview material.'}`,
  };
}

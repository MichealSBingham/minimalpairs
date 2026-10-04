import type { Word } from './types';

type Voice = { id: string; name: string; description?: string; source?: string };
export type PlayedRecording = { id?: string; sha256?: string; languageId: string; text: string; ipa?: string; voiceId: string; url: string; status?: string; provider?: string; synthetic?: boolean };
type Clip = PlayedRecording;
type Manifest = { voicesByLanguage: Record<string, Voice[]>; clips: Clip[] };
const locales: Record<string, string> = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', ru: 'ru-RU', zh: 'zh-CN', pt: 'pt-BR' };
const DEFAULT_MANIFEST = '/audio/manifest.json';
const manifestTimes = new Map<string, number>();
const manifestPromises = new Map<string, Promise<Manifest>>();
let currentAudio: HTMLAudioElement | undefined;
let cancelPlayback: (() => void) | undefined;
let playbackGeneration = 0;
const normalize = (text: string) => text.normalize('NFC').trim().toLocaleLowerCase();

async function manifest(manifestPath = DEFAULT_MANIFEST): Promise<Manifest> {
  if (typeof window === 'undefined') return { voicesByLanguage: {}, clips: [] };
  if (!manifestPath.startsWith('/audio/') || !manifestPath.endsWith('.json')) throw new Error('Invalid audio collection.');
  if (Date.now() - (manifestTimes.get(manifestPath) || 0) > 60000) manifestPromises.delete(manifestPath);
  let pending = manifestPromises.get(manifestPath);
  pending ??= fetch(manifestPath, {cache:'no-cache'}).then(async response => {
    if (!response.ok) return { voicesByLanguage: {}, clips: [] };
    const data = await response.json();
    return { voicesByLanguage: data.voicesByLanguage || {}, clips: Array.isArray(data.clips) ? data.clips : [] };
  }).catch(() => ({ voicesByLanguage: {}, clips: [] }));
  if (!manifestPromises.has(manifestPath)) manifestTimes.set(manifestPath, Date.now());
  manifestPromises.set(manifestPath, pending);
  return pending;
}

const collectionFor = (languageId: string, path: string) => path === DEFAULT_MANIFEST && ['en','fr','de','es','it','zh','pt','ru','ja'].includes(languageId) ? `/audio/chatterbox-${languageId === 'en' ? 'us' : languageId}/manifest.json` : path;

export async function getPracticeAudio(languageId: string, manifestPath = DEFAULT_MANIFEST, refresh = false) {
  if (refresh) manifestPromises.delete(collectionFor(languageId, manifestPath));
  const data = await manifest(collectionFor(languageId, manifestPath));
  return {clips:data.clips.filter(c => c.languageId === languageId && c.status !== 'rejected' && c.url), voices:data.voicesByLanguage[languageId] || []};
}

async function deviceVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  let voices = speechSynthesis.getVoices();
  if (!voices.length) {
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); speechSynthesis.removeEventListener('voiceschanged', done); resolve(); };
      const timer = window.setTimeout(done, 1200);
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    });
    voices = speechSynthesis.getVoices();
  }
  return voices;
}

function cachedVoices(data: Manifest, languageId: string, requiredWords: readonly string[]): Voice[] {
  const required = [...new Set(requiredWords.map(normalize))];
  return (data.voicesByLanguage[languageId] || []).filter(voice => {
    const available = new Set(data.clips.filter(clip => clip.languageId === languageId && clip.voiceId === voice.id && clip.status !== 'rejected' && clip.url).map(clip => normalize(clip.text)));
    return available.size > 0 && required.every(word => available.has(word));
  });
}

/** Only use cached profiles that cover every word this exercise can select. */
export async function getVoices(languageId: string, manifestPath = DEFAULT_MANIFEST, requiredWords: readonly string[] = []): Promise<Voice[]> {
  const data = await manifest(collectionFor(languageId, manifestPath));
  const cached = cachedVoices(data, languageId, requiredWords);
  if (cached.length) return cached;
  if (manifestPath !== DEFAULT_MANIFEST) return [];
  const language = (locales[languageId] || languageId).split('-')[0];
  return (await deviceVoices()).filter(v => v.lang.toLowerCase().startsWith(language)).map(v => ({ id: `device:${v.voiceURI}`, name: v.name, description: 'Device voice · preview audio', source: 'device' }));
}

export async function getAudioStatus(languageId: string, manifestPath = DEFAULT_MANIFEST, requiredWords: readonly string[] = []) {
  const data = await manifest(collectionFor(languageId, manifestPath));
  const cached = cachedVoices(data, languageId, requiredWords);
  if (cached.length) {
    const voiceIds = new Set(cached.map(voice => voice.id));
    const words = new Set(requiredWords.map(normalize));
    const clips = data.clips.filter(c => c.languageId === languageId && voiceIds.has(c.voiceId) && c.status !== 'rejected' && c.url && (!words.size || words.has(normalize(c.text))));
    const source = clips.every(c => c.synthetic === false) ? 'Audio recordings' : 'Audio recordings';
    const review = clips.every(c => c.status === 'verified') ? 'listening reviewed' : 'listening review in progress';
    return { mode: 'cached' as const, label: `${source} · ${review}${cached.length === 1 ? ' · one voice profile' : ''}` };
  }
  const voices = await getVoices(languageId, manifestPath, requiredWords);
  return voices.length ? { mode: 'device' as const, label: `Device voice · preview audio${voices.length === 1 ? ' · one voice profile' : ''}` } : { mode: 'unavailable' as const, label: requiredWords.length ? 'No complete audio voice is available for this sound contrast.' : 'Audio is unavailable for this language on this device.' };
}

export function stopAudio() {
  playbackGeneration += 1;
  cancelPlayback?.();
  cancelPlayback = undefined;
  currentAudio?.pause();
  currentAudio = undefined;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.cancel();
}

export async function playWord(languageId: string, word: Pick<Word, 'text'> & Partial<Pick<Word, 'ipa'>> | string, voiceId?: string, manifestPath = DEFAULT_MANIFEST, retry = true): Promise<PlayedRecording | undefined> {
  const text = typeof word === 'string' ? word : word.text;
  if (!text.trim()) throw new Error('This practice word has no audio text.');
  stopAudio();
  const generation = playbackGeneration;
  const data = await manifest(collectionFor(languageId, manifestPath));
  if (generation !== playbackGeneration) throw new Error('Playback was cancelled.');
  const candidates = data.clips.filter(c => c.languageId === languageId && normalize(c.text) === normalize(text) && (typeof word === 'string' || !word.ipa || c.ipa === word.ipa) && c.status !== 'rejected');
  const clip = voiceId ? candidates.find(c => c.voiceId === voiceId) : candidates[0];
  if (clip) {
    try { await new Promise<void>((resolve, reject) => {
      const player = new Audio(clip.url);
      currentAudio = player;
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        player.onended = null; player.onerror = null;
        if (currentAudio === player) { currentAudio = undefined; cancelPlayback = undefined; }
        error ? reject(error) : resolve();
      };
      const timeout = window.setTimeout(() => { player.pause(); finish(new Error('Audio timed out. Tap Listen to retry.')); }, 20000);
      cancelPlayback = () => { player.pause(); finish(new Error('Playback was cancelled.')); };
      player.onended = () => finish();
      player.onerror = () => finish(new Error('That recording could not load. Please try again.'));
      player.play().catch(() => finish(new Error('Your browser could not play audio. Tap Listen to try again.')));
    }); } catch (error) {
      if (!retry || generation !== playbackGeneration) throw error;
      manifestPromises.delete(collectionFor(languageId, manifestPath));
      return playWord(languageId, word, voiceId, manifestPath, false);
    }
    return clip;
  }
  if (manifestPath !== DEFAULT_MANIFEST) throw new Error('That recording is not available in this audio collection.');
  if (voiceId && !voiceId.startsWith('device:')) throw new Error('This voice does not yet have a recording for that word. Choose a different voice.');
  const voices = await deviceVoices();
  if (generation !== playbackGeneration) throw new Error('Playback was cancelled.');
  const locale = locales[languageId] || languageId;
  const selected = voiceId ? voices.find(v => `device:${v.voiceURI}` === voiceId) : voices.find(v => v.lang.toLowerCase() === locale.toLowerCase()) || voices.find(v => v.lang.toLowerCase().startsWith(locale.split('-')[0]));
  if (!selected) throw new Error('A matching voice is not available on this device. Cached recordings are being prepared.');
  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selected;
    utterance.lang = selected.lang;
    utterance.rate = 0.9;
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      utterance.onend = null; utterance.onerror = null;
      if (generation === playbackGeneration) cancelPlayback = undefined;
      error ? reject(error) : resolve();
    };
    const timeout = window.setTimeout(() => { speechSynthesis.cancel(); finish(new Error('Audio timed out. Tap Listen to retry.')); }, 20000);
    cancelPlayback = () => finish(new Error('Playback was cancelled.'));
    utterance.onend = () => finish();
    utterance.onerror = e => finish(new Error(e.error === 'not-allowed' ? 'Tap Listen to enable audio.' : 'Audio was interrupted. Tap Listen to retry.'));
    speechSynthesis.speak(utterance);
  });
}

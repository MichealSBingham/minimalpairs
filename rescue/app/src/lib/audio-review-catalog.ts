// Server-only: this module reads and hashes published files at build time.
// Client components must import these types with `import type` only.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Language } from './types';
import { comparisonLanguages, comparisonSources } from './audio-comparison.ts';
import { humanLibraryLanguages, HUMAN_LIBRARY_COLLECTION } from './human-library.ts';
import { ownerEnglishLanguages, OWNER_ENGLISH_COLLECTION, OWNER_ENGLISH_MANIFEST } from './owner-audio-preview.ts';

export type ReviewClip = {
  id: string; url: string | null; text: string; languageId: string; voiceId: string; voiceName: string;
  source: string; synthetic: boolean | null; sourceStatus: string; sha256: string | null; exists: boolean; collectionIds: string[];
};
export type ReviewWord = { text: string; ipa: string; meaning: string; clipIds: string[] };
export type ReviewPair = { id: string; trialGroup: string; targetPosition: string; words: [ReviewWord, ReviewWord] };
export type ReviewGroup = {
  id: string; collectionId: string; languageId: string; languageName: string; dialect: string;
  contrastId: string; label: string; phonemes: string[]; focus: string; notes: string[]; sources: string[];
  pairs: ReviewPair[]; voices: { id: string; name: string }[]; practiceHref?: string;
};
export type ReviewCatalog = {
  schemaVersion: 1; fingerprint: string; collections: { id: string; label: string }[];
  clips: ReviewClip[]; groups: ReviewGroup[]; unassignedClipIds: string[];
};
export type ReviewManifestVoice = { id: string; name: string; source?: string; provider?: string; [key: string]: unknown };
export type ReviewManifestClip = {
  languageId: string; text: string; voiceId: string; url?: string; status?: string;
  provider?: string; synthetic?: boolean; sha256?: string; [key: string]: unknown;
};
export type ReviewManifest = { voicesByLanguage: Record<string, ReviewManifestVoice[]>; clips: ReviewManifestClip[]; [key: string]: unknown };
export type ReviewCollectionInput = {
  id: string; label: string; manifest: ReviewManifest; languages: readonly Language[];
  practicePath?: string; practiceParams?: Record<string, string>;
};
export type ReviewFileState = { exists: boolean; sha256: string | null };
// Astro relocates this module during prerendering; resolve from its project root.
const publicRoot = path.resolve(process.cwd(), 'public');
const normalize = (text: string) => text.normalize('NFC').trim().toLocaleLowerCase();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
const unique = (values: string[]) => [...new Set(values)];
const fail = (message: string): never => { throw new Error(`Audio review catalog: ${message}`); };

/** JSON object key order must not change review identity; array order stays meaningful. */
export function stableReviewJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableReviewJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stableReviewJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
const digest = (value: unknown) => createHash('sha256').update(stableReviewJson(value)).digest('hex');

function safeAudioUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\/audio\/[A-Za-z0-9_./-]+\.(mp3|wav|ogg|webm|m4a)$/.test(value)
    && !value.split('/').some(part => part === '.' || part === '..' || /^(private|reserved|assessment)$/i.test(part));
}

/** No external URLs, traversal or symlink escapes. Only actual bytes establish a hash. */
export function readReviewAudioFile(url: string, root = publicRoot): ReviewFileState {
  if (!safeAudioUrl(url)) return { exists: false, sha256: null };
  const expectedRoot = path.resolve(root, 'audio');
  const filename = path.resolve(root, `.${url}`);
  if (!filename.startsWith(expectedRoot + path.sep)) return { exists: false, sha256: null };
  try {
    const actualPublicRoot = fs.realpathSync(root);
    const actualRoot = fs.realpathSync(expectedRoot);
    if (!actualRoot.startsWith(actualPublicRoot + path.sep)) return { exists: false, sha256: null };
    const actual = fs.realpathSync(filename);
    if (!actual.startsWith(actualRoot + path.sep) || path.relative(actualRoot, actual).split(path.sep)
      .some(part => /^(private|reserved|assessment)$/i.test(part)) || !fs.statSync(actual).isFile()) return { exists: false, sha256: null };
    return { exists: true, sha256: createHash('sha256').update(fs.readFileSync(actual)).digest('hex') };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) return { exists: false, sha256: null };
    return fail('a published audio file could not be read.');
  }
}

/** Pure collection mapping with an injectable local file reader for offline fixtures. */
export function buildAudioReviewCatalog(inputs: readonly ReviewCollectionInput[], readFile: (url: string) => ReviewFileState = readReviewAudioFile): ReviewCatalog {
  const clips = new Map<string, ReviewClip>();
  const groups: ReviewGroup[] = [];
  const assigned = new Set<string>();
  const fileCache = new Map<string, ReviewFileState>();
  const recordingNotes = new Map<string, string[]>();
  const collections = [...inputs].sort((a, b) => compare(a.id, b.id));
  if (new Set(collections.map(input => input.id)).size !== collections.length) fail('collection IDs must be unique.');

  for (const collection of collections) {
    const { manifest } = collection;
    if (!/^[a-z0-9_-]+$/.test(collection.id) || !manifest || !Array.isArray(manifest.clips)
      || !manifest.voicesByLanguage || typeof manifest.voicesByLanguage !== 'object') fail('a routed manifest is invalid.');
    const voicesByLanguage = new Map<string, ReviewManifestVoice[]>();
    for (const [languageId, rawVoices] of Object.entries(manifest.voicesByLanguage)) {
      if (!Array.isArray(rawVoices) || rawVoices.some(voice => !voice || typeof voice.id !== 'string' || !voice.id || typeof voice.name !== 'string')
        || new Set(rawVoices.map(voice => voice.id)).size !== rawVoices.length) fail('a voice declaration is invalid.');
      voicesByLanguage.set(languageId, [...rawVoices].sort((a, b) => compare(a.id, b.id)));
    }
    const byWordVoice = new Map<string, string[]>();
    const register = (clip: Omit<ReviewClip, 'collectionIds'>) => {
      const existing = clips.get(clip.id);
      if (existing) existing.collectionIds = unique([...existing.collectionIds, collection.id]).sort();
      else clips.set(clip.id, { ...clip, collectionIds: [collection.id] });
      return clip.id;
    };
    for (const raw of manifest.clips) {
      if (!raw || typeof raw.text !== 'string' || !raw.text.trim() || typeof raw.languageId !== 'string' || !raw.languageId
        || typeof raw.voiceId !== 'string' || !raw.voiceId) fail('a recording declaration is invalid.');
      const voice = voicesByLanguage.get(raw.languageId)?.find(item => item.id === raw.voiceId);
      const url = safeAudioUrl(raw.url) ? raw.url : null;
      let file = url ? fileCache.get(url) : undefined;
      if (url && !file) { file = readFile(url); fileCache.set(url, file); }
      file ??= { exists: false, sha256: null };
      if (file.exists ? !(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)) : file.sha256 !== null) fail('file hash and availability disagree.');
      const mismatch = file.exists && typeof raw.sha256 === 'string' && raw.sha256 !== file.sha256;
      const metadata = { recording: raw, voice: voice || null };
      const id = `clip-${digest({ sha256: file.sha256, exists: file.exists, metadata })}`;
      recordingNotes.set(id, [raw.reviewInstruction, raw.pronunciationNote, raw.recordingConditionWarning]
        .filter((note): note is string => typeof note === 'string' && note.length > 0));
      register({ id, url, text: raw.text, languageId: raw.languageId, voiceId: raw.voiceId,
        voiceName: voice?.name || `${raw.voiceId} (not declared in manifest)`,
        source: typeof raw.provider === 'string' ? raw.provider : voice?.source || voice?.provider || 'Unspecified source',
        synthetic: typeof raw.synthetic === 'boolean' ? raw.synthetic : null,
        sourceStatus: `${raw.status || 'unspecified'}${mismatch ? ' · manifest checksum mismatch' : ''}${!url ? ' · invalid audio path' : ''}`,
        sha256: file.sha256, exists: file.exists });
      const key = stableReviewJson([raw.languageId, raw.voiceId, normalize(raw.text)]);
      byWordVoice.set(key, unique([...(byWordVoice.get(key) || []), id]));
    }

    const collectionNotes = unique([manifest.scopeNote, manifest.note, ...strings(manifest.ownerReviewWarnings)]
      .filter((note): note is string => typeof note === 'string' && note.length > 0));
    const seenScopes = new Set<string>();
    for (const language of collection.languages) for (const contrast of language.contrasts) {
      const scope = `${language.id}:${contrast.id}`;
      if (seenScopes.has(scope)) fail('a collection repeats a contrast.');
      seenScopes.add(scope);
      const configured = voicesByLanguage.get(language.id) || [];
      // A nonplayable placeholder retains each word row when no profile is declared.
      const voices = configured.length ? configured.map(voice => ({ id: voice.id, name: voice.name }))
        : [{ id: 'missing-profile', name: 'No voice profile declared' }];
      const pairs: ReviewPair[] = contrast.pairs.map(pair => {
        if (pair.words.length !== 2) fail('each pair must contain two words.');
        const words = pair.words.map(word => {
          const clipIds = voices.flatMap(voice => {
            const key = stableReviewJson([language.id, voice.id, normalize(word.text)]);
            const existing = byWordVoice.get(key);
            if (existing?.length) return [...existing].sort();
            if (collection.id.startsWith('chatterbox-')) return [];
            const id = `missing-${digest({ collectionId: collection.id, languageId: language.id, voice,
              text: normalize(word.text), ipa: word.ipa, meaning: word.meaning })}`;
            register({ id, url: null, text: word.text, languageId: language.id, voiceId: voice.id, voiceName: voice.name,
              source: 'No cached recording', synthetic: null, sourceStatus: 'missing', sha256: null, exists: false });
            return [id];
          });
          clipIds.forEach(id => assigned.add(id));
          return { text: word.text, ipa: word.ipa, meaning: word.meaning, clipIds };
        }) as [ReviewWord, ReviewWord];
        return { id: pair.id, trialGroup: pair.abx?.trialGroup || 'all', targetPosition: pair.abx?.targetPosition || 'unspecified', words };
      });
      const dialectNote = (contrast as typeof contrast & { dialectNote?: string }).dialectNote;
      const notes = unique([contrast.description, dialectNote, ...collectionNotes,
        ...pairs.flatMap(pair => pair.words.flatMap(word => word.clipIds.flatMap(id => recordingNotes.get(id) || []))),
        ...(contrast.l1Notes || []).map(note => `For ${note.nativeLanguage} speakers: ${note.note}`),
        ...contrast.pairs.flatMap(pair => pair.note ? [`${pair.words.map(word => word.text).join(' / ')}: ${pair.note}`] : [])]
        .filter((note): note is string => typeof note === 'string' && note.length > 0));
      const practiceHref = collection.practicePath ? `${collection.practicePath}?${new URLSearchParams({
        ...collection.practiceParams, language: language.id, contrast: contrast.id }).toString()}` : undefined;
      const value = { collectionId: collection.id, languageId: language.id, languageName: language.name, dialect: language.dialect,
        contrastId: contrast.id, label: contrast.label, phonemes: [...contrast.phonemes],
        focus: contrast.targetSoundFocus || contrast.abx?.targetSoundFocus || contrast.description,
        notes, sources: unique([...(contrast.sources || []), ...contrast.pairs.flatMap(pair => pair.sources || [])]), pairs, voices,
        ...(practiceHref ? { practiceHref } : {}) };
      // Include exact authored contrast metadata as well as the projected word/clip
      // mapping. Changed IPA, category assignments, focus or media invalidate approval.
      const id = `${collection.id}:${contrast.id}:${digest({ value, authoredContrast: contrast, locale: language.locale })}`;
      groups.push({ id, ...value });
    }
  }
  const values = [...clips.values()].sort((a, b) => compare(a.id, b.id));
  groups.sort((a, b) => compare(a.id, b.id));
  const catalog = { schemaVersion: 1 as const, collections: collections.map(({ id, label }) => ({ id, label })), clips: values, groups,
    unassignedClipIds: values.filter(clip => !assigned.has(clip.id)).map(clip => clip.id) };
  return { ...catalog, fingerprint: digest(catalog) };
}

function manifestAt(url: string): ReviewManifest {
  if (!/^\/audio\/[A-Za-z0-9_./-]+\.json$/.test(url) || url.split('/').includes('..')) fail('invalid routed manifest path.');
  return JSON.parse(fs.readFileSync(path.join(publicRoot, url.slice(1)), 'utf8')) as ReviewManifest;
}

/** Exactly the app's routed, public collections; no private or held-out candidates. */
export function getAudioReviewCatalog(): ReviewCatalog {
  const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../content/curriculum.json'), 'utf8'));
  const main = (Array.isArray(raw) ? raw : raw.languages) as Language[];
  const comparison = comparisonLanguages(main);
  const us = JSON.parse(fs.readFileSync(path.resolve('src/data/us-chatterbox-curriculum.json'), 'utf8')) as Language;
  const expanded = ['fr','de','es','it','zh','pt','ru','ja'].map(bank => ({ id: `chatterbox-${bank}-four-voices-v1`, label: `${bank.toUpperCase()} · four Chatterbox voices`, manifest: manifestAt(`/audio/chatterbox-${bank}/manifest.json`), languages: [JSON.parse(fs.readFileSync(path.resolve(`src/data/${bank}-chatterbox-curriculum.json`),'utf8')) as Language], practicePath: '/practice' }));
  return buildAudioReviewCatalog([
    ...expanded,
    { id: 'chatterbox-us-four-voices-v1', label: 'US English · four Chatterbox voices', manifest: manifestAt('/audio/chatterbox-us/manifest.json'), languages: [us], practicePath: '/practice' },
    { id: 'qwen-starter-v1', label: 'Main practice · eight languages', manifest: manifestAt('/audio/manifest.json'), languages: main, practicePath: '/practice' },
    { id: HUMAN_LIBRARY_COLLECTION, label: 'Additional audio collection', manifest: manifestAt('/audio/human-library.json'), languages: humanLibraryLanguages(main), practicePath: '/human-audio-preview' },
    { id: OWNER_ENGLISH_COLLECTION, label: 'English fixed-reference preview', manifest: manifestAt(OWNER_ENGLISH_MANIFEST), languages: ownerEnglishLanguages(main), practicePath: '/english-audio-preview' },
    ...comparisonSources.map(source => ({ id: source.collectionId, label: `Comparison · ${source.name}`,
      manifest: manifestAt(source.manifestPath), languages: comparison, practicePath: '/audio-comparison', practiceParams: { source: source.id } })),
  ]);
}

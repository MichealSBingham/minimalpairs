import fs from 'node:fs';
import path from 'node:path';
import { buildSession } from './practice-engine.ts';
import { PLAN_AUDIO_COLLECTION, type PlanLanguage } from './listening-plan.ts';
import type { Language } from './types';

type Manifest = { voicesByLanguage?: Record<string, { id: string }[]>; clips?: { languageId: string; voiceId: string; text: string; url: string; status?: string }[] };
const normalize = (word: string) => word.normalize('NFC').trim().toLowerCase();

/** Server/build only. Coverage is availability, never a pronunciation endorsement. */
export function buildListeningPlanCatalog(languages: readonly Language[], manifest: Manifest, assetExists: (url: string) => boolean): PlanLanguage[] {
  return languages.flatMap(language => {
    const contrasts = language.contrasts.flatMap((contrast, index) => {
      if (!buildSession(contrast.pairs, 1, () => 0.25).length) return [];
      const required = new Set(contrast.pairs.flatMap(pair => pair.words.map(word => normalize(word.text))));
      const clips = (manifest.clips || []).filter(clip => clip.languageId === language.id && clip.status !== 'rejected'
        && typeof clip.text === 'string' && required.has(normalize(clip.text)) && typeof clip.url === 'string' && assetExists(clip.url));
      const profiles = [...new Set((manifest.voicesByLanguage?.[language.id] || []).map(voice => voice.id))]
        .filter(voiceId => [...required].every(word => clips.some(clip => clip.voiceId === voiceId && normalize(clip.text) === word)));
      if (profiles.length < 2) return [];
      const selected = clips.filter(clip => profiles.includes(clip.voiceId));
      return [{ id: contrast.id, soundLabel: `Sound contrast ${String(index + 1).padStart(2, '0')}`, profileCount: profiles.length, reviewed: selected.every(clip => clip.status === 'verified') }];
    });
    return contrasts.length >= 2 ? [{ id: language.id, name: language.name, audioCollectionId: PLAN_AUDIO_COLLECTION, contrasts }] : [];
  });
}

export function getListeningPlanCatalog(languages: readonly Language[]): PlanLanguage[] {
  try {
    const publicRoot = path.resolve(process.cwd(), 'public');
    const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'audio/manifest.json'), 'utf8'));
    return buildListeningPlanCatalog(languages, manifest, url => {
      if (!url.startsWith('/audio/') || url.includes('?') || url.includes('#')) return false;
      const asset = path.resolve(publicRoot, `.${url}`);
      return asset.startsWith(`${publicRoot}${path.sep}`) && fs.existsSync(asset) && fs.statSync(asset).isFile();
    });
  } catch { return []; }
}

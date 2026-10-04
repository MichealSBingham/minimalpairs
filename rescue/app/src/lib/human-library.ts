import type { Language } from './types';
import germanCandidate from '../data/human-german-curriculum.json' with { type: 'json' };

export const HUMAN_LIBRARY_COLLECTION = 'human-library-v1';
export const humanLibraryScopes = [
  { languageId: 'fr', contrastId: 'fr-u-y', pairIds: ['fr-tout-tu', 'fr-vous-vu', 'fr-roue-rue'] },
  { languageId: 'en', contrastId: 'en-i-ih', pairIds: ['en-ship-sheep', 'en-fill-feel', 'en-sit-seat'] },
  { languageId: 'en', contrastId: 'en-ae-strut', pairIds: ['en-cat-cut', 'en-cap-cup', 'en-lack-luck'] },
  { languageId: 'de', contrastId: 'de-i-length-pronouns', pairIds: ['de-in-ihn', 'de-im-ihm'] },
] as const;

export function humanLibraryLanguages(languages: readonly Language[]): Language[] {
  return ['fr', 'en', 'de'].map(id => {
    // The two-pair German candidate stays separate from the main curriculum.
    const language = (id === 'de' ? germanCandidate.languages : languages).find(item => item.id === id) as Language | undefined;
    if (!language) throw new Error(`Human library requires ${id}.`);
    const contrasts = humanLibraryScopes.filter(scope => scope.languageId === id).map(scope => {
      const contrast = language.contrasts.find(item => item.id === scope.contrastId);
      const pairs = scope.pairIds.map(pairId => contrast?.pairs.find(pair => pair.id === pairId));
      if (!contrast || pairs.some(pair => !pair)) throw new Error(`Human library requires every ${scope.contrastId} pair.`);
      return { ...contrast, pairs: pairs as NonNullable<typeof pairs[number]>[] };
    });
    return { ...language, dialect: `${language.name} · regional accents under review`, contrasts };
  });
}

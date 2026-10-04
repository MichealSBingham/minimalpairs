import type { Language } from './types';

export const OWNER_ENGLISH_COLLECTION = 'owner-fixed-reference-english-v1';
export const OWNER_ENGLISH_MANIFEST = '/audio/fixed-reference-expansion/manifest.json';
export const ownerEnglishScopes = [
  { contrastId: 'en-zh-j', pairIds: ['en-lesion-legion', 'en-pleasure-pledger', 'en-version-virgin'] },
  { contrastId: 'en-foot-strut', pairIds: ['en-put-putt', 'en-look-luck', 'en-book-buck'] },
  { contrastId: 'en-ae-strut', pairIds: ['en-cat-cut', 'en-cap-cup', 'en-lack-luck'] },
] as const;

/** Exact preview scope; fail closed if the shared curriculum changes underneath it. */
export function ownerEnglishLanguages(languages: readonly Language[]): Language[] {
  const language = languages.find(item => item.id === 'en');
  if (!language) throw new Error('English audio preview requires its source language.');
  const contrasts = ownerEnglishScopes.map(scope => {
    const contrast = language.contrasts.find(item => item.id === scope.contrastId);
    const pairs = scope.pairIds.map(id => contrast?.pairs.find(pair => pair.id === id));
    if (!contrast || pairs.some(pair => !pair)) throw new Error(`English audio preview requires the exact ${scope.contrastId} pairs.`);
    return { ...contrast, pairs: pairs as NonNullable<typeof pairs[number]>[] };
  });
  const conditional = contrasts[0].pairs.find(pair => pair.id === 'en-version-virgin')!;
  if (conditional.words[0].ipa !== '/ˈvɝʒən/' || conditional.words[1].ipa !== '/ˈvɝdʒən/') throw new Error('English audio preview requires the authored shared-schwa readings.');
  return [{ ...language, dialect: 'English · intended American accent under review', contrasts }];
}

export function ownerEnglishHistoryHref(contrastId: string): string {
  return ownerEnglishScopes.some(scope => scope.contrastId === contrastId)
    ? `/english-audio-preview?language=en&contrast=${encodeURIComponent(contrastId)}` : '/english-audio-preview';
}

import type { Language } from './types';

export const comparisonScopes = [
  { languageId: 'fr', contrastId: 'fr-u-y', pairIds: ['fr-tout-tu', 'fr-vous-vu', 'fr-roue-rue'] },
  { languageId: 'en', contrastId: 'en-i-ih', pairIds: ['en-ship-sheep', 'en-fill-feel', 'en-sit-seat'] },
] as const;

export const comparisonSources = [
  { id: 'generated', name: 'Collection A', kind: 'Listening comparison', manifestPath: '/audio/comparison/generated.json', collectionId: 'comparison-generated-v1', description: 'Compare the recordings for these sounds.', detail: 'Listen to each word and compare the available voices.' },
  { id: 'reference', name: 'Reference-conditioned candidate', kind: 'Listening comparison', manifestPath: '/audio/fixed-speaker-pilot/manifest.json', collectionId: 'comparison-fixed-reference-v1', description: 'Compare the recordings for these sounds.', detail: 'Listen to each word and compare the available voices.' },
  { id: 'human', name: 'Collection C', kind: 'Listening comparison', manifestPath: '/audio/comparison/human.json', collectionId: 'comparison-human-v1', description: 'Compare the recordings for these sounds.', detail: 'Listen to each word and compare the available voices.' },
] as const;

export function comparisonLanguages(languages: readonly Language[]): Language[] {
  return comparisonScopes.map(scope => {
    const language = languages.find(item => item.id === scope.languageId);
    const contrast = language?.contrasts.find(item => item.id === scope.contrastId);
    const pairs = scope.pairIds.map(id => contrast?.pairs.find(pair => pair.id === id));
    if (!language || !contrast || pairs.some(pair => !pair)) throw new Error(`Audio comparison requires all three ${scope.languageId} pairs.`);
    return { ...language, dialect: `${language.name} · accents under review`, contrasts: [{ ...contrast, pairs: pairs as NonNullable<typeof pairs[number]>[] }] };
  });
}

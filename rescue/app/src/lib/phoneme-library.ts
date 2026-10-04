import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertReservedContentExcluded, withMandarinReservations } from '../../scripts/reserved-content.mjs';
import { validateMandarinBalance, type MandarinBalance } from './mandarin-balance.ts';

export type EvidenceLevel = 'study-stimuli' | 'study-contrast' | 'phonology' | 'editorial-candidate';
export type ResearchSource = {
  id: string; title: string; url: string;
  kind: 'l2-study' | 'stimulus-list' | 'phonology' | 'dictionary' | 'editorial';
  locator: string; whatItSupports: string; limitations: string; license?: string;
};
export type ResearchWord = {
  text: string; ipa: string; meaning: string; reading?: string; romanization?: string;
  position: string; group: string; sourceIds: string[]; stimulusSourceIds: string[];
  targetSegment?: string; targetOccurrence?: number; segmentalFrame?: string; split?: 'train';
};
export type ResearchContrast = {
  id: string; languageId: string; dialect: string; label: string;
  varietyId?: 'en-US-ga' | 'en-GB-ssbe';
  categories: [{ label: string; ipa: string }, { label: string; ipa: string }];
  evidenceLevel: EvidenceLevel; sourceIds: string[]; learnerL1s: string[];
  rationale: string; scopeNote?: string; contextNotes: string[]; pools: [ResearchWord[], ResearchWord[]];
  minimalPairs: { left: string; right: string; sourceIds: string[] }[];
  reviewNotes: string[]; status: 'draft';
};
export type ResearchPack = {
  languageIds: string[]; searchedAt: string;
  searchLog: { query: string; outcome: string }[];
  sources: ResearchSource[]; contrasts: ResearchContrast[]; gaps: string[];
};
export type Lexeme = { id: string; languageId: string; dialect: string; text: string; ipa: string; meaning: string; reading?: string; romanization?: string };
export type PoolMember = { key: string; wordId: string; position: string; group: string; sourceIds: string[]; stimulusSourceIds: string[]; targetSegment?: string; targetOccurrence?: number; segmentalFrame?: string; split?: 'train' };
export type PoolContrast = Omit<ResearchContrast, 'pools' | 'minimalPairs'> & {
  key: string; pools: [PoolMember[], PoolMember[]];
  minimalPairs: { leftWordId: string; rightWordId: string; sourceIds: string[] }[];
  contextGroups: { id: string; counts: [number, number]; distinctPronunciations: [number, number]; positions: string[]; hasCrossWordCapacity: boolean; meetsMinimumDepth: boolean; meetsTargetDepth: boolean }[];
  depth: { distinctWords: [number, number]; distinctPronunciations: [number, number]; meetsMinimum: boolean; meetsTarget: boolean; hasMinimumContext: boolean };
};
export type PronunciationBank = { id: string; languageId: string; name: string; reference: string };
export type TextBankRelease = { id: string; label: string; status: 'frozen-for-audio-planning'; frozenAt: string; libraryFingerprint: string; scope: string; audioGenerated: 0 };
export const contrastBankId = (contrast: Pick<ResearchContrast, 'languageId' | 'varietyId'>) => contrast.varietyId || contrast.languageId;
export type PhonemeLibrary = {
  schemaVersion: 1; fingerprint: string; stage: 'text-review';
  languages: { id: string; name: string; nativeName: string }[];
  banks: PronunciationBank[]; release?: TextBankRelease; mandarinBalance?: MandarinBalance;
  words: Record<string, Lexeme>; contrasts: PoolContrast[]; sources: ResearchSource[];
  research: { languageIds: string[]; searchedAt: string; searchLog: ResearchPack['searchLog']; gaps: string[] }[];
  reviewPolicy: { minimumWordsPerPool: number; targetWordsPerPool: number; countUnit: string; claimLimit: string };
  counts: { contrasts: number; uniqueWords: number; memberships: number; documentedStimulusMemberships: number };
};
const languageNames = [
  ['en', 'English', 'English'], ['fr', 'French', 'Français'], ['de', 'German', 'Deutsch'],
  ['es', 'Spanish', 'Español'], ['it', 'Italian', 'Italiano'], ['zh', 'Mandarin', '普通话'],
  ['pt', 'Portuguese', 'Português'], ['ru', 'Russian', 'Русский'], ['ja', 'Japanese', '日本語'],
];
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const normalize = (value: string) => value.normalize('NFC').trim();
const lexicalText = (value: string) => normalize(value).toLocaleLowerCase();
// Authored broad IPA forms only: syllable separators and transcription brackets do not create new forms.
const phonologicalForm = (value: string) => normalize(value).replace(/[/.\[\]\s]/g, '');
const minimumWordsPerPool = 4, targetWordsPerPool = 5;
const requireText = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}`);
  return normalize(value);
};

/** Research drafts are separate from the live curriculum. No audio inventory is read. */
export function buildPhonemeLibrary(packs: ResearchPack[], mandarinBalance?: MandarinBalance): PhonemeLibrary {
  if (mandarinBalance) validateMandarinBalance(packs, mandarinBalance);
  const sources = packs.flatMap(pack => pack.sources).map(source => {
    const localDraft = source.kind === 'editorial' && /^rescue\/content\/[a-zA-Z0-9_./-]+$/.test(source.url) && !source.url.split('/').includes('..');
    if (!/^https:\/\//.test(source.url) && !localDraft) throw new Error(`Unsafe source URL: ${source.id}`);
    for (const field of ['id', 'title', 'locator', 'whatItSupports', 'limitations'] as const) requireText(source[field], `source ${field}`);
    return { ...source };
  });
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  if (sourceMap.size !== sources.length) throw new Error('Duplicate research source ID');
  const checkSources = (ids: string[], location: string) => {
    if (!Array.isArray(ids) || ids.some(id => !sourceMap.has(id))) throw new Error(`Unknown source in ${location}`);
    return [...new Set(ids)].sort();
  };
  const words: Record<string, Lexeme> = {};
  const seen = new Set<string>();
  const contrasts: PoolContrast[] = packs.flatMap(pack => pack.contrasts).map(input => {
    if (seen.has(input.id)) throw new Error(`Duplicate contrast ${input.id}`);
    seen.add(input.id);
    if (!languageNames.some(([id]) => id === input.languageId)) throw new Error(`Unknown language ${input.languageId}`);
    if (input.status !== 'draft' || input.categories.length !== 2 || input.pools.length !== 2) throw new Error(`Invalid draft ${input.id}`);
    if (!['study-stimuli', 'study-contrast', 'phonology', 'editorial-candidate'].includes(input.evidenceLevel)) throw new Error(`Invalid evidence ${input.id}`);
    const dialect = requireText(input.dialect, `${input.id} dialect`);
    if (input.varietyId && (input.languageId !== 'en' || !['en-US-ga', 'en-GB-ssbe'].includes(input.varietyId))) throw new Error(`Invalid English variety ${input.id}`);
    const variety = input.varietyId ? { varietyId: input.varietyId } : {};
    const scope = input.scopeNote ? { scopeNote: requireText(input.scopeNote, `${input.id} scope note`) } : {};
    const categories = input.categories.map(category => ({ label: requireText(category.label, 'category label'), ipa: requireText(category.ipa, 'category IPA') })) as ResearchContrast['categories'];
    if (categories[0].ipa === categories[1].ipa) throw new Error(`Identical categories ${input.id}`);
    const pools = input.pools.map((pool, side) => {
      if (!pool.length) throw new Error(`Empty pool ${input.id}:${side}`);
      const memberIds = new Set<string>();
      return pool.map(word => {
        const lexeme = {
          languageId: input.languageId, dialect, text: requireText(word.text, 'word'),
          ipa: requireText(word.ipa, 'word IPA'), meaning: requireText(word.meaning, 'meaning'),
          ...(word.reading ? { reading: requireText(word.reading, 'word reading') } : {}),
          ...(word.romanization ? { romanization: normalize(word.romanization) } : {}),
        };
        const id = `word:${hash(lexeme)}`;
        words[id] = { id, ...lexeme };
        const membership = {
          wordId: id, position: requireText(word.position, 'target position'), group: requireText(word.group, 'context group'),
          sourceIds: checkSources(word.sourceIds, word.text), stimulusSourceIds: checkSources(word.stimulusSourceIds, word.text),
          ...(word.targetSegment ? { targetSegment: requireText(word.targetSegment, 'target segment') } : {}),
          ...(word.targetOccurrence !== undefined ? { targetOccurrence: word.targetOccurrence } : {}),
          ...(word.segmentalFrame ? { segmentalFrame: requireText(word.segmentalFrame, 'segmental frame') } : {}),
          ...(word.split ? { split: word.split } : {}),
        };
        if (word.targetOccurrence !== undefined && (!word.targetSegment || !Number.isInteger(word.targetOccurrence) || word.targetOccurrence < 1)) throw new Error(`Invalid target occurrence ${input.id}: ${word.text}`);
        for (const sourceId of membership.stimulusSourceIds) {
          if (!['l2-study', 'stimulus-list'].includes(sourceMap.get(sourceId)!.kind)) throw new Error(`Non-study stimulus provenance: ${word.text}`);
        }
        const localId = `${id}:${membership.group}:${membership.position}`;
        if (memberIds.has(localId)) throw new Error(`Duplicate pool membership: ${input.id} ${word.text}`);
        memberIds.add(localId);
        // Approving the spelling in one category never approves a different category.
        const provenance = [...new Set([...input.sourceIds, ...membership.sourceIds, ...membership.stimulusSourceIds])].sort().map(id => sourceMap.get(id));
        const key = `pool-word:${hash({ contrastId: input.id, dialect, categories, side, ...membership, lexeme, provenance, evidenceLevel: input.evidenceLevel, ...scope, ...variety })}`;
        return { ...membership, key };
      });
    }) as [PoolMember[], PoolMember[]];
    const groupIds = [...new Set(pools.flat().map(word => word.group))];
    const contextGroups = groupIds.map(id => {
      const lexicalSets = pools.map(pool => new Set(pool.filter(word => word.group === id).map(word => lexicalText(words[word.wordId].text))));
      const counts = lexicalSets.map(set => set.size) as [number, number];
      const distinctPronunciations = pools.map(pool => new Set(pool.filter(word => word.group === id).map(word => phonologicalForm(words[word.wordId].ipa))).size) as [number, number];
      const positions = [...new Set(pools.flat().filter(word => word.group === id).map(word => word.position))].sort();
      const hasDistinctAssignments = [...lexicalSets[0]].some(a => [...lexicalSets[1]].some(b => a !== b && lexicalSets.every(set => [...set].some(x => x !== a && x !== b))));
      // This checks capacity only, not whether all Cartesian combinations are linguistically appropriate.
      const hasCrossWordCapacity = positions.length === 1 && counts.every(count => count >= 2) && hasDistinctAssignments;
      return { id, counts, distinctPronunciations, positions, hasCrossWordCapacity, meetsMinimumDepth: hasCrossWordCapacity && [...counts, ...distinctPronunciations].every(count => count >= minimumWordsPerPool), meetsTargetDepth: hasCrossWordCapacity && [...counts, ...distinctPronunciations].every(count => count >= targetWordsPerPool) };
    });
    const distinctWords = pools.map(pool => new Set(pool.map(member => lexicalText(words[member.wordId].text))).size) as [number, number];
    const distinctPronunciations = pools.map(pool => new Set(pool.map(member => phonologicalForm(words[member.wordId].ipa))).size) as [number, number];
    const depth = { distinctWords, distinctPronunciations, meetsMinimum: distinctWords.every(n => n >= minimumWordsPerPool), meetsTarget: distinctWords.every(n => n >= targetWordsPerPool), hasMinimumContext: contextGroups.some(group => group.meetsMinimumDepth) };
    const minimalPairs = input.minimalPairs.map(pair => {
      const resolve = (text: string, side: number) => {
        const matches = [...new Set(pools[side].filter(member => lexicalText(words[member.wordId].text) === lexicalText(text)).map(member => member.wordId))];
        if (matches.length !== 1) throw new Error(`Unresolved minimal-pair word ${input.id}: ${text}`);
        return matches[0];
      };
      return { leftWordId: resolve(pair.left, 0), rightWordId: resolve(pair.right, 1), sourceIds: checkSources(pair.sourceIds, input.id) };
    });
    const contrast = {
      id: input.id, languageId: input.languageId, dialect, ...variety, label: requireText(input.label, 'contrast label'), categories,
      evidenceLevel: input.evidenceLevel, sourceIds: checkSources(input.sourceIds, input.id), learnerL1s: [...input.learnerL1s],
      rationale: requireText(input.rationale, 'rationale'), ...scope, contextNotes: [...input.contextNotes], pools, minimalPairs,
      reviewNotes: [...input.reviewNotes], status: 'draft' as const, contextGroups, depth,
    };
    if (contrast.evidenceLevel === 'study-stimuli' && !pools.flat().some(word => word.stimulusSourceIds.length)) throw new Error(`Missing documented stimuli ${input.id}`);
    // Derived depth badges do not invalidate an unchanged linguistic review.
    const reviewIdentity = { ...contrast, depth: undefined, contextGroups: contextGroups.map(({ id, counts, positions, hasCrossWordCapacity }) => ({ id, counts, positions, hasCrossWordCapacity })) };
    return { ...contrast, key: `pool-contrast:${hash(reviewIdentity)}` };
  });
  const bankOrder = languageNames.flatMap(([id]) => id === 'en' ? ['en-US-ga', 'en-GB-ssbe', 'en'] : [id]);
  const banks = [...new Set(contrasts.map(contrastBankId))].sort((a, b) => bankOrder.indexOf(a) - bankOrder.indexOf(b)).map(id => {
    const example = contrasts.find(c => contrastBankId(c) === id)!;
    const name = id === 'en-US-ga' ? 'American English' : id === 'en-GB-ssbe' ? 'British English' : languageNames.find(([languageId]) => languageId === example.languageId)![1];
    const reference = id === 'en-US-ga' ? 'General American' : id === 'en-GB-ssbe' ? 'Standard Southern British' : example.dialect;
    return { id, languageId: example.languageId, name, reference };
  });
  const value = {
    schemaVersion: 1 as const, stage: 'text-review' as const,
    languages: languageNames.filter(([id]) => contrasts.some(c => c.languageId === id)).map(([id, name, nativeName]) => ({ id, name, nativeName })),
    banks, words, contrasts, sources, ...(mandarinBalance ? { mandarinBalance } : {}),
    reviewPolicy: { minimumWordsPerPool, targetWordsPerPool, countUnit: 'Distinct spellings within each sound category; repeated contexts and homograph senses do not increase depth. Broad IPA forms are counted separately: homophones do not add a new listening example, and context depth requires both counts to meet the floor.', claimLimit: 'An owner-set starting floor, not an experimentally established optimum or approval of any word, context or audio.' },
    research: packs.map(pack => ({ languageIds: pack.languageIds, searchedAt: pack.searchedAt, searchLog: pack.searchLog, gaps: pack.gaps })),
    counts: { contrasts: contrasts.length, uniqueWords: Object.keys(words).length, memberships: contrasts.reduce((n, c) => n + c.pools.flat().length, 0), documentedStimulusMemberships: contrasts.reduce((n, c) => n + c.pools.flat().filter(w => w.stimulusSourceIds.length).length, 0) },
  };
  return { ...value, fingerprint: hash(value) };
}

export function getPhonemeLibrary(): PhonemeLibrary {
  const directory = path.resolve(process.cwd(), '../content/phoneme-research');
  const balanceFile = path.join(directory, 'mandarin-balance.json');
  const balance = fs.existsSync(balanceFile) ? JSON.parse(fs.readFileSync(balanceFile, 'utf8')) : undefined;
  const library = buildPhonemeLibrary(['english.json', 'french-german.json', 'other-languages.json', 'british-english.json', 'japanese.json'].map(file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))), balance);
  const lexicalPolicy = JSON.parse(fs.readFileSync(path.join(directory, 'lexical-policy.json'), 'utf8')) as { minimumDistinctWordsPerSound: number; targetDistinctWordsPerSound: number; currentExclusions: { languageId: string; text: string }[] };
  if (lexicalPolicy.minimumDistinctWordsPerSound !== minimumWordsPerPool || lexicalPolicy.targetDistinctWordsPerSound !== targetWordsPerPool) throw new Error('Research depth policy differs from the review thresholds');
  for (const excluded of lexicalPolicy.currentExclusions) {
    if (Object.values(library.words).some(word => word.languageId === excluded.languageId && lexicalText(word.text) === lexicalText(excluded.text))) throw new Error(`Excluded review vocabulary: ${excluded.languageId}:${excluded.text}`);
  }
  const reserved = withMandarinReservations(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../content/transfer-candidates.json'), 'utf8')), balance);
  const exportedLanguages = library.languages.map(language => ({ id: language.id, contrasts: library.contrasts.filter(c => c.languageId === language.id).map(c => ({ pairs: [{ id: c.id, words: c.pools.flat().map(member => library.words[member.wordId]) }] })) }));
  assertReservedContentExcluded(exportedLanguages, reserved);
  const releaseFile = path.join(directory, 'text-bank-release.json');
  if (fs.existsSync(releaseFile)) return attachTextBankRelease(library, JSON.parse(fs.readFileSync(releaseFile, 'utf8')));
  return library;
}

/** Freezing the inventory does not mark words or recordings as pronunciation-approved. */
export function attachTextBankRelease(library: PhonemeLibrary, release: TextBankRelease): PhonemeLibrary {
  if (!/^text-bank-v[1-9][0-9]*$/.test(release.id) || release.status !== 'frozen-for-audio-planning' || release.audioGenerated !== 0 || !release.label || !release.scope || !Number.isFinite(Date.parse(release.frozenAt))) throw new Error('Invalid text-bank release');
  if (release.libraryFingerprint !== library.fingerprint) throw new Error('The frozen word bank changed. Review the correction and explicitly version a new text-bank release before publication.');
  return { ...library, release };
}

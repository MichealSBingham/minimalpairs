import type { ResearchPack } from './phoneme-library';

export type ToneWord = {
  id: string; text: string; ipa: string; romanization: string; meaning: string;
  tone: number; segmentalFrame: string; split: 'train' | 'heldout'; sourceIds: string[]; stimulusSourceIds: string[];
};
export type ToneComparison = { contrastId: string; tones: [number, number]; segmentalFrames: string[]; wordIdsByTone: [string[], string[]] };
export type MandarinBalance = {
  schemaVersion: 1; languageId: 'zh'; status: string; basedOnRelease: string; dialect: string; createdAt: string;
  lexicalItems: ToneWord[]; trainingComparisons: ToneComparison[]; heldoutComparisons: ToneComparison[];
  audition: { wordIds: string[]; purpose: string }; policies: string[];
};
const frame = (reading: string) => reading.normalize('NFD').replace(/[\u0300\u0301\u0304\u030c1-5\s]/gu, '').normalize('NFC').toLowerCase();
const equal = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Reject lexical shortcuts and test leakage before publishing the text bank. */
export function validateMandarinBalance(packs: ResearchPack[], balance: MandarinBalance) {
  if (balance.schemaVersion !== 1 || balance.languageId !== 'zh') throw new Error('Invalid Mandarin balance version');
  const words = new Map(balance.lexicalItems.map(w => [w.id, w]));
  if (words.size !== balance.lexicalItems.length) throw new Error('Duplicate Mandarin item identity');
  for (const word of words.values()) {
    if (!word.text || !word.ipa || !word.meaning || !word.sourceIds.length || ![1,2,3,4].includes(word.tone) || !['train','heldout'].includes(word.split) || frame(word.romanization) !== word.segmentalFrame) throw new Error(`Invalid Mandarin item: ${word.id}`);
  }
  const training = balance.lexicalItems.filter(w => w.split === 'train');
  const heldout = balance.lexicalItems.filter(w => w.split === 'heldout');
  const reservedFrames = new Set(heldout.map(w => w.segmentalFrame));
  if (training.some(w => reservedFrames.has(w.segmentalFrame))) throw new Error('Held-out Mandarin frame leaked into training');
  const contrasts = packs.flatMap(p => p.contrasts).filter(c => c.languageId === 'zh');
  for (const c of contrasts) for (const w of c.pools.flat()) {
    if (reservedFrames.has(w.segmentalFrame || frame(w.romanization || '')) || heldout.some(h => h.text === w.text || h.ipa === w.ipa)) throw new Error(`Held-out Mandarin item leaked into ${c.id}`);
  }
  for (const [split, comparisons] of [['train', balance.trainingComparisons], ['heldout', balance.heldoutComparisons]] as const) {
    if (comparisons.length !== 6 || new Set(comparisons.map(c => c.tones.join('-'))).size !== 6) throw new Error('Mandarin needs all six tone comparisons');
    for (const comparison of comparisons) {
      const contrast = contrasts.find(c => c.id === comparison.contrastId);
      if (!contrast || comparison.tones[0] >= comparison.tones[1]) throw new Error('Invalid Mandarin tone comparison');
      if (comparison.segmentalFrames.length < (split === 'train' ? 4 : 2)) throw new Error('Insufficient balanced Mandarin frames');
      comparison.wordIdsByTone.forEach((ids, side) => {
        const selected = ids.map(id => words.get(id));
        if (selected.some(w => !w || w.split !== split || w.tone !== comparison.tones[side])) throw new Error('Wrong Mandarin split or category');
        if (!equal(selected.map(w => w!.segmentalFrame), comparison.segmentalFrames) || new Set(comparison.segmentalFrames).size !== comparison.segmentalFrames.length) throw new Error('Unbalanced Mandarin syllable frames');
        if (split === 'train') {
          const pool = contrast.pools[side];
          if (!equal(pool.map(w => `${w.text}|${w.ipa}`), selected.map(w => `${w!.text}|${w!.ipa}`))) throw new Error(`Training pool differs from balanced selection: ${contrast.id}`);
          if (pool.some(w => w.split !== 'train' || !w.segmentalFrame)) throw new Error('Missing explicit Mandarin training metadata');
        }
      });
      const byFrame = comparison.wordIdsByTone.map(ids => new Map(ids.map(id => {
        const word = words.get(id)!; return [word.segmentalFrame, word.ipa.replace(/[˥˦˧˨˩]/gu, '')];
      })));
      if (comparison.segmentalFrames.some(frame => byFrame[0].get(frame) !== byFrame[1].get(frame))) throw new Error('A Mandarin tone pair also changes its segmental IPA');
    }
  }
  if (new Set(balance.audition.wordIds).size !== balance.audition.wordIds.length || balance.audition.wordIds.some(id => words.get(id)?.split !== 'train')) throw new Error('Audition contains unknown or reserved assessment words');
  return { trainingWords: training.length, heldoutWords: heldout.length, comparisons: 6 };
}

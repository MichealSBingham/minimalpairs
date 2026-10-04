import type { Pair } from './types';

export type WordIndex = 0 | 1;
export type PracticeQuestion = { pair: Pair; testPair: Pair; target: WordIndex; order: [WordIndex, WordIndex]; referenceVoiceId?: string; testVoiceId?: string };
type Random = () => number;

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const normalize = (word: string) => word.normalize('NFC').trim().toLocaleLowerCase();
function testCandidates(pairs: readonly Pair[], reference: Pair, target: WordIndex): Pair[] {
  const references = new Set(reference.words.map(word => normalize(word.text)));
  const sounds = new Set(reference.words.map(word => (word.ipa || '').replace(/[\/\[\]\sˈˌ.]/g, '')).filter(Boolean));
  return pairs.filter(pair => pair.id !== reference.id && (pair.abx?.trialGroup || 'all') === (reference.abx?.trialGroup || 'all') && !references.has(normalize(pair.words[target].text)) && !sounds.has((pair.words[target].ipa || '').replace(/[\/\[\]\sˈˌ.]/g, '')));
}

/** Cross-word ABX: A/B are references; X is a new word in the target category. */
export function buildSession(pairs: readonly Pair[], length = 12, random: Random = Math.random, referenceAvailable: (pair: Pair) => boolean = () => true): PracticeQuestion[] {
  if (!pairs.length || length <= 0) return [];
  const eligiblePairs = pairs.filter(pair => referenceAvailable(pair) && testCandidates(pairs, pair, 0).length && testCandidates(pairs, pair, 1).length);
  if (!eligiblePairs.length) return [];
  const count = Math.floor(length);
  const selectedPairs: Pair[] = [];
  while (selectedPairs.length < count) {
    const cycle = shuffle(eligiblePairs, random);
    if (cycle.length > 1 && selectedPairs.at(-1)?.id === cycle[0].id) [cycle[0], cycle[1]] = [cycle[1], cycle[0]];
    selectedPairs.push(...cycle.slice(0, count - selectedPairs.length));
  }
  return selectedPairs.map(pair => {
    // Independent draws, with no remaining quota a learner could count down.
    const target: WordIndex = random() < 0.5 ? 0 : 1;
    const correctReference: WordIndex = random() < 0.5 ? 0 : 1;
    const order: [WordIndex, WordIndex] = correctReference === target ? [0, 1] : [1, 0];
    const candidates = testCandidates(pairs, pair, target);
    const testPair = candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)))];
    return { pair, testPair, target, order };
  });
}

/** Voice identity is drawn independently of category, answer and earlier trials. */
export function assignSessionVoices(questions: readonly PracticeQuestion[], voiceIds: readonly string[], random: Random = Math.random): PracticeQuestion[] {
  const available = [...new Set(voiceIds)];
  if (available.length < 2) return questions.map(question => ({ ...question, referenceVoiceId: available[0], testVoiceId: available[0] }));
  const pick = (voices: string[]) => voices[Math.min(voices.length - 1, Math.max(0, Math.floor(random() * voices.length)))];
  return questions.map(question => {
    const referenceVoiceId = pick(available);
    const testVoiceId = pick(available.filter(id => id !== referenceVoiceId));
    return { ...question, referenceVoiceId, testVoiceId };
  });
}

/** Revisit a mistake after two other rounds, preserving future answer and voice draws. */
export function revisitMistake(questions: readonly PracticeQuestion[], answeredIndex: number, gap = 3): PracticeQuestion[] {
  const next = [...questions];
  if (answeredIndex < 0 || !questions[answeredIndex]) return next;
  const question = questions[answeredIndex];
  const reviewIndex = questions.findIndex((candidate, index) => index >= answeredIndex + Math.max(1, Math.floor(gap)) && candidate.target === question.target);
  if (reviewIndex < 0) return next;
  next[reviewIndex] = { ...questions[reviewIndex], pair: question.pair, testPair: question.testPair };
  return next;
}

import type { Word, Pair } from './types';
import type { PracticeQuestion } from './practice-engine';
export type AvailableClip = { languageId: string; text: string; ipa?: string; voiceId: string; url: string; status?: string };
const normalize = (s: string) => s.normalize('NFC').trim().toLowerCase();
export function wordVoices(clips: readonly AvailableClip[], languageId: string, word: Word): string[] {
  return [...new Set(clips.filter(c => c.languageId === languageId && normalize(c.text) === normalize(word.text) && c.ipa === word.ipa && c.status !== 'rejected' && c.url).map(c => c.voiceId))];
}
export function referenceVoices(clips: readonly AvailableClip[], languageId: string, pair: Pair): string[] {
  const a=wordVoices(clips,languageId,pair.words[0]),b=wordVoices(clips,languageId,pair.words[1]);
  return a.filter(v=>b.includes(v));
}
/** Exclude temporarily under-covered words before either game builds its queue. */
export function playablePairs(pairs: readonly Pair[], clips: readonly AvailableClip[], languageId: string): Pair[] {
  return pairs.filter(pair => pair.words.every(word => wordVoices(clips, languageId, word).length >= 2));
}
/** Choose only real recordings, without tying voice identity to the answer category. */
export function assignAvailableVoices(questions: readonly PracticeQuestion[], clips: readonly AvailableClip[], languageId: string, random = Math.random): PracticeQuestion[] {
  const pick=(items:string[])=>items[Math.min(items.length-1,Math.floor(random()*items.length))];
  return questions.map(q=>{
    const tests=wordVoices(clips,languageId,q.testPair.words[q.target]);
    const refs=referenceVoices(clips,languageId,q.pair).filter(v=>tests.some(x=>x!==v));
    if(!refs.length)throw new Error('This round needs replacement recordings. Please try another lesson.');
    const referenceVoiceId=pick(refs),testVoiceId=pick(tests.filter(v=>v!==referenceVoiceId));
    return {...q,referenceVoiceId,testVoiceId};
  });
}

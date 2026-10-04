import { useEffect, useRef, useState } from 'react';
import { getVoices, getPracticeAudio, playWord, stopAudio } from '../lib/audio';
import {wordVoices} from '../lib/round-voices';
import ReportRecording from './ReportRecording';
import type {PlayedRecording} from '../lib/audio';
import { Icon } from './ui';

type Props = { languageId: string; word: string; ipa?: string; requiredWords: string[]; pairWords?: {text:string;ipa:string}[]; hasCachedAudio: boolean; side?: number };

/** Exact-IPA recordings; both words in a displayed pair share an available voice. */
export default function GuideWordAudio({ languageId, word, ipa, requiredWords, pairWords, hasCachedAudio, side = 0 }: Props) {
  const [clip,setClip]=useState<PlayedRecording>();
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'playing' | 'unavailable'>(hasCachedAudio ? 'loading' : 'unavailable');
  const [error, setError] = useState('');
  const alive = useRef(false);
  const playing = useRef(false);
  const coverageKey = JSON.stringify(requiredWords);

  useEffect(() => {
    alive.current = true;
    let current = true;
    setClip(undefined); setVoiceId(null); setError(''); setPhase(hasCachedAudio ? 'loading' : 'unavailable');
    if (hasCachedAudio) void (ipa ? getPracticeAudio(languageId).then(data => wordVoices(data.clips,languageId,{text:word,ipa,meaning:''}).filter(id=>!pairWords||pairWords.every(w=>wordVoices(data.clips,languageId,{...w,meaning:''}).includes(id))).map(id=>({id,source:'cached'}))) : getVoices(languageId, undefined, [word])).then(voices => {
      if (!current) return;
      const cached = voices.find(voice => voice.source !== 'device' && !voice.id.startsWith('device:'));
      setVoiceId(cached?.id || null); setPhase(cached ? 'ready' : 'unavailable');
    }).catch(() => { if (current) setPhase('unavailable'); });
    return () => { current = false; alive.current = false; if (playing.current) stopAudio(); };
  }, [languageId, word, ipa, coverageKey, JSON.stringify(pairWords), hasCachedAudio]);

  async function listen() {
    if (!voiceId || playing.current) return;
    playing.current = true; setPhase('playing'); setError('');
    try { const played=await playWord(languageId, {text:word,ipa}, voiceId);if(alive.current)setClip(played); }
    catch (cause) {
      // Starting another word intentionally stops this one through the shared adapter.
      if (alive.current && !(cause instanceof Error && cause.message === 'Playback was cancelled.')) {
        if (ipa) { try { const updated=await getPracticeAudio(languageId,undefined,true);setVoiceId(wordVoices(updated.clips,languageId,{text:word,ipa,meaning:''}).find(id=>!pairWords||pairWords.every(w=>wordVoices(updated.clips,languageId,{...w,meaning:''}).includes(id))) || null); } catch {} }
        setError('This recording could not play. Tap to retry.');
      }
    } finally { playing.current = false; if (alive.current) setPhase('ready'); }
  }

  return <span className={`guide-word-audio is-side-${side}`}>
    <button type="button" className="guide-play" onClick={() => void listen()} disabled={phase !== 'ready'}
      aria-label={phase === 'unavailable' ? `Recording unavailable for ${word}` : phase === 'loading' ? `Preparing recording for ${word}` : phase === 'playing' ? `Playing ${word}` : `Play ${word}`}
      aria-busy={phase === 'playing'} title={phase === 'unavailable' ? 'Cached recording not ready' : phase === 'playing' ? 'Playing recording' : 'Play recording'}>
      <Icon name={phase === 'playing' ? 'volume' : 'play'} size={15} />
    </button>
    {phase === 'unavailable' && <span className="guide-recording-unavailable">No recording</span>}
    <ReportRecording clip={clip} />
    {error && <span className="guide-audio-error" role="status">{error}</span>}
  </span>;
}

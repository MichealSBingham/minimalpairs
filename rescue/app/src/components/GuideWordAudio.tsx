import { useEffect, useRef, useState } from 'react';
import { getVoices, getPracticeAudio, playWord, stopAudio } from '../lib/audio';
import {wordVoices} from '../lib/round-voices';
import { Icon } from './ui';

const audioCopy = {
  en:['Play','Preparing recording','Playing','Recording unavailable','No recording','This recording could not play. Tap to retry.'],
  es:['Reproducir','Preparando audio','Reproduciendo','Audio no disponible','Sin audio','No se pudo reproducir el audio. Pulsa para volver a intentarlo.'],
  fr:['Écouter','Préparation de l’audio','Lecture en cours','Audio indisponible','Sans audio','Impossible de lire cet audio. Appuyez pour réessayer.'],
  pt:['Reproduzir','Preparando áudio','Reproduzindo','Áudio indisponível','Sem áudio','Não foi possível reproduzir o áudio. Toque para tentar novamente.'],
  de:['Abspielen','Aufnahme wird vorbereitet','Wird abgespielt','Aufnahme nicht verfügbar','Keine Aufnahme','Die Aufnahme konnte nicht abgespielt werden. Zum erneuten Versuch antippen.'],
  it:['Ascolta','Preparazione dell’audio','Riproduzione in corso','Audio non disponibile','Nessun audio','Impossibile riprodurre l’audio. Tocca per riprovare.'],
  ru:['Слушать','Подготовка записи','Воспроизведение','Запись недоступна','Нет записи','Не удалось воспроизвести запись. Нажмите, чтобы повторить.'],
  ja:['再生','音声を準備中','再生中','音声を利用できません','音声なし','音声を再生できませんでした。タップして再試行してください。'],
  zh:['播放','正在准备音频','正在播放','音频不可用','暂无音频','无法播放此音频，请点击重试。'],
};

type Props = { locale?: keyof typeof audioCopy; languageId: string; word: string; ipa?: string; requiredWords: string[]; pairWords?: {text:string;ipa:string}[]; hasCachedAudio: boolean; side?: number };

/** Exact-IPA recordings; both words in a displayed pair share an available voice. */
export default function GuideWordAudio({ languageId, word, ipa, requiredWords, pairWords, hasCachedAudio, side = 0, locale = 'en' }: Props) {
  const t = audioCopy[locale] || audioCopy.en;
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'playing' | 'unavailable'>(hasCachedAudio ? 'loading' : 'unavailable');
  const [error, setError] = useState('');
  const alive = useRef(false);
  const playing = useRef(false);
  const coverageKey = JSON.stringify(requiredWords);

  useEffect(() => {
    alive.current = true;
    let current = true;
    setVoiceId(null); setError(''); setPhase(hasCachedAudio ? 'loading' : 'unavailable');
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
    try { await playWord(languageId, {text:word,ipa}, voiceId); }
    catch (cause) {
      // Starting another word intentionally stops this one through the shared adapter.
      if (alive.current && !(cause instanceof Error && cause.message === 'Playback was cancelled.')) {
        if (ipa) { try { const updated=await getPracticeAudio(languageId,undefined,true);setVoiceId(wordVoices(updated.clips,languageId,{text:word,ipa,meaning:''}).find(id=>!pairWords||pairWords.every(w=>wordVoices(updated.clips,languageId,{...w,meaning:''}).includes(id))) || null); } catch {} }
        setError(t[5]);
      }
    } finally { playing.current = false; if (alive.current) setPhase('ready'); }
  }

  return <span className={`guide-word-audio is-side-${side}`}>
    <button type="button" className="guide-play" onClick={() => void listen()} disabled={phase !== 'ready'}
      aria-label={`${phase === 'unavailable' ? t[3] : phase === 'loading' ? t[1] : phase === 'playing' ? t[2] : t[0]}: ${word}`}
      aria-busy={phase === 'playing'} title={phase === 'unavailable' ? t[3] : phase === 'playing' ? t[2] : t[0]}>
      <Icon name={phase === 'playing' ? 'volume' : 'play'} size={15} />
    </button>
    {phase === 'unavailable' && <span className="guide-recording-unavailable">{t[4]}</span>}
    {error && <span className="guide-audio-error" role="status">{error}</span>}
  </span>;
}

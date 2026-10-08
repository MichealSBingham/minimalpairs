import {nativeLanguageCopy} from '../lib/native-language-copy';
import DiagnosticHistory from './DiagnosticHistory';
import DiagnosticPreview from './DiagnosticPreview';
import {diagnosticShortCopy} from '../lib/diagnostic-short-copy';
import { useMeasuredExposure } from './useMeasuredExposure';
import { trackMeasuredPracticeEvent } from '../lib/measurement';
import {diagnosticCopy} from '../lib/diagnostic-i18n';
import DiagnosticResults from './DiagnosticResults';
import CourseProgress from './CourseProgress';
import {nextCourseStep} from '../lib/course-progress';
import {buildIdentificationSession} from '../lib/identification';
import {identificationText} from '../lib/identification-i18n';
import { localizedSound, publicCopy } from '../lib/localized-public';
import { tr, trainerPath, type TrainerLocale } from '../lib/trainer-i18n';
import { runAnswerFeedback, answerCue } from '../lib/answer-feedback';
import ReportRecording from './ReportRecording';
import type {PlayedRecording} from '../lib/audio';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { completeMeasuredPractice, measuredAudioFailure, measuredFirstAnswer, startMeasuredPractice } from '../lib/measurement';
import { recommendReview, type ReviewRecommendation } from '../lib/review-recommendation';
import { selectJourneyContrasts, type JourneyMode } from '../lib/journey';
import {assignAvailableVoices, referenceVoices, wordVoices, type AvailableClip} from '../lib/round-voices';
import MembershipPanel from './MembershipPanel';
import ReviewSuggestion from './ReviewSuggestion';
import SessionFeedback from './SessionFeedback';
import { getAudioStatus, getVoices, getPracticeAudio, playWord, stopAudio } from '../lib/audio';
import { actualSessionAudioCollection, UNKNOWN_AUDIO_COLLECTION } from '../lib/session-audio-source';
import { assignSessionVoices, buildSession, revisitMistake, type PracticeQuestion as Question, type WordIndex } from '../lib/practice-engine';
import { practiceFocus } from '../lib/practice-focus';
import { Header, Icon, readProgress, writeProgress, type Language, type PracticeSession } from './ui';
import '../styles/trainer-redesign.css';

type Sample = 'a' | 'b' | 'x';
type Heard = Record<Sample, boolean>;
type Voice = { id: string; name: string; description?: string };
type JourneyQuestion = Question & { contrastId: string };
type Attempt = { contrastId: string; pairId: string; word: string; chosenWord: string; correctWord?: string; heardIpa?: string; chosenIpa?: string; correctIpa?: string; correct: boolean };
const unheard = (): Heard => ({ a: false, b: false, x: false });
const nativeLanguages = ['English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Russian', 'Mandarin Chinese', 'Japanese', 'Arabic', 'Hindi', 'Korean', 'Other'];
const nativeLanguageIds: Record<string, string> = { English: 'en', French: 'fr', Spanish: 'es', German: 'de', Italian: 'it', Portuguese: 'pt', Russian: 'ru', 'Mandarin Chinese': 'zh', Japanese: 'ja', Arabic: 'ar', Hindi: 'hi', Korean: 'ko' };

export default function Trainer({ locale = 'en', languages = [], initialLanguage, initialContrast, audioManifestPath, audioCollectionId = 'qwen-starter-v1', headerContent, signedIn = false, exerciseAccess = 'paid', onRetryAccess }: { locale?: TrainerLocale; languages: Language[]; initialLanguage?: string; initialContrast?: string; audioManifestPath?: string; audioCollectionId?: string; headerContent?: ReactNode; signedIn?: boolean; exerciseAccess?: 'checking' | 'free' | 'paid' | 'lifetime' | 'error'; onRetryAccess?: () => void }) {
  const t = (text: string, values: Record<string,string|number> = {}) => tr(locale, text, values);
  const dc = diagnosticCopy(locale);
  const short = diagnosticShortCopy(locale);
  const it = (index: number) => identificationText(locale,index);
  const [activityMode,setActivityMode] = useState<'abx-cross-word'|'word-identification'>('abx-cross-word');
  const path = (url: string) => trainerPath(locale, url);
  const [languageId, setLanguageId] = useState(initialLanguage || languages[0]?.id || '');
  const language = languages.find(item => item.id === languageId) || languages[0];
  const [contrastId, setContrastId] = useState(initialContrast || language?.contrasts[0]?.id || '');
  const contrast = language?.contrasts.find(item => item.id === contrastId) || language?.contrasts[0];
  const fullAccess = exerciseAccess === 'paid' || exerciseAccess === 'lifetime';
  const [pendingDiagnostic, setPendingDiagnostic] = useState(false);
  const [pendingLesson, setPendingLesson] = useState<string | null>(null);
  const [sessionRounds, setSessionRounds] = useState(12);
  const checkRounds = 2;
  const [journeyMode, setJourneyMode] = useState<JourneyMode>('focused');
  const identifying = activityMode === 'word-identification' && journeyMode !== 'diagnostic';
  const [history, setHistory] = useState<PracticeSession[]>([]);
  const [nativeLanguage, setNativeLanguage] = useState('');
  const nativeCopy = nativeLanguageCopy(locale);
  const nativeLabel = (name:string) => {
    const id=nativeLanguageIds[name];
    if(!id)return t(name);
    try{return new Intl.DisplayNames([locale],{type:'language'}).of(id)||t(name);}catch{return t(name);}
  };
  const selectedContrasts = selectJourneyContrasts(language?.contrasts || [], history, language?.id || '', fullAccess, journeyMode, contrast?.id || '', activityMode, nativeLanguage);
  const roundsPerGroup = journeyMode === 'focused' ? sessionRounds : journeyMode === 'diagnostic' ? checkRounds : Math.max(2, Math.floor(sessionRounds / Math.max(1, selectedContrasts.length)));
  const locked = journeyMode === 'focused' && !fullAccess && (language?.contrasts.findIndex(item => item.id === contrast?.id) ?? 0) >= 3;
  const [audioRevision, setAudioRevision] = useState(0);
  const [availableClips, setAvailableClips] = useState<AvailableClip[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [preparedAudioKey, setPreparedAudioKey] = useState<string | null>(null);
  const requiredWords = selectedContrasts.flatMap(c => c.pairs.flatMap(pair => pair.words.map(word => word.text)));
  const audioKey = JSON.stringify([language?.id, contrast?.id, audioManifestPath || '', requiredWords, audioRevision]);
  const audioPrepared = preparedAudioKey === audioKey;
  const [, setAudioStatus] = useState('Preparing audio…');
  const [phase, setPhase] = useState<'ready' | 'practice' | 'complete'>('ready');
  const [questions, setQuestions] = useState<JourneyQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<WordIndex | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [playedClips,setPlayedClips]=useState<Partial<Record<Sample,PlayedRecording>>>({});
  useEffect(()=>setPlayedClips({}),[index,phase,contrastId,languageId]);
  const [heard, setHeard] = useState<Heard>(unheard);
  const [playing, setPlaying] = useState<Sample | null>(null);
  const [sequencePlaying, setSequencePlaying] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [textHints, setTextHints] = useState(false);
  const [roundRevealed, setRoundRevealed] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [completedSession, setCompletedSession] = useState<PracticeSession | null>(null);
  const [reviewSuggestion, setReviewSuggestion] = useState<ReviewRecommendation | null>(null);
  const [cloudSave, setCloudSave] = useState<'pending' | 'saved' | 'disabled' | 'error'>('disabled');
  const completingId = useRef<string | null>(null);
  const attemptId = useRef('');
  const sessionAudioCollection = useRef(UNKNOWN_AUDIO_COLLECTION);
  const playbackGeneration = useRef(0);
  const busy = useRef(false);
  const hintsUsed = useRef(false);
  const question = questions[index];
  const measuredSession = useRef<{data: Record<string,string|number>; started: number; finished: boolean; answered: number; correct: number} | null>(null);
  function recordExit() {
    const active = measuredSession.current;
    if (!active || active.finished) return;
    active.finished = true;
    trackMeasuredPracticeEvent('practice_exit',{...active.data,total:active.answered,correct:active.correct,duration_ms:Date.now()-active.started});
  }
  // A page in the back/forward cache can resume the same unfinished session.
  useEffect(() => { const exit = (event: PageTransitionEvent) => { if (!event.persisted) recordExit(); }; window.addEventListener('pagehide',exit); return () => { window.removeEventListener('pagehide',exit); recordExit(); }; },[]);
  const [paywallNode, setPaywallNode] = useState<HTMLDivElement | null>(null);
  const paywallKey = locked && exerciseAccess !== 'checking' && exerciseAccess !== 'error' ? `${languageId}:${contrastId}` : '';
  useMeasuredExposure(paywallNode,paywallKey,'paywall_view',{surface:'practice',ui_locale:locale,language_id:languageId,contrast_id:contrastId,access_tier:'free'});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const saved = readProgress(); setHistory(saved.sessions);
    setActivityMode(params.get('mode') === 'identify' ? 'word-identification' : 'abx-cross-word');
    setJourneyMode(params.get('session') === 'diagnostic' ? 'diagnostic' : 'focused');
    const selected = languages.find(item => item.id === (params.get('language') || initialLanguage || saved.preferredLanguage)) || language;
    if (selected) {
      setLanguageId(selected.id);
      setContrastId(selected.contrasts.find(item => item.id === (params.get('contrast') || initialContrast))?.id || selected.contrasts[0]?.id || '');
    }
    setNativeLanguage(saved.nativeLanguage || '');
    try {const settings=JSON.parse(localStorage.getItem('minimalpairs.session-settings') || '{}'); if([6,12,24].includes(settings.rounds)) setSessionRounds(settings.rounds);} catch {}
    let active = true;
    void import('../lib/progress-sync').then(({loadAccountProgress}) => loadAccountProgress(saved)).then(result => {if(active) setHistory(previous => [...new Map([...result.progress.sessions, ...previous].map(s => [s.id,s])).values()]);}).catch(() => {});
    return () => { active = false; playbackGeneration.current += 1; stopAudio(); };
  }, []);
  useEffect(() => {
    if (!language) return;
    let cancelled = false;
    setAudioStatus('Preparing audio…'); setPreparedAudioKey(null); setVoices([]);
    if (!audioManifestPath) {
      getPracticeAudio(language.id, undefined, true).then(data => {if(!cancelled){setAvailableClips(data.clips);setVoices(data.voices);setPreparedAudioKey(audioKey);}}).catch(() => {if(!cancelled){setAudioError(t("Audio could not load. Please refresh to retry."));setPreparedAudioKey(audioKey);}});
      return () => {cancelled=true;};
    }
    Promise.all([getVoices(language.id, audioManifestPath, requiredWords), getAudioStatus(language.id, audioManifestPath, requiredWords)]).then(([items, status]) => {
      if (!cancelled) { setVoices(items); setAudioStatus(status.label); setPreparedAudioKey(audioKey); }
    }).catch(() => { if (!cancelled) { setVoices([]); setAudioStatus('Audio is unavailable for this sound contrast.'); setPreparedAudioKey(audioKey); } });
    return () => { cancelled = true; };
  }, [audioKey]);
  useEffect(() => {
    const back = () => { const params = new URLSearchParams(location.search); const chosen = languages.find(l => l.id === params.get('language')) || languages[0]; if(chosen){reset();setActivityMode(params.get('mode')==='identify'?'word-identification':'abx-cross-word');setJourneyMode(params.get('session')==='diagnostic'?'diagnostic':'focused');setLanguageId(chosen.id);setContrastId(chosen.contrasts.find(c => c.id === params.get('contrast'))?.id || chosen.contrasts[0].id);} };
    window.addEventListener('popstate',back); return () => window.removeEventListener('popstate',back);
  }, [languages]);
  function cancelPlayback() { playbackGeneration.current += 1; stopAudio(); busy.current = false; setPlaying(null); setSequencePlaying(false); }
  function reset() { recordExit(); setAudioRevision(v=>v+1); setPendingDiagnostic(false); setPendingLesson(null); cancelPlayback(); setPhase('ready'); setQuestions([]); setIndex(0); setAnswer(null); setRoundRevealed(false); setAttempts([]); setHeard(unheard()); setAudioError(''); setCompletedSession(null); setReviewSuggestion(null); completingId.current = null; }
  function changeLanguage(id: string) {
    const selected = languages.find(item => item.id === id);
    if (!selected) return;
    reset(); setJourneyMode(journeyMode === 'diagnostic' ? 'diagnostic' : 'focused'); setLanguageId(id); setContrastId(selected.contrasts[0]?.id || '');
    writeProgress({ ...readProgress(), preferredLanguage: id });
    const url = new URL(window.location.href); url.searchParams.set('language', id); url.searchParams.delete('contrast'); window.history.pushState(null, '', url);
  }
  function sampleWord(item: Question, sample: Sample) { return sample === 'x' ? item.testPair.words[item.target] : item.pair.words[item.order[sample === 'a' ? 0 : 1]]; }
  async function playSample(item: Question, sample: Sample, token: number) {
    if (token !== playbackGeneration.current) return;
    setPlaying(sample);
    const played=await playWord(language.id, sampleWord(item, sample), sample === 'x' ? item.testVoiceId : item.referenceVoiceId, audioManifestPath);
    if (token === playbackGeneration.current) { setPlayedClips(previous=>({...previous,[sample]:played})); setHeard(previous => ({ ...previous, [sample]: true })); setPlaying(null); }
  }
  async function listen(sample: Sample) {
    if (!question || busy.current) return;
    busy.current = true; const token = ++playbackGeneration.current; setAudioError('');
    try { await playSample(question, sample, token); }
    catch { if (token === playbackGeneration.current) { setAudioError(t("{sample} could not play. Try again.", {sample: sample.toUpperCase()})); measuredAudioFailure(attemptId.current, index + 1); } }
    finally { if (token === playbackGeneration.current) { busy.current = false; setPlaying(null); } }
  }
  async function listenSequence(item: Question | undefined = question, round = index + 1) {
    if (!item || busy.current) return;
    busy.current = true; const token = ++playbackGeneration.current; setAudioError(''); setSequencePlaying(true);
    try {
      for (const sample of (identifying ? ['x'] : ['a', 'b', 'x']) as Sample[]) {
        if (token !== playbackGeneration.current) break;
        await playSample(item, sample, token);
        if (sample !== 'x') await new Promise(resolve => setTimeout(resolve, 350));
      }
    } catch { if (token === playbackGeneration.current) { setAudioError(t("One of the sounds could not play. Use its play button to try again.")); measuredAudioFailure(attemptId.current, round); } }
    finally { if (token === playbackGeneration.current) { busy.current = false; setPlaying(null); setSequencePlaying(false); } }
  }
  function startSession() {
    if (locked || exerciseAccess === 'checking' || !contrast || busy.current || !audioPrepared || !voices.length) return;
    let blocks: JourneyQuestion[][];
    try { blocks = selectedContrasts.map(c => {
      if(audioManifestPath) return assignSessionVoices((identifying ? buildIdentificationSession(c.pairs,roundsPerGroup) : buildSession(c.pairs,roundsPerGroup)),voices.map(v=>v.id)).map(q=>({...q,contrastId:c.id}));
      const pairs=c.pairs.filter(p=>p.words.every(w=>wordVoices(availableClips,language.id,w).length>=2));
      return assignAvailableVoices(identifying ? buildIdentificationSession(pairs.filter(p=>referenceVoices(availableClips,language.id,p).length>0),roundsPerGroup) : buildSession(pairs,roundsPerGroup,Math.random,p=>referenceVoices(availableClips,language.id,p).length>0),availableClips,language.id).map(q=>({...q,contrastId:c.id}));
    }); } catch { setAudioError(t("This session needs updated recordings. Refresh to retry or choose another lesson.")); return; }
    if (blocks.some(block => !block.length)) { setAudioError(t("A sound group is not ready for this session yet. Choose a focused exercise.")); return; }
    const queue = Array.from({length: roundsPerGroup}, (_,i) => blocks.flatMap(block => block[i] ? [block[i]] : [])).flat();
    if (!queue.length) { setAudioError(t("This exercise needs more examples before practice can start.")); return; }
    completingId.current = null; setCloudSave('disabled'); setReviewSuggestion(null);
    hintsUsed.current = journeyMode === 'diagnostic' ? false : identifying || textHints;
    sessionAudioCollection.current = actualSessionAudioCollection(!audioManifestPath ? `chatterbox-${language.id === 'en' ? 'us' : language.id}-four-voices-v1` : audioCollectionId, queue.flatMap(item => [item.referenceVoiceId, item.testVoiceId]));
    attemptId.current = `${journeyMode}-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    const measurement = { language_id: language.id, ...(journeyMode === 'focused' ? {contrast_id: contrast.id} : {}), audio_collection: sessionAudioCollection.current, activity_mode: identifying ? 'word-identification' : 'abx-cross-word', session_kind: journeyMode, access_tier:exerciseAccess === 'lifetime' ? 'lifetime' : fullAccess ? 'paid' : 'free', ui_locale:locale, groups_count:blocks.length, total:queue.length, attempt_id:attemptId.current };
    measuredSession.current = {data:measurement,started:Date.now(),finished:false,answered:0,correct:0};
    startMeasuredPractice(attemptId.current, {...measurement,text_hints_used:hintsUsed.current});
    if(journeyMode === 'diagnostic') trackMeasuredPracticeEvent('diagnostic_start',measurement);
    setQuestions(queue); setIndex(0); setAnswer(null); setRoundRevealed(false); setAttempts([]); setHeard(unheard()); setCompletedSession(null); setStorageError(false); setPhase('practice'); void listenSequence(queue[0], 1);
  }
  function prepareDiagnostic() {
    reset();setJourneyMode('diagnostic');
    const url=new URL(location.href);url.searchParams.set('language',language.id);url.searchParams.set('session','diagnostic');url.searchParams.delete('contrast');window.history.pushState(null,'',url);
    requestAnimationFrame(()=>document.querySelector('.trainer-card')?.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  function continueLesson(id: string, mode: 'abx-cross-word'|'word-identification' = activityMode) {
    setActivityMode(mode);
    reset(); setJourneyMode('focused'); setContrastId(id); setPendingLesson(id);
    const url = new URL(window.location.href); url.searchParams.set('language', language.id); url.searchParams.set('contrast', id); url.searchParams.delete('session'); url.searchParams.set('mode',mode==='word-identification'?'identify':'match'); window.history.pushState(null, '', url);
  }
  useEffect(() => {
    if (!pendingLesson || contrast?.id !== pendingLesson || journeyMode !== 'focused' || phase !== 'ready' || !audioPrepared || exerciseAccess === 'checking') return;
    setPendingLesson(null);
    if (locked) { requestAnimationFrame(()=>document.querySelector('.trainer-card')?.scrollIntoView({behavior:'smooth',block:'start'}));return; }
    if (!voices.length) { setAudioError(t("This lesson could not start. Choose another lesson or try again.")); return; }
    startSession();
    requestAnimationFrame(() => document.querySelector('.trainer-card')?.scrollIntoView({behavior:'smooth', block:'start'}));
  }, [pendingLesson, contrast?.id, journeyMode, phase, audioPrepared, exerciseAccess, voices]);
  useEffect(() => {
    if (!pendingDiagnostic || phase !== 'ready' || !audioPrepared || exerciseAccess === 'checking') return;
    setPendingDiagnostic(false);
    if (!voices.length) { setAudioError(t("The session could not load. Please try again.")); return; }
    startSession();
    requestAnimationFrame(() => document.querySelector('.trainer-card')?.scrollIntoView({behavior:'smooth', block:'start'}));
  }, [pendingDiagnostic, journeyMode, phase, audioPrepared, exerciseAccess, voices]);
  function choose(reference: WordIndex) {
    if (!question || answer !== null || (!identifying && (!heard.a || !heard.b)) || !heard.x || busy.current) return;
    const category = question.order[reference]; const correct = category === question.target;
    if(measuredSession.current){measuredSession.current.answered++;if(correct) measuredSession.current.correct++;}
    if (index === 0) measuredFirstAnswer(attemptId.current, hintsUsed.current);
    busy.current = true;
    if (journeyMode !== 'diagnostic') answerCue(correct);
    setAnswer(reference);
    setAttempts(previous => [...previous, { contrastId: question.contrastId, pairId: question.pair.id, word: sampleWord(question, 'x').text, chosenWord: question.pair.words[category].text, correctWord: question.pair.words[question.target].text, heardIpa: sampleWord(question,'x').ipa, chosenIpa: question.pair.words[category].ipa, correctIpa: question.pair.words[question.target].ipa, correct }]);
    if (!correct && journeyMode === 'focused' && !identifying) setQuestions(previous => {const revised=revisitMistake(previous,index);return (audioManifestPath ? revised : revised.map((q,i) => q.pair === previous[i].pair && q.testPair === previous[i].testPair ? previous[i] : assignAvailableVoices([q],availableClips,language.id)[0])).map(q=>({...q,contrastId:contrast.id}));});
  }
  function next() {
    if (answer === null || busy.current) return;
    if (index + 1 < questions.length) { const item = questions[index + 1]; setIndex(value => value + 1); setAnswer(null); setRoundRevealed(false); setHeard(unheard()); setAudioError(''); void listenSequence(item, index + 2); }
    else {
      const session: PracticeSession = { id: attemptId.current, mode: identifying ? 'word-identification' : 'abx-cross-word', purpose: journeyMode, schemaVersion: 2, audioCollectionId: sessionAudioCollection.current, textHintsUsed: hintsUsed.current, completedAt: new Date().toISOString(), languageId: language.id, contrastId: contrast.id, correct: attempts.filter(item => item.correct).length, total: attempts.length, mistakes: attempts.filter(item => !item.correct).map(({ correct: _, ...item }) => item) };
      const records = language.contrasts.filter(c => attempts.some(a => a.contrastId === c.id)).map(c => { const subset = attempts.filter(a => a.contrastId === c.id); return {...session, id: `${session.id}-${c.id}`, contrastId: c.id, total: subset.length, correct: subset.filter(a => a.correct).length, mistakes: subset.filter(a => !a.correct).map(({correct, contrastId, ...a}) => a)}; }).filter(s => s.total > 0);
      const saved = readProgress(); const updated = [...saved.sessions, ...records].slice(-1000); setHistory(previous => [...new Map([...previous, ...updated].map(s => [s.id,s])).values()]); setStorageError(!writeProgress({ ...saved, preferredLanguage: language.id, nativeLanguage, sessions: updated })); setCompletedSession(session); setPhase('complete');
      completeMeasuredPractice(attemptId.current, { correct: session.correct, total: session.total, text_hints_used: session.textHintsUsed, first_device_completion: saved.sessions.length === 0 });
      const active = measuredSession.current;
      if(active && !active.finished) {
        active.finished = true;
        const result = {...active.data,correct:session.correct,total:session.total,duration_ms:Date.now()-active.started};
        for(const record of records) trackMeasuredPracticeEvent('practice_group_complete',{...result,contrast_id:record.contrastId,correct:record.correct,total:record.total});
        if(journeyMode === 'diagnostic') { trackMeasuredPracticeEvent('diagnostic_complete',result); trackMeasuredPracticeEvent('diagnostic_results_view',{...result,surface:'diagnostic'}); }
      }
      // Experimental libraries may contain contrasts absent from ordinary
      // practice. Their completion must not produce ordinary-library links.
      setReviewSuggestion(session.audioCollectionId === 'qwen-starter-v1'
        ? recommendReview(languages, [...saved.sessions, session], { languageId: language.id }) : null);
      completingId.current = session.id; setCloudSave('pending');
      void import('../lib/progress-sync').then(({ saveCompletedSession }) => Promise.all(records.map(record => saveCompletedSession(record)))).then(statuses => { const status = statuses.every(s => s === 'saved') ? 'saved' : 'disabled'; return status; }).then(status => { if (completingId.current === session.id) setCloudSave(status); }).catch(() => { if (completingId.current === session.id) setCloudSave('error'); });
    }
  }
  const advanceRef = useRef(next);
  advanceRef.current = next;
  useEffect(() => {
    if (phase !== 'practice' || answer === null || !question) return;
    let cancelled = false;
    const token = ++playbackGeneration.current;
    busy.current = true; setSequencePlaying(true);
    const active = () => !cancelled && token === playbackGeneration.current;
    void runAnswerFeedback({
      diagnostic: journeyMode === 'diagnostic',
      reference: question.order.indexOf(question.target) === 0 ? 'a' : 'b',
      play: sample => playSample(question, sample, token),
      wait: ms => new Promise(resolve => setTimeout(resolve, ms)), active,
      advance: () => { busy.current = false; setSequencePlaying(false); advanceRef.current(); },
    }).catch(() => {
      if (active()) { busy.current = false; setSequencePlaying(false); setPlaying(null); setAudioError(t("The matching sounds could not play. Replay them or continue to the next round.")); }
    });
    return () => { cancelled = true; };
  }, [answer, index, phase]);
  useLayoutEffect(() => {
    function onKey(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (phase !== 'practice' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.repeat) return;
      if (['ArrowLeft', 'ArrowRight', '1', '2'].includes(event.key)) { event.preventDefault(); choose(event.key === 'ArrowLeft' || event.key === '1' ? 0 : 1); }
      else if ((identifying ? ['x'] : ['a', 'b', 'x']).includes(event.key.toLowerCase())) { event.preventDefault(); void listen(event.key.toLowerCase() as Sample); }
      else if (event.code === 'Space' && (!['BUTTON', 'A'].includes(element.tagName) || !!element.closest('.active-session'))) { event.preventDefault(); void listenSequence(); }
      else if (event.key === 'Enter' && answer !== null && !['BUTTON', 'A'].includes(element.tagName)) { event.preventDefault(); next(); }
    }
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, [phase, question, answer, heard, attempts]);
  if (!language || !contrast) return <><Header active="practice" locale={locale} />{headerContent}<main className="section-wrap empty-state"><h1>{t("Your listening space.")}</h1><p>{t("The practice library is being prepared.")}</p><a href={path("/")} className="button button-dark">{t("Back home")}</a></main></>;
  const contrastNumber = language.contrasts.findIndex(item => item.id === contrast.id) + 1;
  const contrastLabel = locale === 'en' ? contrast.label : contrast.phonemes.map(sound => localizedSound(sound, locale)).join(' / ');
  const title = journeyMode === 'diagnostic' ? t("Find your starting point") : journeyMode === 'mixed' ? t("Mixed review") : textHints ? contrastLabel : `${t("Exercise")} ${String(contrastNumber).padStart(2, '0')}`;
  const targetReference = question?.order.indexOf(question.target);
  const correct = answer === targetReference;
  const allHeard = heard.x && (identifying || (heard.a && heard.b));
  const progress = phase === 'ready' ? 0 : phase === 'complete' ? 100 : (index + (answer !== null ? 1 : 0)) / questions.length * 100;
  const languageNote = contrast.l1Notes?.find(item => item.nativeLanguage.toLowerCase() === nativeLanguage.toLowerCase() || item.nativeLanguage === nativeLanguageIds[nativeLanguage]);
  const isPlaying = playing !== null || sequencePlaying;
  const roundContrast = language.contrasts.find(c => c.id === question?.contrastId) || contrast;
  const nextStep = nextCourseStep(language.contrasts, history, language.id, fullAccess);
  const targetFocus = practiceFocus(roundContrast, phase === 'practice' ? question?.pair : undefined);
  const showRoundWords = !identifying && journeyMode !== 'diagnostic' && (textHints || (answer !== null && roundRevealed));
  const correctCount = attempts.filter(item => item.correct).length;
  const sessionAccuracy = attempts.length ? Math.round(correctCount / attempts.length * 100) : null;
  return <><Header active="practice" locale={locale} />{headerContent}
    <main className={"practice-layout" + (phase === 'practice' ? ' is-practicing' : '')}>
      {phase !== 'practice' && <aside className="practice-sidebar">
        <div className="sidebar-heading"><span className="account-plan-badge" role="status">{exerciseAccess === 'checking' ? t("Loading…") : exerciseAccess === 'error' ? t("Plan unavailable") : exerciseAccess === 'lifetime' ? t("Lifetime") : fullAccess ? t("Premium") : t("Free")}</span><span className="eyebrow">{t("MAKE TIME TO LISTEN")}</span><h2>{t("Your next listen.")}</h2></div>
        <label className="field-label" htmlFor="practice-language">{t("I’m learning")}</label>
        <div className="select-wrap"><select id="practice-language" value={language.id} onChange={event => changeLanguage(event.target.value)}>{languages.map(item => <option value={item.id} key={item.id}>{t(item.name)}</option>)}</select><Icon name="chevronDown" size={15} /></div>
        <button className={`contrast-option diagnostic-nav ${journeyMode==='diagnostic'?'is-selected':''}`} aria-pressed={journeyMode==='diagnostic'} onClick={prepareDiagnostic}><span>{short.diagnostics}</span><Icon name="arrow" size={15}/></button>
        <div className="sidebar-contrasts"><span className="field-label">{t("Choose an exercise")}</span><div className="contrast-options">
          {language.contrasts.map((item, position) => <button className={`contrast-option ${journeyMode === 'focused' && item.id === contrast.id ? 'is-selected' : ''}`} aria-label={`${`${t("Exercise")} ${String(position + 1).padStart(2, '0')} · ${item.phonemes.map(sound => `/${sound}/`).join(' vs ')}`}${!fullAccess && position >= 3 ? ` · ${t('Locked')}` : ''}`} aria-pressed={journeyMode === 'focused' && item.id === contrast.id} key={item.id} onClick={() => { reset(); setJourneyMode('focused'); setContrastId(item.id); const url = new URL(window.location.href); url.searchParams.set('contrast', item.id); url.searchParams.delete('session'); window.history.pushState(null, '', url); }}><span>{`${String(position + 1).padStart(2, '0')} · ${item.phonemes.map(sound => `/${sound}/`).join(' vs ')}`}</span>{position < 3 && <span className="lesson-free-badge">{t("Free")}</span>}<Icon name={!fullAccess && position >= 3 ? "lock" : "chevron"} size={15} /></button>)}
        </div></div>
        <p className="sidebar-tip">{t("Let your ears go first. Words stay hidden until you choose to see them.")}</p>
        <a className="sidebar-progress" href={path("/account")}>{t("Your practice history")}<Icon name="arrow" size={16} /></a>
      </aside>}
      <section className="practice-main">
        <div className="practice-breadcrumb"><a href={path("/practice")}>{t("Practice")}</a><span>/</span><span>{t(language.name)}</span><span className="dialect-pill">{t(language.dialect || language.nativeName)}</span></div>
        <div className="practice-heading"><div><span className="eyebrow">{phase === 'complete' ? t("YOUR SESSION") : t("LISTEN A LITTLE CLOSER")}</span><h1>{phase === 'complete' ? t("A good listen.") : t("Train your ear.")}</h1></div><span className="session-length">{identifying ? it(1) : textHints && journeyMode !== 'diagnostic' ? t("Text hints on") : t("Sound first. Words later.")}</span></div>
        {phase === 'ready' && journeyMode !== 'diagnostic' && !audioManifestPath && <><section className="diagnostic-invite"><div><span className="eyebrow">{dc.eyebrow}</span><h2>{dc.title}</h2><p>{dc.resultsBody}</p></div><div><button className="button button-dark" disabled={exerciseAccess==='checking'} onClick={prepareDiagnostic}>{dc.start}<Icon name="arrow"/></button><a className="text-button" href={path(`/diagnostic/${language.id}`)}>{dc.how}</a></div></section><CourseProgress locale={locale} language={language} sessions={history} fullAccess={fullAccess} disabled={Boolean(pendingLesson)||exerciseAccess==='checking'} onStart={continueLesson}/><div className="journey-actions"><button className="text-button" onClick={()=>{reset();setJourneyMode('mixed');}}>{it(12)}</button></div></>}
        {phase === 'ready' && !locked && journeyMode !== 'diagnostic' && <details className="session-settings"><summary>{t("Session settings")}</summary><label>{t("Session length")}<select value={sessionRounds} onChange={event => {const value=Number(event.target.value);setSessionRounds(value);try{localStorage.setItem('minimalpairs.session-settings',JSON.stringify({rounds:value}));}catch{}}}>{[6,12,24].map(n=><option key={n} value={n}>{n} {t("rounds")}</option>)}</select></label></details>}
        <div className="training-area">
          <div className="trainer-stage">
            <div className="trainer-card">
              <div className="trainer-card-top"><div><span className="eyebrow">{t(language.name)}</span><h2>{title}</h2>{journeyMode!=='diagnostic' && <span className="quiet-label">{it(identifying?1:0)}</span>}</div><div className="trainer-round-tools"><span className="round-counter" hidden={locked || phase === 'ready'}>{phase === 'ready' ? '' : phase === 'complete' ? t("Session complete") : `${index + 1} / ${questions.length}`}</span>{phase === 'practice' && <button className="end-session" onClick={reset}><Icon name="close" size={14} /> {t("End session")}</button>}</div></div>
              <div className="session-progress" role="progressbar" aria-label={t("Session progress")} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${phase === 'ready' ? 0 : progress}%` }} /></div>
              {exerciseAccess === 'checking' ? <div className="session-ready"><p role="status">{t("Loading…")}</p></div> : locked ? <div ref={setPaywallNode} className="session-ready">
                <Icon name="lock" size={28} />
                <h3>{t("Unlock this exercise.")}</h3>
                <p>{exerciseAccess === 'error' ? t("We couldn’t check your access. Try again or choose a free exercise.") : signedIn ? t("Choose Premium to unlock every lesson.") : t("Already a member? Sign in to open the full library.")}</p>
                {exerciseAccess === 'error' && <button className="button button-light" onClick={onRetryAccess}>{t("Check access again")}</button>}
                {!signedIn && <a className="button button-dark" href={path("/account#account-sign-in")}>{t("Sign in with Google")}<Icon name="arrow" /></a>}
                <a className="text-button" href="#lesson-plans">{t("View plans")}</a>
                <p className="quiet-label">{t("The first three exercises in each language are free.")}</p>
              </div> : phase === 'ready' ? <div className="session-ready">
                {journeyMode !== 'diagnostic' && <div className="activity-picker" role="group" aria-label={it(9)}>{(['abx-cross-word','word-identification'] as const).map((mode,i)=><button className={activityMode===mode?'is-selected':''} aria-pressed={activityMode===mode} key={mode} onClick={()=>{setActivityMode(mode);const url=new URL(location.href);url.searchParams.set('mode',mode==='word-identification'?'identify':'match');window.history.replaceState(null,'',url);}}>{it(i)}</button>)}</div>}
                {journeyMode === 'diagnostic' && <div className="diagnostic-preparation"><span className="eyebrow">{dc.eyebrow}</span><h3>{dc.title}</h3><p><strong>{selectedContrasts.length}</strong> {dc.coverage} · <strong>{selectedContrasts.length*checkRounds}</strong> {dc.rounds}</p><p>{dc.resultsBody}</p><div className="diagnostic-native-language"><label htmlFor="diagnostic-native-language">{nativeCopy.label}</label><select id="diagnostic-native-language" value={nativeLanguage} onChange={event=>{setNativeLanguage(event.target.value);writeProgress({...readProgress(),nativeLanguage:event.target.value});}}><option value="">{nativeCopy.choose}</option>{nativeLanguages.map(item=><option key={item} value={item}>{nativeLabel(item)}</option>)}</select><small>{nativeCopy.hint}</small></div></div>}
                {identifying ? <><Icon name="headphones" size={42}/><h3>{it(2)}</h3><p>{it(3)}</p></> : <>
                <div className="abx-ready-diagram" aria-hidden="true"><span>A</span><span>B</span><span className="is-x">X</span></div>
                {journeyMode !== 'diagnostic' && <h3>{t("Three listens.")}<br />{t("One small difference.")}</h3>}
                <ol className="ready-listening-steps"><li><strong>{t("Listen to A and B.")}</strong><span>{t("Hear two different sounds.")}</span></li><li><strong>{t("Listen to X.")}</strong><span>{t("A new word, with one of those sounds.")}</span></li><li><strong>{t("Choose A or B.")}</strong><span>{t("Which one shares X’s sound? Replay as often as you like.")}</span></li></ol>
                </>}
                {targetFocus && <p className="abx-focus-note">{locale !== "en" && t(targetFocus) === targetFocus ? t("Listen for the target sound in each word.") : t(targetFocus)}</p>}
                <button className="button button-dark start-button" onClick={startSession} disabled={contrast.pairs.length < 2 || !audioPrepared || !voices.length}>{journeyMode === 'diagnostic' ? (history.some(s=>s.languageId===language.id && (s.purpose==='diagnostic'||s.id.startsWith('diagnostic-'))) ? short.retake : dc.start) : identifying ? it(6) : t("Start with A, B & X")}<Icon name="arrow" /></button>
                
                {audioError && <p className="audio-error" role="alert">{audioError}</p>}{journeyMode==='diagnostic' && <div className="diagnostic-extras"><details><summary>{short.previewTitle}</summary><DiagnosticPreview language={language} locale={locale} nativeLanguage={nativeLanguage}/></details><DiagnosticHistory language={language} sessions={history} locale={locale}/></div>}
              </div> : phase === 'practice' && question ? <div className="active-session abx-active">
                <div className="abx-players">{((identifying ? ['x'] : ['a', 'b', 'x']) as Sample[]).map(sample => <div className={`abx-sample is-${sample}`} key={sample}>
                  <button className={`abx-sound-button ${playing === sample ? 'is-playing' : ''} ${heard[sample] ? 'is-heard' : ''}`} onClick={() => void listen(sample)} disabled={isPlaying} aria-label={`${t("Play")} ${sample.toUpperCase()}`}>
                    <span className="abx-letter">{identifying ? <Icon name="volume" size={30}/> : sample.toUpperCase()}</span><span className="sample-play-copy"><span className="abx-play-label"><Icon name={playing === sample ? 'volume' : heard[sample] ? 'replay' : 'play'} size={15} />{playing === sample ? t("Listening…") : heard[sample] ? t("Replay") : t("Tap to play")}</span><span className="abx-sample-label">{identifying ? it(1) : sample === 'x' ? t("The new word") : t("Listen and compare")}</span></span>
                    {heard[sample] && <span className="abx-heard-mark"><Icon name="check" size={12} /></span>}
                  </button>
                  <ReportRecording contrastId={question.contrastId || contrast.id} activityMode={activityMode} sessionKind={journeyMode} locale={locale} clip={playedClips[sample]} label={t("Report")+" "+sample.toUpperCase()} />{showRoundWords && <div className="abx-word-hint"><strong>{sampleWord(question, sample).text}</strong><span>{sampleWord(question, sample).ipa}</span>{locale === 'en' && <small>{sampleWord(question, sample).meaning}</small>}</div>}
                </div>)}</div>
                <div className="listening-prompt"><h3>{identifying ? it(4) : t("Does X share A’s sound or B’s?")}</h3>{targetFocus && <p className="abx-focus-note">{locale !== "en" && t(targetFocus) === targetFocus ? t("Listen for the target sound in each word.") : t(targetFocus)}</p>}</div>
                <div className="answer-options abx-answer-options">{([0, 1] as WordIndex[]).map(reference => <button key={reference} className={`answer-card ${journeyMode !== 'diagnostic' && answer !== null && reference === targetReference ? 'is-correct' : ''} ${journeyMode !== 'diagnostic' && answer === reference && !correct ? 'is-incorrect' : ''}`} onClick={() => choose(reference)} disabled={answer !== null || !allHeard || isPlaying}>
                  <span className="answer-key" aria-hidden="true">{reference === 0 ? '←' : '→'}</span><strong>{identifying ? <span lang={language.locale}>{question.pair.words[question.order[reference]].text}{question.pair.words[0].text===question.pair.words[1].text && <small> {question.pair.words[question.order[reference]].ipa}</small>}</span> : t('X shares {reference}’s sound', {reference: reference === 0 ? 'A' : 'B'})}</strong>{journeyMode !== 'diagnostic' && answer !== null && reference === targetReference && <span className="answer-marker"><Icon name="check" size={19} /></span>}{journeyMode !== 'diagnostic' && answer === reference && !correct && <span className="answer-marker"><Icon name="close" size={17} /></span>}
                </button>)}</div>
                <button className="abx-sequence-button" onClick={() => void listenSequence()} disabled={isPlaying}><Icon name={sequencePlaying ? 'volume' : 'replay'} size={15} />{sequencePlaying ? answer !== null ? t("Continuing…") : identifying ? t("Listening…") : t("Playing A → B → X") : identifying ? it(5) : t("Replay A → B → X · Space")}</button>
                {audioError && <p className="audio-error trainer-audio-error" role="alert">{audioError} <button className="text-button" onClick={reset}>{t("Reload recordings")}</button></p>}
                <div className="feedback-space" aria-live="polite">{answer !== null ? journeyMode === 'diagnostic' ? <p>{t("Answer recorded.")}</p> : <div className={`answer-feedback ${correct ? 'is-correct' : 'needs-listen'}`}><span className="feedback-symbol"><Icon name={correct ? 'check' : 'headphones'} size={21} /></span><div><strong>{identifying ? `${it(7)}: ${sampleWord(question,'x').text}` : correct ? t("You heard the shared sound.") : t('X shares {reference}’s sound', {reference: targetReference === 0 ? 'A' : 'B'})}</strong><p>{identifying ? it(8) : t("Listen to the matching sounds.")}</p></div></div> : <p className="answer-hint">{!allHeard ? identifying ? it(3) : t("Listen to A, B and X to unlock your choices.") : ''}</p>}</div>
                {answer !== null && <><div className="round-follow-up">{!identifying && journeyMode !== 'diagnostic' && !textHints && <button className="round-reveal" aria-expanded={roundRevealed} onClick={() => { setRoundRevealed(value => !value); if (!roundRevealed) hintsUsed.current = true; }}>{roundRevealed ? t("Hide these words") : t("Reveal these words")}<Icon name={roundRevealed ? 'close' : 'book'} size={15} /></button>}<button className="button button-dark next-button" onClick={next} disabled={isPlaying}>{index + 1 === questions.length ? t("See your session") : t("Next round")}<Icon name="arrow" /></button></div>{locale === 'en' && journeyMode !== 'diagnostic' && textHints && question.pair.note && <p className="pair-note">{question.pair.note}</p>}</>}
              </div> : completedSession ? <div className={"session-complete"+(journeyMode==='diagnostic'?' is-diagnostic':'')}>
                <span className="complete-kicker">{t("SESSION COMPLETE")}</span><h3>{journeyMode==='diagnostic'?dc.results:t("You made time to listen.")}</h3>{journeyMode!=='diagnostic' && <p>{t("Keep noticing the small differences.")}</p>}
                {journeyMode !== 'diagnostic' && <><div className="session-results"><div><strong>{completedSession.correct}<span>/{completedSession.total}</span></strong><span>{t("correct matches")}</span></div><div><strong>{completedSession.total}</strong><span>{t("listening rounds")}</span></div><div><strong>{Math.round(completedSession.correct / completedSession.total * 100)}<span>%</span></strong><span>{t("session accuracy")}</span></div></div>
                <p className="score-note">{t("This is one practice session, not a measure of fluency.")}{completedSession.textHintsUsed ? t(" Words were shown during this session.") : t(" You practiced with sound alone.")}</p></>}
                {journeyMode === 'diagnostic' && <DiagnosticResults locale={locale} language={language} attempts={attempts} fullAccess={fullAccess} onPractice={id=>continueLesson(id,'abx-cross-word')}/>}
                {journeyMode === 'mixed' && <div className="journey-results"><h3>{t("Your sound groups")}</h3><p>{t("These results are an early signal. Keep practicing to build a clearer picture.")}</p>{language.contrasts.filter(c => attempts.some(a => a.contrastId === c.id)).sort((a,b) => attempts.filter(x => x.contrastId === a.id && x.correct).length - attempts.filter(x => x.contrastId === b.id && x.correct).length).map(c => {const group = attempts.filter(a => a.contrastId === c.id); const score = group.filter(a => a.correct).length; return <div className="journey-result" key={c.id}><span>{c.phonemes.map(p => `/${p}/`).join(' vs ')} <strong>{score}/{group.length}</strong></span><button className="text-button" onClick={() => {reset(); setJourneyMode('focused'); setContrastId(c.id);}}>{t("Practice this sound →")}</button></div>;})}</div>}
                {reviewSuggestion && <ReviewSuggestion locale={locale} recommendation={reviewSuggestion} compact />}
                <div className="complete-actions">{!audioManifestPath && nextStep && <button className="button button-dark" disabled={Boolean(pendingLesson)} onClick={() => continueLesson(nextStep.contrast.id,nextStep.mode)}>{t("Continue my path")}<Icon name="arrow" /></button>}<button className="button button-light" onClick={() => {reset();setPendingDiagnostic(true);}}>{t("Listen again")}<Icon name="replay" size={17} /></button><button className="text-button" onClick={()=>{reset();setJourneyMode('focused');const url=new URL(location.href);url.searchParams.delete('session');window.history.replaceState(null,'',url);}}>{it(10)}</button><a className="text-button" href={path("/account")}>{t("View your history")}<Icon name="arrow" size={16} /></a><a className="text-button" href={path("/account#listening-plan")}>{t("Your listening plan")}<Icon name="arrow" size={16} /></a></div>
                <p className={`save-note ${storageError ? 'audio-error' : ''}`}><Icon name={storageError ? 'close' : 'check'} size={15} />{storageError ? t("This browser could not save your session. Your results are shown above.") : t("Session saved on this device.")}</p>
                <p className={`cloud-save-note ${cloudSave === 'error' ? 'audio-error' : ''}`} role="status">{cloudSave === 'pending' ? t("Checking account saving…") : cloudSave === 'saved' ? t("Also saved to your account.") : cloudSave === 'error' ? storageError ? t("Account saving could not be confirmed. Your results remain visible on this page.") : <>{t("Account saving could not be confirmed.")}<a href={path("/account")}>{t("Retry from your history page.")}</a></> : <>{t("Want this history on another device?")}<a href={path("/account")}>{t("Sign in to save your progress.")}</a></>}</p>
                {journeyMode !== 'diagnostic' && <SessionFeedback locale={locale} key={completedSession.id} session={completedSession} />}
              </div> : null}
            </div>
            {phase === 'practice' && journeyMode !== 'diagnostic' && <aside className="session-summary" aria-label={t("This session")}>
              <span className="eyebrow">{t("THIS SESSION")}</span><strong className="live-accuracy">{sessionAccuracy === null ? '—' : `${sessionAccuracy}%`}</strong><p className="live-score">{t("{correct} correct of {total} answered", {correct: correctCount, total: attempts.length})}</p>
              <ol className="round-trail" aria-label={t("Round results")}>{Array.from({ length: questions.length }, (_, round) => <li key={round} className={attempts[round] ? attempts[round].correct ? 'is-correct' : 'is-incorrect' : 'is-unanswered'} aria-label={`${t('Round')} ${round + 1}: ${t(attempts[round] ? attempts[round].correct ? 'correct' : 'incorrect' : 'not answered')}`}>{attempts[round] && <Icon name={attempts[round].correct ? 'check' : 'close'} size={12} />}</li>)}</ol>
              
            </aside>}
          </div>
          {locked && exerciseAccess !== 'checking' && <div id="lesson-plans" className="lesson-plans"><MembershipPanel locale={locale} storefront embedded /></div>}
          {!identifying && <div className="practice-settings"><label className="toggle-label"><input type="checkbox" disabled={journeyMode === 'diagnostic'} checked={journeyMode !== 'diagnostic' && textHints} onChange={event => { setTextHints(event.target.checked); if (phase === 'practice' && event.target.checked) hintsUsed.current = true; }} /><span className="toggle-switch" /><span>{t("Show text hints")}</span></label></div>}
          {textHints && journeyMode !== 'diagnostic' && <div className="contrast-explainer"><div><span className="eyebrow">{t("ABOUT THESE SOUNDS")}</span><h3>{contrastLabel}</h3><p>{locale === 'en' ? contrast.description : publicCopy(locale).compare}</p><div className="native-language-field"><label htmlFor="native-language">{t("A language you already speak")}</label><select id="native-language" value={nativeLanguage} onChange={event => { setNativeLanguage(event.target.value); writeProgress({ ...readProgress(), nativeLanguage: event.target.value }); }}><option value="">{t("Choose for a tailored note")}</option>{nativeLanguages.map(item => <option key={item} value={item}>{nativeLabel(item)}</option>)}</select></div>{locale === 'en' && languageNote && <p className="learner-note"><strong>{t("For {language} speakers:", {language: t(nativeLanguage)})}</strong> {languageNote.note}</p>}{contrast.sources?.length ? <details className="source-details"><summary>{t("More about these sounds")}</summary><ul>{contrast.sources.map((source, i) => <li key={i}>{/^https?:\/\//.test(source) ? <a href={source} target="_blank" rel="noopener noreferrer">{t("Reference")} {i + 1} <span aria-hidden="true">↗</span></a> : source}</li>)}</ul></details> : null}</div></div>}
          <div className="practice-bottom-note"><span><Icon name="lock" size={13} /> {t("Your progress saves automatically when you’re signed in.")}</span><span className="keyboard-hint">{!identifying && <><kbd>A</kbd><kbd>B</kbd></>}<kbd>X</kbd> {t("replay")}<kbd>1</kbd><kbd>2</kbd> {t("answer")}</span></div>
        </div>
      </section>
    </main></>;
}

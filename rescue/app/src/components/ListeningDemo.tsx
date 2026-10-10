import { useEffect, useRef, useState } from 'react';
import '../styles/home-redesign.css';
import { getPracticeAudio, playWord, stopAudio } from '../lib/audio';
import { buildSession, type PracticeQuestion } from '../lib/practice-engine';
import {assignAvailableVoices,referenceVoices,wordVoices} from '../lib/round-voices';
import {trackMeasurement} from '../lib/measurement';
import {Icon, Waveform, type Language} from './ui';

export default function ListeningDemo({ language, contrastId }: { language: Language; contrastId?: string }) {
  const contrast = contrastId ? language.contrasts.find(item => item.id === contrastId) : language.contrasts.find(item => item.pairs.length >= 2);
  const [trial, setTrial] = useState<PracticeQuestion | null>(null);
  const [playing, setPlaying] = useState<'a' | 'b' | 'x' | null>(null);
  const [sequence, setSequence] = useState(false);
  const [ready, setReady] = useState(false);
  const [heard, setHeard] = useState({ a: false, b: false, x: false });
  const [selected, setSelected] = useState<0 | 1 | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => { setReady(true); return () => { generation.current += 1; stopAudio(); }; }, []);
  if (!language || !contrast) return null;
  async function ensureTrial() {
    if (trial) return trial;
    if (!contrast) return null;
    const {clips}=await getPracticeAudio(language.id);
    const pairs=contrast.pairs.filter(p=>p.words.every(w=>wordVoices(clips,language.id,w).length>=2));
    const next=assignAvailableVoices(buildSession(pairs,1,Math.random,p=>referenceVoices(clips,language.id,p).length>0),clips,language.id)[0] || null;
    if (next) trackMeasurement('challenge_start', {language_id:language.id,contrast_id:contrast.id,surface:'guide'});
    setTrial(next); return next;
  }
  async function play(sample: 'a' | 'b' | 'x', item: PracticeQuestion, token: number) {
    if (token !== generation.current) return;
    setPlaying(sample);
    const word = sample === 'x' ? item.testPair.words[item.target] : item.pair.words[item.order[sample === 'a' ? 0 : 1]];
    await playWord(language.id, word, sample === 'x' ? item.testVoiceId : item.referenceVoiceId);
    if (token === generation.current) { setHeard(previous => ({ ...previous, [sample]: true })); setPlaying(null); }
  }
  async function listen(sample?: 'a' | 'b' | 'x') {
    if (busy.current) return;
    busy.current = true; const token = ++generation.current; setError(''); setSequence(!sample);
    try {
      const item = await ensureTrial();
      if (!item) throw new Error('No cross-word exercise available');
      for (const part of (sample ? [sample] : ['a', 'b', 'x']) as ('a' | 'b' | 'x')[]) {
        if (token !== generation.current) break;
        await play(part, item, token);
        if (!sample && part !== 'x') await new Promise(resolve => setTimeout(resolve, 350));
      }
    } catch { if (token === generation.current) {setTrial(null);setHeard({a:false,b:false,x:false});setSelected(null);void getPracticeAudio(language.id,undefined,true);setError('Audio could not play. Try the sound again, or open the full practice.');} }
    finally { if (token === generation.current) { busy.current = false; setPlaying(null); setSequence(false); } }
  }
  const target = trial?.order.indexOf(trial.target);
  async function answer(reference:0|1){
    if(!trial||!contrast||selected!==null||busy.current)return;
    setSelected(reference);
    trackMeasurement('challenge_complete',{language_id:language.id,contrast_id:contrast.id,surface:'guide',correct:reference===target?1:0,total:1});
    busy.current=true;const token=++generation.current;setSequence(true);
    try{
      await play(target===0?'a':'b',trial,token);
      await new Promise(resolve=>setTimeout(resolve,350));
      await play('x',trial,token);
    }catch{if(token===generation.current)setError('The feedback audio could not play. Replay the matching example and X.');}
    finally{if(token===generation.current){busy.current=false;setPlaying(null);setSequence(false);}}
  }
  return <div className="demo-shell demo-abx"><div className="demo-topline"><span className="eyebrow">TRY ONE ROUND</span><span className="demo-language">{language.name}<span className="small-dot" /></span></div><div className="demo-question"><span className="quiet-label">Two examples. One new word.</span><h2>Does X share A’s sound or B’s?</h2><p>Listen for the target sound. Match its sound, not the whole word.</p></div><div className="abx-players demo-abx-players">{(['a', 'b', 'x'] as const).map(sample => <div className={'abx-sample ' + (sample === 'x' ? 'is-x' : '')} key={sample}><button className={'abx-sound-button ' + (playing === sample ? 'is-playing ' : '') + (heard[sample] ? 'is-heard' : '')} onClick={() => void listen(sample)} disabled={!ready || playing !== null || sequence} aria-label={'Play ' + sample.toUpperCase()}><span className="abx-letter">{sample.toUpperCase()}</span><span className="abx-mini-wave"><Waveform compact active={playing === sample} /></span><span className="abx-play-label"><Icon name={playing === sample ? 'volume' : heard[sample] ? 'replay' : 'play'} size={12} />{playing === sample ? 'Listen…' : heard[sample] ? 'Replay' : 'Play'}</span>{heard[sample] && <span className="abx-heard-mark"><Icon name="check" size={11} /></span>}</button></div>)}</div><button className="abx-sequence-button" disabled={!ready || playing !== null || sequence} onClick={() => void listen()}><Icon name="play" size={13} />{sequence ? (selected !== null ? 'Replaying the matching sounds' : 'Playing A → B → X') : 'Play A → B → X'}</button><div className="demo-options">{([0, 1] as const).map(reference => <button key={reference} disabled={!heard.a || !heard.b || !heard.x || selected !== null || playing !== null || sequence} onClick={() => void answer(reference)} className={'demo-answer ' + (selected !== null && reference === target ? 'is-correct ' : '') + (selected === reference && reference !== target ? 'is-incorrect' : '')}><span className="option-letter">{reference + 1}</span><strong>{reference === 0 ? 'A' : 'B'}</strong><span className="demo-match-label">shares X’s sound</span>{selected !== null && reference === target && <Icon name="check" size={17} />}</button>)}</div><div className="demo-bottom" aria-live="polite">{error ? <span className="audio-error">{error}</span> : selected !== null ? <><span>{selected === target ? 'You heard the shared sound.' : 'X shares ' + (target === 0 ? 'A' : 'B') + '’s target sound.'}</span><button className="text-button" disabled={sequence || playing !== null} onClick={() => { setTrial(null); setSelected(null); setHeard({ a: false, b: false, x: false }); }}>Try another round <Icon name="replay" size={13} /></button><a className="text-button" href={"/practice?language=" + encodeURIComponent(language.id) + "&contrast=" + encodeURIComponent(contrast.id)}>Practice this contrast <Icon name="arrow" size={13} /></a></> : null}</div><div className="demo-caption"><span className="tiny-bars" aria-hidden="true">▂▅▃▆▂</span> Spelling hidden. No account needed.</div></div>;
}

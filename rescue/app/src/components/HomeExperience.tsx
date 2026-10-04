import { useEffect, useRef, useState } from 'react';
import '../styles/home-redesign.css';
import { getPracticeAudio, playWord, stopAudio } from '../lib/audio';
import { buildSession, type PracticeQuestion } from '../lib/practice-engine';
import {assignAvailableVoices,referenceVoices,wordVoices} from '../lib/round-voices';
import { Footer, Header, Icon, Waveform, type Language } from './ui';

const previewSound = (sound = '') => ({ 'single consonant': 'short', 'long consonant': 'long', 'plain consonant': 'hard', 'palatalized consonant': 'soft' }[sound] || (sound.includes(' ') ? sound : `/${sound}/`));

function ListeningDemo({ languages }: { languages: Language[] }) {
  const language = languages.find(item => item.id === 'french' || item.id === 'fr') || languages[0];
  const contrast = language?.contrasts.find(item => item.pairs.length >= 2);
  const [trial, setTrial] = useState<PracticeQuestion | null>(null);
  const [playing, setPlaying] = useState<'a' | 'b' | 'x' | null>(null);
  const [sequence, setSequence] = useState(false);
  const [heard, setHeard] = useState({ a: false, b: false, x: false });
  const [selected, setSelected] = useState<0 | 1 | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; stopAudio(); }, []);
  if (!language || !contrast) return null;
  async function ensureTrial() {
    if (trial) return trial;
    if (!contrast) return null;
    const {clips}=await getPracticeAudio(language.id);
    const pairs=contrast.pairs.filter(p=>p.words.every(w=>wordVoices(clips,language.id,w).length>=2));
    const next=assignAvailableVoices(buildSession(pairs,1,Math.random,p=>referenceVoices(clips,language.id,p).length>0),clips,language.id)[0] || null;
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
  return <div className="demo-shell demo-abx"><div className="demo-topline"><span className="eyebrow">TRY ONE ROUND</span><span className="demo-language">{language.name}<span className="small-dot" /></span></div><div className="demo-question"><span className="quiet-label">Two examples. One new word.</span><h2>Does X share A’s sound or B’s?</h2><p>Listen for the vowel. Match its sound, not the whole word.</p></div><div className="abx-players demo-abx-players">{(['a', 'b', 'x'] as const).map(sample => <div className={'abx-sample ' + (sample === 'x' ? 'is-x' : '')} key={sample}><button className={'abx-sound-button ' + (playing === sample ? 'is-playing ' : '') + (heard[sample] ? 'is-heard' : '')} onClick={() => void listen(sample)} disabled={playing !== null || sequence} aria-label={'Play ' + sample.toUpperCase()}><span className="abx-letter">{sample.toUpperCase()}</span><span className="abx-mini-wave"><Waveform compact active={playing === sample} /></span><span className="abx-play-label"><Icon name={playing === sample ? 'volume' : heard[sample] ? 'replay' : 'play'} size={12} />{playing === sample ? 'Listen…' : heard[sample] ? 'Replay' : 'Play'}</span>{heard[sample] && <span className="abx-heard-mark"><Icon name="check" size={11} /></span>}</button></div>)}</div><button className="abx-sequence-button" disabled={playing !== null || sequence} onClick={() => void listen()}><Icon name="play" size={13} />{sequence ? 'Playing A → B → X' : 'Play A → B → X'}</button><div className="demo-options">{([0, 1] as const).map(reference => <button key={reference} disabled={!heard.a || !heard.b || !heard.x || selected !== null || playing !== null || sequence} onClick={() => setSelected(reference)} className={'demo-answer ' + (selected !== null && reference === target ? 'is-correct ' : '') + (selected === reference && reference !== target ? 'is-incorrect' : '')}><span className="option-letter">{reference + 1}</span><strong>{reference === 0 ? 'A' : 'B'}</strong><span className="demo-match-label">shares X’s sound</span>{selected !== null && reference === target && <Icon name="check" size={17} />}</button>)}</div><div className="demo-bottom" aria-live="polite">{error ? <span className="audio-error">{error}</span> : selected !== null ? <><span>{selected === target ? 'You heard the shared sound.' : 'X shares ' + (target === 0 ? 'A' : 'B') + '’s target sound.'}</span><button className="text-button" onClick={() => { setTrial(null); setSelected(null); setHeard({ a: false, b: false, x: false }); }}>Try another round <Icon name="replay" size={13} /></button><a className="text-button" href={"/practice?language=" + encodeURIComponent(language.id) + "&contrast=" + encodeURIComponent(contrast.id)}>Practice this contrast <Icon name="arrow" size={13} /></a></> : null}</div><div className="demo-caption"><span className="tiny-bars" aria-hidden="true">▂▅▃▆▂</span> Spelling hidden. No account needed.</div></div>;
}

export default function HomeExperience({ languages = [] }: { languages: Language[] }) {
  const ordered = [...languages].sort((a, b) => ['fr', 'es', 'de', 'it', 'ru', 'zh', 'pt', 'en', 'ja', 'en-GB-ssbe'].indexOf(a.id) - ['fr', 'es', 'de', 'it', 'ru', 'zh', 'pt', 'en', 'ja', 'en-GB-ssbe'].indexOf(b.id));
  return <><Header /><main className="redesign-home">
    <section className="rd-hero section-wrap">
      <div className="rd-hero-copy"><p className="eyebrow">EAR TRAINING FOR LANGUAGE LEARNERS</p>
        <h1>You can read it.<br /><em>Now learn to<br className="rd-desktop-break" /> hear it.</em></h1>
        <p className="rd-lede">Know the word on the page, but miss it in conversation? Start with the small sound differences that change what you hear.</p>
        <div className="rd-actions"><a className="button button-dark" href="/practice">Start free practice <Icon name="arrow" size={18} /></a><a className="button button-light" href="#how-it-works">How it works</a></div>
        
      </div>
      <div className="rd-hero-demo"><ListeningDemo languages={languages} /><p className="rd-demo-footnote">Different words. Different voices. One sound to notice.</p></div>
    </section>
    <section className="rd-method" id="how-it-works"><div className="section-wrap">
      <div className="rd-section-heading"><h2>Hear the difference.<br /><em>Then find it again.</em></h2><p>You don’t need to know phonetics. Hear two examples, then a new word. Decide which example shares the sound you’re listening for.</p></div>
      <div className="rd-method-grid"><article><span className="rd-step-letter">A</span><h3>Hear the first example</h3><p>Listen to the word. Keep your attention on the sound the exercise points out.</p></article><article><span className="rd-step-letter">B</span><h3>Compare the other sound</h3><p>A second word changes that sound. Replay either example whenever you need.</p></article><article><span className="rd-step-letter">X</span><h3>Match it in a new word</h3><p>A different voice says a different word. Does its target sound match A or B? Choose, then get feedback.</p></article></div>
      <p className="rd-method-note">Words stay hidden while you listen. Reveal them when you choose. <a href="/method">Why we teach it this way <Icon name="arrow" size={14} /></a></p>
    </div></section>
    <section className="rd-languages section-wrap" id="languages"><div className="rd-section-heading"><h2>Find your language.<br /><em>A closer ear for each.</em></h2><p>Explore the sounds, hear the examples, then put your ears to work.</p></div>
      <div className="rd-language-grid">{ordered.map(language => { const contrast = language.contrasts[0]; return <a className="rd-language-card" href={`/${language.name.toLowerCase().replace(/\s+/g, '-')}-minimal-pairs`} key={language.id}><div className="rd-language-top"><h3>{language.name}</h3><span>{language.nativeName}</span></div><div className={"rd-phonemes" + (contrast?.phonemes.some(sound => sound.length > 4) ? " is-feature" : "")}><span>{previewSound(contrast?.phonemes[0])}</span><i>vs</i><span>{previewSound(contrast?.phonemes[1])}</span></div><div className="rd-language-bottom"><span>{language.contrasts.length} sound contrasts</span><Icon name="arrow" size={18} /></div></a>; })}</div>
    </section>
    <section className="rd-statement"><div className="section-wrap"><h2>Give a difficult sound<br /><em>your full attention.</em></h2><p>A few focused minutes. A clear next step.</p></div></section>
    <section className="rd-benefits section-wrap"><article><p className="eyebrow">LISTEN, DON’T GUESS</p><h3>Your ears get the first word.</h3><p>No spelling or translation to give the answer away. Listen again, make your choice, then check it.</p></article><article><p className="eyebrow">MORE THAN ONE VOICE</p><h3>Hear the sound beyond the speaker.</h3><p>Practice with different voices to recognize the sound across speakers.</p></article><article><p className="eyebrow">A REASON TO RETURN</p><h3>Pick up where you left off.</h3><p>Keep your session history, choose a three-session plan and revisit the sounds that need another listen.</p><a href="/account#listening-plan">Build your listening plan <Icon name="arrow" size={14} /></a></article></section>
    <section className="rd-final section-wrap"><div><p className="eyebrow">START WITH ONE SOUND</p><h2>Less reading about it.<br /><em>More hearing it.</em></h2><p>Your first session is free. Choose a language and press play.</p></div><a className="button button-dark" href="/practice">Find your first sound <Icon name="arrow" size={18} /></a></section>
  </main><Footer /></>;
}

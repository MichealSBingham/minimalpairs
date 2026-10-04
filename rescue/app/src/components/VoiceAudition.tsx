import { useEffect, useRef, useState } from 'react';
import type { VoiceAudition as Audition, AuditionClip } from '../lib/voice-audition';
import { parseAuditionReviews, mergeAuditionReviews, serializeAuditionReviews, nextReviewTime, playedThrough, type AuditionReview as Review, type AuditionReviews } from '../lib/voice-audition-review';
import { Brand } from './ui';
import '../styles/voice-audition.css';

const STORAGE = 'minimalpairs.voice-audition.v2';
const key = (clip: AuditionClip) => `${clip.id}:${clip.sha256}`;
const bankNames: Record<string,string> = { zh: 'Mandarin', fr: 'French', ja: 'Japanese', 'en-US-ga': 'American English', 'en-GB-ssbe': 'British English' };
export default function VoiceAudition({ audition }: { audition: Audition }) {
  const banks = [...new Set(audition.clips.map(c => c.bankId))];
  const [bank, setBank] = useState(banks[0] || 'zh'), [selected, setSelected] = useState(audition.clips[0]?.wordId || '');
  const [revealed, setRevealed] = useState(false), [providers, setProviders] = useState(false);
  const [reviews, setReviews] = useState<Record<string, Review>>({}), [ready, setReady] = useState(false), [notice, setNotice] = useState('');
  const latestReviews = useRef<AuditionReviews>({});
  const [heard, setHeard] = useState<Set<string>>(new Set());
  const player = useRef<HTMLAudioElement | null>(null);
  const elements = useRef(new Map<string, HTMLAudioElement>());
  const verified = useRef(new Map<string, string>());
  const [loading, setLoading] = useState<string | null>(null);
  const generation = useRef(0), request = useRef<AbortController | null>(null);
  const words = [...new Map(audition.clips.filter(c => c.bankId === bank).map(c => [c.wordId, c])).values()];
  const word = words.find(c => c.wordId === selected) || words[0];
  const clips = audition.clips.filter(c => c.bankId === bank && c.wordId === word?.wordId).sort((a,b) => a.id.localeCompare(b.id));
  useEffect(() => {
    try {
      latestReviews.current = parseAuditionReviews(localStorage.getItem(STORAGE));
      setReviews(latestReviews.current);
    } catch { setNotice('Saved notes could not be loaded. Export a backup before leaving.'); }
    setReady(true);
    const synchronize = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== STORAGE && event.key !== null)) return;
      if (event.newValue === null) { latestReviews.current = {}; setReviews({}); return; }
      try {
        const incoming = parseAuditionReviews(event.newValue);
        const persisted = parseAuditionReviews(localStorage.getItem(STORAGE));
        const merged = mergeAuditionReviews(mergeAuditionReviews(latestReviews.current, incoming), persisted);
        latestReviews.current = merged; setReviews(merged);
        // Reconcile disjoint edits even if two tabs wrote at nearly the same time.
        if (serializeAuditionReviews(merged) !== serializeAuditionReviews(persisted)) localStorage.setItem(STORAGE, serializeAuditionReviews(merged));
      } catch { setNotice('Another tab’s notes could not be synchronized. Export a backup before leaving.'); }
    };
    window.addEventListener('storage', synchronize);
    return () => {
      window.removeEventListener('storage', synchronize);
      generation.current++; request.current?.abort(); player.current?.pause();
      for (const url of verified.current.values()) URL.revokeObjectURL(url);
      verified.current.clear();
    };
  }, []);
  function stop() { generation.current++; request.current?.abort(); request.current = null; setLoading(null); player.current?.pause(); player.current = null; }
  function choose(id: string) { stop(); setSelected(id); setRevealed(false); setProviders(false); setNotice(''); }
  function switchBank(id: string) { setBank(id); choose(audition.clips.find(c => c.bankId === id)!.wordId); }
  function change(clip: AuditionClip, patch: Partial<Review>) {
    if (!ready || (patch.status === 'pass' && (!heard.has(key(clip)) || clip.technicalStatus !== 'pass' || !verified.current.has(key(clip))))) return;
    let current = latestReviews.current, canPersist = true;
    try { current = mergeAuditionReviews(current, parseAuditionReviews(localStorage.getItem(STORAGE))); }
    catch { canPersist = false; setNotice('Saved notes could not be read. Your changes are only in this tab; export a backup.'); }
    const previous = current[key(clip)] || { status: 'unreviewed' as const, note: '', updatedAt: '' };
    const next = { ...current, [key(clip)]: { ...previous, ...patch, updatedAt: nextReviewTime(previous.updatedAt) } };
    latestReviews.current = next; setReviews(next);
    if (canPersist) try { localStorage.setItem(STORAGE, serializeAuditionReviews(next)); } catch { setNotice('Notes are only in this tab. Export a backup before closing.'); }
  }
  async function listen(clip: AuditionClip) {
    stop(); setNotice('');
    const token = generation.current, id = key(clip);
    const controller = new AbortController(); request.current = controller; setLoading(id);
    try {
      let url = verified.current.get(id);
      if (!url) {
        const response = await fetch(clip.url, { signal: controller.signal, cache: 'no-cache', redirect: 'error' });
        if (!response.ok) throw new Error('The recording could not be loaded.');
        const bytes = await response.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (token !== generation.current) return;
        if (hash !== clip.sha256) throw new Error('This recording differs from the reviewed inventory. Refresh the page; it cannot be approved here.');
        url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        verified.current.set(id, url);
      }
      if (token !== generation.current) return;
      const audio = elements.current.get(id);
      if (!audio) return;
      if (audio.src !== url) { audio.src = url; audio.load(); }
      audio.currentTime = 0; player.current = audio;
      await audio.play();
    } catch (error) {
      if (token === generation.current && !controller.signal.aborted) {
        setHeard(before => { const next = new Set(before); next.delete(id); return next; });
        setNotice(error instanceof Error ? error.message : 'This recording could not play.');
      }
    } finally {
      if (token === generation.current) { setLoading(null); request.current = null; }
    }
  }
  function ended(clip: AuditionClip, audio: HTMLAudioElement) {
    if (verified.current.get(key(clip)) === audio.currentSrc && !audio.error && playedThrough(audio.duration, audio.played)) {
      setHeard(before => new Set([...before, key(clip)]));
    }
  }
  function download() {
    try { latestReviews.current = mergeAuditionReviews(latestReviews.current, parseAuditionReviews(localStorage.getItem(STORAGE))); setReviews(latestReviews.current); } catch { /* The in-memory notes can still be exported. */ }
    const known = new Set(audition.clips.map(key));
    const currentReviews = Object.fromEntries(Object.entries(latestReviews.current).filter(([id]) => known.has(id)));
    const blob = new Blob([JSON.stringify({ kind: 'minimalpairs-voice-audition-review', auditionId: audition.id, exportedAt: new Date().toISOString(), reviews: currentReviews, clips: audition.clips }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download='minimalpairs-voice-audition-review.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="va-desk"><header><Brand/><a href="/word-review?bank=zh">← Word bank</a><span>VOICE AUDITION</span></header><main>
    <section className="va-intro"><p className="va-eyebrow">LISTEN FIRST. THEN CHECK.</p><h1>Find the voices<br/><em>worth learning from.</em></h1><p>A small audition, separate from practice. Hear each recording before revealing its word. Check the intended sound, accent and naturalness before approving it.</p></section>
    <div className="va-summary"><span><b>{words.length}</b> words in this bank · <b>{audition.clips.length}</b> recordings total</span><button onClick={download} disabled={!ready}>Export your review</button></div>
    <p className="va-caution">Your checks save in this browser and do not automatically publish audio to practice.</p>
    {notice && <p role="status" className="va-notice">{notice}</p>}
    <nav aria-label="Audition language">{banks.map(id => <button key={id} aria-pressed={bank === id} onClick={()=>switchBank(id)}>{bankNames[id] || id}</button>)}</nav>
    {word ? <div className="va-workspace"><aside><h2>Word samples</h2><p>Labels stay hidden until you reveal them.</p><div className="va-word-grid">{words.map((w,i)=><button aria-label={`Sample ${i+1}`} aria-pressed={word.wordId === w.wordId} key={w.wordId} onClick={()=>choose(w.wordId)}>{String(i+1).padStart(2,'0')}</button>)}</div></aside><section className="va-main" aria-label="Selected word audition">
      <div className="va-word"><p className="va-eyebrow">SAMPLE {String(words.indexOf(word)+1).padStart(2,'0')} · {bankNames[bank] || bank}</p>{revealed ? <><h2 lang={word.languageId === 'zh' ? 'zh-CN' : word.languageId}>{word.text}</h2><p className="va-ipa">{word.reading} {word.ipa}</p><p>{word.meaning}</p></> : <><h2>What do you hear?</h2><p>Listen without spelling or tone labels influencing you.</p></>}<button className="va-reveal" onClick={()=>setRevealed(!revealed)}>{revealed ? 'Hide the word' : 'Reveal word & pronunciation'}</button></div>
      <div className="va-clips">{clips.map((clip,i) => <article key={key(clip)} className="va-clip"><div className="va-clip-title"><h3>Recording {String.fromCharCode(65+i)}</h3><span>{reviews[key(clip)]?.status === 'pass' ? 'Marked correct by you' : reviews[key(clip)]?.status === 'fix' ? 'Needs correction' : reviews[key(clip)]?.status === 'unsure' ? 'Unsure' : 'Not reviewed'}</span></div>
        <button aria-label={`Listen to recording ${String.fromCharCode(65+i)}`} disabled={loading === key(clip)} aria-busy={loading === key(clip)} onClick={()=>void listen(clip)}>{loading === key(clip) ? 'Checking recording…' : `Listen to recording ${String.fromCharCode(65+i)}`}</button>
        <audio ref={element=>{if(element){elements.current.set(key(clip),element);const cached=verified.current.get(key(clip));if(cached&&element.src!==cached)element.src=cached;}else elements.current.delete(key(clip));}} controls preload="none" aria-label={`Play recording ${String.fromCharCode(65+i)}`} onPlay={e=>{if(verified.current.get(key(clip)) !== e.currentTarget.src){e.currentTarget.pause();return;}if(player.current && player.current !== e.currentTarget)player.current.pause();player.current=e.currentTarget;}} onEnded={e=>ended(clip,e.currentTarget)} onError={()=>{setHeard(before=>{const next=new Set(before);next.delete(key(clip));return next;});setNotice('This recording could not play. It cannot be approved until playback succeeds.');}}/>
        {clip.technicalStatus !== 'pass' && <p className="va-flag">Technical screening flagged this recording. Kept here as a diagnostic example; it cannot be approved for practice.</p>}
        {providers && <p className="va-provenance">{clip.provider} · {clip.voiceId}<br/>Requested language: {clip.requestedLanguage || 'Chinese'} · target variety: {clip.locale}<br/>{clip.model}</p>}
        {revealed && <><label>Your pronunciation check<select aria-label={`Review recording ${String.fromCharCode(65+i)}`} disabled={!ready} value={reviews[key(clip)]?.status || 'unreviewed'} onChange={e=>change(clip,{status:e.target.value as Review['status']})}><option value="unreviewed">Not reviewed</option><option value="pass" disabled={!heard.has(key(clip)) || clip.technicalStatus !== 'pass'}>Correct word, sound and accent</option><option value="fix">Needs correction</option><option value="unsure">Unsure — needs another listener</option></select></label><textarea disabled={!ready} aria-label={`Notes for recording ${String.fromCharCode(65+i)}`} maxLength={2000} rows={2} placeholder="What sounds wrong? Tone, vowel, accent, extra speech…" value={reviews[key(clip)]?.note || ''} onChange={e=>change(clip,{note:e.target.value})}/><small>Listen through the whole clip before marking it correct. Naturalness alone is not pronunciation accuracy.</small>{clip.aiAudit && <details><summary>Automated screening</summary><p>{clip.aiAudit.note}</p>{clip.aiAudit.transcript && <p>Independent transcript: {clip.aiAudit.transcript}</p>}</details>}</>}
      </article>)}</div><div className="va-actions"><button onClick={()=>setProviders(!providers)}>{providers ? 'Hide voice details' : 'Reveal voice details'}</button><button disabled={words.indexOf(word)===words.length-1} onClick={()=>choose(words[words.indexOf(word)+1].wordId)}>Next word →</button></div>
    </section></div> : <p>No generated candidates are available in this batch yet.</p>}
    <details className="va-method"><summary>What this audition can establish</summary><p>Each clip is tied to its exact audio bytes, intended word, provider, voice and language. Technical checks establish playable audio. Automated recognition can flag problems; it cannot certify tone, accent or the target phoneme. Human checks are still required. These samples are not part of the training audio cache.</p>{audition.providerNotes.map((note,i)=><p key={i}>{note}</p>)}</details>
    <footer>{audition.textBankId} · {audition.id} · No automatic generation or purchases from this page.</footer>
  </main></div>;
}

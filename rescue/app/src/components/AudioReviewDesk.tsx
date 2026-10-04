import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewCatalog, ReviewClip, ReviewGroup } from '../lib/audio-review-catalog';
import { emptyReviewState, parseReviewState, parseReviewStateWithReport, audioReviewCsv, readReviewState, writeReviewState, mergeReviewState, type AudioReviewState, type AudioReviewStatus } from '../lib/audio-review-state';
import { assignSessionVoices, buildSession } from '../lib/practice-engine';
import { Brand, Icon } from './ui';
import '../styles/audio-review.css';

type Sample = { label: string; clip: ReviewClip; ipa: string };
type Trial = { samples: Sample[]; answer: string; group: string };
const statusNames: Record<AudioReviewStatus, string> = { unreviewed: 'Not reviewed', pass: 'Sounds correct', fix: 'Needs fixing', unsure: 'Unsure' };
const unique = <T,>(items: T[]) => [...new Set(items)];
// An imported backup may come from a device whose clock is ahead of this one.
const editedAt = (previous: string) => new Date(Math.max(Date.now(), Math.min(Date.parse(previous) + 1, 253402300799999))).toISOString();
const groupClipIds = (group: ReviewGroup) => unique(group.pairs.flatMap(pair => pair.words.flatMap(word => word.clipIds)));

export default function AudioReviewDesk({ catalog }: { catalog: ReviewCatalog }) {
  const [reviews, setReviews] = useState<AudioReviewState>(emptyReviewState);
  const latestReviews = useRef(reviews);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [notice, setNotice] = useState('');
  const [collectionId, setCollectionId] = useState(catalog.collections.find(collection => collection.id === 'qwen-starter-v1')?.id || catalog.collections[0]?.id || '');
  const [languageId, setLanguageId] = useState('fr');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(catalog.groups[0]?.id || '');
  const [heard, setHeard] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [sequencePlaying, setSequencePlaying] = useState(false);
  const [audioError, setAudioError] = useState<{ id: string; message: string } | null>(null);
  const [trial, setTrial] = useState<Trial | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const cancelCurrent = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const importInput = useRef<HTMLInputElement | null>(null);
  const clipById = useMemo(() => new Map(catalog.clips.map(clip => [clip.id, clip])), [catalog]);
  const knownClips = useMemo(() => catalog.clips.map(clip => clip.id), [catalog]);
  const knownGroups = useMemo(() => catalog.groups.map(group => group.id), [catalog]);

  useEffect(() => {
    const saved = readReviewState();
    if (saved) { latestReviews.current = parseReviewState(saved, knownClips, knownGroups) || emptyReviewState(); setReviews(latestReviews.current); }
    else setStorageError('Saved reviews could not be loaded. Export a backup before closing this tab.');
    setLoaded(true);
    const params = new URLSearchParams(location.search);
    const chosen = catalog.groups.find(group => group.contrastId === params.get('contrast') && (!params.get('collection') || group.collectionId === params.get('collection')));
    if (chosen) { setCollectionId(chosen.collectionId); setLanguageId(chosen.languageId); setSelectedId(chosen.id); }
    const synchronize = (event: StorageEvent) => {
      if (event.key !== 'minimalpairs.audio-review.v1' || !event.newValue) return;
      const incoming = parseReviewState(event.newValue, knownClips, knownGroups);
      const merged = incoming && mergeReviewState(latestReviews.current, incoming);
      if (merged) { latestReviews.current = merged; setReviews(merged); }
    };
    window.addEventListener('storage', synchronize);
    return () => { window.removeEventListener('storage', synchronize); generation.current++; cancelCurrent.current?.(); audio.current?.pause(); };
  }, []);

  const clipReview = (id: string) => reviews.clipReviews[id];
  const statusOf = (id: string) => clipReview(id)?.status || 'unreviewed';
  const scopedGroups = catalog.groups.filter(group => (!collectionId || group.collectionId === collectionId) && (languageId === 'all' || group.languageId === languageId));
  const visibleGroups = scopedGroups.filter(group => {
    const ids = groupClipIds(group);
    const text = [group.languageName, group.label, group.contrastId, ...group.phonemes, ...group.pairs.flatMap(pair => pair.words.flatMap(word => [word.text, word.ipa, word.meaning]))].join(' ').normalize('NFC').toLowerCase();
    if (query && !text.includes(query.normalize('NFC').trim().toLowerCase())) return false;
    if (filter === 'missing') return ids.some(id => !clipById.get(id)?.exists);
    if (filter === 'fix') return reviews.groupReviews[group.id]?.status === 'fix' || ids.some(id => statusOf(id) === 'fix');
    if (filter === 'unsure') return reviews.groupReviews[group.id]?.status === 'unsure' || ids.some(id => statusOf(id) === 'unsure');
    if (filter === 'pass') return ids.length > 0 && ids.every(id => clipById.get(id)?.exists && statusOf(id) === 'pass');
    if (filter === 'unreviewed') return ids.some(id => statusOf(id) === 'unreviewed');
    return true;
  });
  const group = visibleGroups.find(item => item.id === selectedId) || visibleGroups[0];
  const scopeIds = unique(scopedGroups.flatMap(groupClipIds));
  const scopeClips = scopeIds.map(id => clipById.get(id)).filter((clip): clip is ReviewClip => Boolean(clip));
  const passed = scopeClips.filter(clip => clip.exists && statusOf(clip.id) === 'pass').length;
  const flagged = scopeClips.filter(clip => statusOf(clip.id) === 'fix').length;
  const missing = scopeClips.filter(clip => !clip.exists).length;
  const languages = unique(catalog.groups.filter(item => !collectionId || item.collectionId === collectionId).map(item => item.languageId)).map(id => ({ id, name: catalog.groups.find(g => g.languageId === id)!.languageName }));

  useEffect(() => { generation.current++; cancelCurrent.current?.(); audio.current?.pause(); setPlayingId(null); setSequencePlaying(false); setTrial(null); setAudioError(null); }, [group?.id]);
  function save(next: AudioReviewState) {
    // Retain intervening edits from this tab and other review tabs, including during import.
    let merged = mergeReviewState(next, latestReviews.current);
    const persisted = readReviewState();
    const current = persisted && parseReviewState(persisted, knownClips, knownGroups);
    if (merged && current) merged = mergeReviewState(merged, current);
    if (!merged) { setStorageError('The combined review history is too large to save. Export a backup.'); return; }
    latestReviews.current = merged; setReviews(merged);
    setStorageError(writeReviewState(merged) ? '' : 'Your latest changes are only in this tab. Export a review backup before closing it.');
  }
  function updateClip(id: string, patch: { status?: AudioReviewStatus; note?: string }) {
    if (!loaded || (patch.status === 'pass' && (!heard.has(id) || !clipById.get(id)?.exists))) return;
    const before = latestReviews.current.clipReviews[id] || { status: 'unreviewed' as const, note: '', updatedAt: new Date().toISOString() };
    save({ ...reviews, clipReviews: { ...reviews.clipReviews, [id]: { ...before, ...patch, updatedAt: editedAt(before.updatedAt) } } });
  }
  function updateGroup(patch: { status?: AudioReviewStatus; note?: string }) {
    if (!loaded || !group) return;
    const before = latestReviews.current.groupReviews[group.id] || { status: 'unreviewed' as const, note: '', updatedAt: new Date().toISOString() };
    save({ ...reviews, groupReviews: { ...reviews.groupReviews, [group.id]: { ...before, ...patch, updatedAt: editedAt(before.updatedAt) } } });
  }
  function stop() { generation.current++; cancelCurrent.current?.(); audio.current?.pause(); setPlayingId(null); setSequencePlaying(false); }
  async function playExact(clip: ReviewClip, token: number): Promise<boolean> {
    if (!clip.exists || !clip.url || !clip.sha256 || token !== generation.current) return false;
    cancelCurrent.current?.();
    setPlayingId(clip.id); setAudioError(null);
    return new Promise(resolve => {
      const controller = new AbortController();
      let player: HTMLAudioElement | null = null;
      let objectUrl: string | null = null;
      let settled = false;
      const finish = (ok: boolean, message?: string) => {
        if (settled) return;
        settled = true; clearTimeout(timer); controller.abort();
        if (player) { player.pause(); player.onended = null; player.onerror = null; }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (cancelCurrent.current === cancel) { audio.current = null; cancelCurrent.current = null; setPlayingId(null); }
        if (ok && token === generation.current) setHeard(previous => new Set([...previous, clip.id]));
        if (message && token === generation.current) setAudioError({ id: clip.id, message });
        resolve(ok);
      };
      const cancel = () => finish(false);
      const timer = window.setTimeout(() => finish(false, 'Playback timed out. Replay or flag this recording.'), 25000);
      cancelCurrent.current = cancel;
      void (async () => {
        try {
          const response = await fetch(clip.url!, { signal: controller.signal });
          if (!response.ok) throw new Error('load');
          const bytes = await response.arrayBuffer();
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
          if (settled || token !== generation.current) return;
          if (hash !== clip.sha256) { finish(false, 'This recording has changed since this inventory was built. It cannot be approved here. Refresh the review page.'); return; }
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: response.headers.get('content-type') || 'audio/mpeg' }));
          player = new Audio(objectUrl); audio.current = player;
          player.onended = () => finish(true);
          player.onerror = () => finish(false, 'This exact recording could not play. No replacement voice was used.');
          await player.play();
        } catch { if (!settled) finish(false, 'This exact recording could not be loaded or played. Try the play button again.'); }
      })();
    });
  }
  async function listen(clip: ReviewClip) { stop(); const token = generation.current; await playExact(clip, token); }
  function makeTrial() {
    stop(); setAudioError(null); if (!group) return;
    const complete = group.voices.filter(voice => group.pairs.every(pair => pair.words.every(word => word.clipIds.some(id => { const clip = clipById.get(id); return clip?.exists && clip.voiceId === voice.id && !clip.sourceStatus.startsWith('rejected') && !clip.sourceStatus.includes('checksum mismatch'); }))));
    if (complete.length < 2) { setTrial(null); setNotice('This group needs two complete voice profiles before its cross-voice practice can be checked.'); return; }
    const pairs = group.pairs.map(pair => ({ ...pair, kind: 'review', abx: { trialGroup: pair.trialGroup, targetPosition: pair.targetPosition } }));
    const question = assignSessionVoices(buildSession(pairs, 1), complete.map(voice => voice.id))[0];
    if (!question) { setTrial(null); setNotice('This group does not have enough distinct words in a compatible trial group.'); return; }
    const samples = (['A', 'B', 'X'] as const).map((label, index) => {
      const pair = group.pairs.find(p => p.id === (label === 'X' ? question.testPair.id : question.pair.id))!;
      const word = pair.words[label === 'X' ? question.target : question.order[index as 0 | 1]];
      const voice = label === 'X' ? question.testVoiceId : question.referenceVoiceId;
      const clip = word.clipIds.map(id => clipById.get(id)).find(c => c?.exists && c.voiceId === voice)!;
      return { label, clip, ipa: word.ipa };
    });
    setTrial({ samples, answer: question.order.indexOf(question.target) === 0 ? 'A' : 'B', group: question.pair.abx?.trialGroup || 'all' }); setNotice('');
  }
  async function playTrial() {
    if (!trial) return; stop(); const token = generation.current; setSequencePlaying(true);
    try { for (const sample of trial.samples) { if (token !== generation.current || !await playExact(sample.clip, token)) break; await new Promise(resolve => setTimeout(resolve, 350)); } }
    finally { if (token === generation.current) setSequencePlaying(false); }
  }
  function download(filename: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBackup() {
    download('minimalpairs-audio-review.json', JSON.stringify({ exportedAt: new Date().toISOString(), catalogFingerprint: catalog.fingerprint, reviewState: reviews, catalog }, null, 2), 'application/json');
    setNotice('Review backup downloaded. It includes your notes and the exact recording inventory.');
  }
  function exportCsv() {
    const rows = [['language', 'collections', 'word', 'voice', 'source', 'file', 'sha256', 'file_available', 'review_status', 'note', 'reviewed_at']];
    for (const clip of catalog.clips) rows.push([clip.languageId, clip.collectionIds.join(' | '), clip.text, clip.voiceName, clip.source, clip.url || '', clip.sha256 || '', clip.exists ? 'yes' : 'no', statusNames[statusOf(clip.id)], clipReview(clip.id)?.note || '', clipReview(clip.id)?.updatedAt || '']);
    download('minimalpairs-recordings-review.csv', '\uFEFF' + audioReviewCsv(rows[0], rows.slice(1)), 'text/csv;charset=utf-8');
  }
  async function importBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10000000) throw new Error('This backup is too large.');
      const parsed = JSON.parse(await file.text()); const source = parsed.reviewState || parsed;
      const result = parseReviewStateWithReport(source, knownClips, knownGroups);
      const incoming = result?.state;
      if (!incoming || !result) throw new Error('This file is not a valid review backup.');
      const keptCount = Object.keys(incoming.clipReviews).length + Object.keys(incoming.groupReviews).length;
      const merged = mergeReviewState(reviews, incoming);
      if (!merged) throw new Error('This merged backup contains too many entries.');
      save(merged); setNotice(`Review backup merged. ${keptCount} matching entries read; ${result.skippedUnknownClips + result.skippedUnknownGroups} entries for different or replaced material skipped; ${result.skippedInvalidClips + result.skippedInvalidGroups} invalid entries skipped.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The backup could not be read.'); }
    finally { if (importInput.current) importInput.current.value = ''; }
  }

  function clipRow(clip: ReviewClip) {
    const review = clipReview(clip.id);
    return <div className={'qa-clip status-' + statusOf(clip.id)} key={clip.id} data-clip-id={clip.id}>
      <div className="qa-clip-top"><button className="qa-play" disabled={!clip.exists} onClick={() => void listen(clip)} aria-label={`Play ${clip.text}, ${clip.voiceName}`}><Icon name={playingId === clip.id ? 'volume' : 'play'} size={15} />{playingId === clip.id ? 'Playing' : 'Play'}</button><div><strong>{clip.voiceName}</strong><small>{clip.exists ? 'Recording' : 'Recording missing'}</small></div>{heard.has(clip.id) && <span className="qa-heard" aria-label="Played to the end"><Icon name="check" size={14} /> Listened</span>}</div>
      <label className="qa-status-label">Recording review<select value={statusOf(clip.id)} onChange={event => updateClip(clip.id, { status: event.target.value as AudioReviewStatus })} disabled={!loaded} aria-label={`Review ${clip.text}, ${clip.voiceName}`}>
        <option value="unreviewed">Not reviewed</option><option value="pass" disabled={!heard.has(clip.id) || !clip.exists}>Sounds correct</option><option value="fix">Needs fixing</option><option value="unsure">Unsure</option>
      </select></label>
      {!heard.has(clip.id) && statusOf(clip.id) === 'unreviewed' && clip.exists && <p className="qa-listen-hint">Play the whole clip before marking it correct.</p>}
      <label className="qa-note-label">Correction or note<textarea rows={2} maxLength={2000} value={review?.note || ''} onChange={event => updateClip(clip.id, { note: event.target.value })} placeholder="Wrong word, laughter, wrong vowel, cut off…" aria-label={`Note for ${clip.text}, ${clip.voiceName}`} disabled={!loaded} /></label>
      {audioError?.id === clip.id && <p className="qa-error" role="alert">{audioError.message}</p>}
      <details className="qa-file"><summary>Recording details</summary><p>Voice ID: {clip.voiceId}<br />Source: {clip.source}<br />Source status: {clip.sourceStatus}</p>{clip.url && <a href={clip.url} target="_blank" rel="noreferrer">Open exact audio file ↗</a>}<code>{clip.sha256 || 'No cached audio file'}</code></details>
    </div>;
  }

  return <div className="qa-desk"><header className="qa-header"><Brand /><a href="/word-review">Review words &amp; IPA first <Icon name="arrow" size={15} /></a></header>
    <main><section className="qa-intro"><div><p className="eyebrow">HUMAN QUALITY REVIEW</p><h1>Listen to everything.<br /><em>Keep only what’s right.</em></h1><p>Every currently published contrast, word and recording in one place. Words are visible here because this is the review workspace.</p></div><div className="qa-backup"><strong>Your notes stay in this browser.</strong><p>Export a backup to keep them or return them for corrections. Marking a clip here does not change the live practice library.</p><div><button onClick={exportBackup} disabled={!loaded}>Export review</button><button onClick={() => importInput.current?.click()} disabled={!loaded}>Import review</button><button onClick={exportCsv} disabled={!loaded}>Recording CSV</button></div><input ref={importInput} type="file" accept=".json,application/json" hidden onChange={event => void importBackup(event.target.files?.[0])} /></div></section>
      {storageError && <p className="qa-error qa-notice" role="alert">{storageError}</p>}{notice && <p className="qa-notice" role="status">{notice}</p>}
      <section className="qa-workflow" aria-label="Review checklist"><span><b>1</b> Check the word pairs and groups.</span><span><b>2</b> Listen to each voice. Flag anything wrong.</span><span><b>3</b> Check an A/B/X round. Export your notes.</span></section>
      <div className="qa-filters"><label>Audio collection<select aria-label="Audio collection" value={collectionId} onChange={event => { stop(); setCollectionId(event.target.value); setLanguageId('all'); setQuery(''); }}><option value="">All collections</option>{catalog.collections.map(collection => <option key={collection.id} value={collection.id}>{collection.label}</option>)}</select></label><label>Language<select aria-label="Language" value={languageId} onChange={event => setLanguageId(event.target.value)}><option value="all">All languages</option>{languages.map(language => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label><label>Find a word or contrast<input aria-label="Find a word or contrast" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Word, sound, meaning…" /></label><label>Show<select aria-label="Show" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All groups</option><option value="unreviewed">Not fully reviewed</option><option value="fix">Needs fixing</option><option value="unsure">Unsure</option><option value="missing">Missing audio</option><option value="pass">Recordings checked</option></select></label></div>
      <div className="qa-counts"><span><strong>{scopedGroups.length}</strong> contrast groups</span><span><strong>{scopedGroups.reduce((total, item) => total + item.pairs.length, 0)}</strong> pair entries</span><span><strong>{passed}/{scopeClips.filter(clip => clip.exists).length}</strong> recordings marked correct</span><span><strong>{flagged}</strong> need fixing</span><span><strong>{missing}</strong> missing slots</span></div>
      <div className="qa-layout"><aside className="qa-index"><p>{visibleGroups.length} groups shown</p><nav aria-label="Contrast review index">{visibleGroups.map(item => { const ids = groupClipIds(item); const correct = ids.filter(id => clipById.get(id)?.exists && statusOf(id) === 'pass').length; const issues = ids.filter(id => statusOf(id) === 'fix').length; return <button key={item.id} className={group?.id === item.id ? 'is-selected' : ''} onClick={() => { setSelectedId(item.id); document.getElementById('qa-selected-group')?.scrollIntoView({ block: 'start' }); }} aria-current={group?.id === item.id ? 'true' : undefined}><small>{item.languageName}{!collectionId ? ' · ' + catalog.collections.find(c => c.id === item.collectionId)?.label : ''}</small><strong>{item.label}</strong><span>{item.pairs.length} pairs · {correct}/{ids.length} clips checked{issues ? ` · ${issues} flagged` : ''}</span></button>; })}</nav></aside>
        <section id="qa-selected-group" className="qa-group" aria-label="Selected contrast review">{group ? <>
          <header className="qa-group-heading"><p className="eyebrow">{group.languageName} · {group.dialect}</p><h2>{group.label}</h2><p className="qa-phonemes">{group.phonemes.join('  vs  ')}</p><p>{group.focus}</p><code>{group.contrastId}</code></header>
          <details className="qa-instructions"><summary>What to check</summary><ul><li>Both words are real, correctly written and correctly transcribed for the stated variety.</li><li>Each pair contrasts the intended sound or feature, with matching category order.</li><li>Each recording says its labelled word naturally: no laughter, silence, extra words or clipped sounds.</li><li>Compare the intended contrast in every voice. A valid audio file is not necessarily a correct pronunciation.</li></ul>{group.notes.map((note, i) => <p key={i}>{note}</p>)}</details>
          <div className="qa-group-review"><label>Word list and grouping<select aria-label="Word list and grouping" value={reviews.groupReviews[group.id]?.status || 'unreviewed'} onChange={event => updateGroup({ status: event.target.value as AudioReviewStatus })} disabled={!loaded}><option value="unreviewed">Not reviewed</option><option value="pass">Words and grouping look correct</option><option value="fix">Needs a content correction</option><option value="unsure">Unsure — needs another reviewer</option></select></label><label>Group note<textarea aria-label="Group note" rows={2} maxLength={2000} value={reviews.groupReviews[group.id]?.note || ''} onChange={event => updateGroup({ note: event.target.value })} placeholder="Missing pair, wrong category, dialect issue…" disabled={!loaded} /></label><p>This checks the written content. Review the recordings individually below.</p></div>
          <section className="qa-trial"><div><h3>Check a real A / B / X combination</h3><p>Uses the practice generator. See the exact words, voice profiles and expected answer while you listen.</p></div><button onClick={makeTrial}>Choose a combination <Icon name="replay" size={15} /></button>{trial && <><div className="qa-trial-samples">{trial.samples.map(sample => <button key={sample.label} onClick={() => void listen(sample.clip)}><b>{sample.label}</b><strong>{sample.clip.text}</strong><span>{sample.ipa}</span><small>{sample.clip.voiceName}</small><Icon name="play" size={14} /></button>)}</div><div className="qa-trial-bottom"><button onClick={() => void playTrial()} disabled={sequencePlaying}>Play A → B → X</button><p>X should match <strong>{trial.answer}</strong> · Trial group: <code>{trial.group}</code></p></div></>}</section>
          <div className="qa-pairs">{group.pairs.map((pair, index) => <article className="qa-pair" key={pair.id}><header><h3>Pair {String(index + 1).padStart(2, '0')}</h3><span>Trial group: <code>{pair.trialGroup}</code>{pair.targetPosition ? ' · ' + pair.targetPosition : ''}</span></header><div className="qa-pair-words">{pair.words.map((word, side) => <section key={side} className={'qa-word side-' + side}><div className="qa-word-heading"><strong>{word.text}</strong><span>{word.ipa}</span><p>{word.meaning}</p></div>{word.clipIds.map(id => clipById.get(id)).filter((clip): clip is ReviewClip => Boolean(clip)).map(clipRow)}</section>)}</div></article>)}</div>
          {group.sources.length > 0 && <details className="qa-sources"><summary>Word and contrast references</summary><ul>{group.sources.map(source => <li key={source}><a href={source} target="_blank" rel="noreferrer">{source}</a></li>)}</ul></details>}
        </> : <div className="qa-empty"><h2>No groups match these filters.</h2><button onClick={() => { setQuery(''); setFilter('all'); }}>Clear search and review filter</button></div>}</section>
      </div>
      {catalog.unassignedClipIds.length > 0 && <details className="qa-unassigned"><summary>Other published recordings not assigned to a current exercise ({catalog.unassignedClipIds.length})</summary><p>These files are included so the recording inventory is complete.</p><div>{catalog.unassignedClipIds.map(id => clipById.get(id)).filter((clip): clip is ReviewClip => Boolean(clip)).map(clipRow)}</div></details>}
      <footer className="qa-footer"><p>Scope: currently published practice and audio-preview collections. Unreleased text candidates and reserved assessment words are excluded. This is a human review workspace; no clip is approved by an automated file check.</p><code>Inventory {catalog.fingerprint.slice(0, 16)}</code><a href="/audio-credits">Recording sources and credits ↗</a></footer>
    </main>{(playingId || sequencePlaying) && <button className="qa-stop" onClick={stop}><Icon name="close" size={16} /> Stop audio</button>}
  </div>;
}

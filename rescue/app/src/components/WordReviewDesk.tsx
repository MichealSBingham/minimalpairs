import { useEffect, useRef, useState } from 'react';
import type { TextFinding, TextGroup, WordReviewCatalog } from '../lib/word-review-catalog';
import { emptyReviewState, parseReviewState, parseReviewStateWithReport, mergeReviewState, readReviewState, writeReviewState, audioReviewCsv, type AudioReviewState, type AudioReviewStatus } from '../lib/audio-review-state';
import { Brand } from './ui';
import '../styles/word-review.css';
const KEY = 'minimalpairs.word-review.v1';
const statusNames = { unreviewed: 'Not reviewed', pass: 'Looks correct', fix: 'Needs correction', unsure: 'Unsure' };
const storage = () => ({ getItem: () => localStorage.getItem(KEY), setItem: (_key: string, value: string) => localStorage.setItem(KEY, value) });
const phoneme = (text: string) => /^T[1-4]$/.test(text) ? `Tone ${text.slice(1)}` : /\s/.test(text) ? text : `/${text.replaceAll('/', '')}/`;
const nextTime = (previous: string) => new Date(Math.max(Date.now(), Math.min(Date.parse(previous) + 1, 253402300799999))).toISOString();
export default function WordReviewDesk({ catalog }: { catalog: WordReviewCatalog }) {
  const [language, setLanguage] = useState('all'), [scope, setScope] = useState('all'), [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [reviews, setReviews] = useState<AudioReviewState>(emptyReviewState), latest = useRef(reviews);
  const [ready, setReady] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pairKeys = catalog.groups.flatMap(group => group.pairs.map(pair => pair.key)), groupKeys = catalog.groups.map(group => group.key);
  const parse = (value: unknown) => parseReviewState(value, pairKeys, groupKeys);
  useEffect(() => {
    const saved = readReviewState(storage());
    if (saved) { latest.current = parse(saved) || emptyReviewState(); setReviews(latest.current); }
    else setError('Saved notes could not be loaded. Export a backup before leaving this tab.');
    const requested = new URLSearchParams(location.search).get('language');
    if (catalog.languages.some(item => item.id === requested)) setLanguage(requested!);
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key !== KEY || !event.newValue) return;
      const incoming = parse(event.newValue), merged = incoming && mergeReviewState(latest.current, incoming);
      if (merged) { latest.current = merged; setReviews(merged); }
    };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);
  function save(next: AudioReviewState) {
    let merged = mergeReviewState(next, latest.current);
    const persisted = readReviewState(storage()), known = persisted && parse(persisted);
    if (merged && known) merged = mergeReviewState(merged, known);
    if (!merged) { setError('This review is too large to save. Export your existing notes.'); return; }
    latest.current = merged; setReviews(merged);
    setError(writeReviewState(merged, storage()) ? '' : 'Notes are only in this tab. Export a backup before closing it.');
  }
  function edit(kind: 'clipReviews' | 'groupReviews', key: string, patch: { status?: AudioReviewStatus; note?: string }) {
    if (!ready) return;
    const before = latest.current[kind][key] || { status: 'unreviewed', note: '', updatedAt: new Date().toISOString() };
    save({ ...latest.current, [kind]: { ...latest.current[kind], [key]: { ...before, ...patch, updatedAt: nextTime(before.updatedAt) } } });
  }
  const status = (kind: 'clipReviews' | 'groupReviews', key: string) => reviews[kind][key]?.status || 'unreviewed';
  function hasFindings(group: TextGroup) { return group.findings.length > 0 || group.pairs.some(pair => pair.findings.length > 0); }
  const groups = catalog.groups.filter(group => {
    if (language !== 'all' && group.languageId !== language || scope !== 'all' && group.scope !== scope) return false;
    const searchable = [group.languageName, group.id, group.label, ...group.categories, ...group.pairs.flatMap(pair => pair.words.flatMap(w => [w.text, w.ipa, w.meaning, w.romanization || '']))].join(' ').normalize('NFC').toLowerCase();
    if (query.trim() && !searchable.includes(query.trim().normalize('NFC').toLowerCase())) return false;
    if (filter === 'findings') return hasFindings(group);
    if (filter === 'fix' || filter === 'unsure') return status('groupReviews', group.key) === filter || group.pairs.some(pair => status('clipReviews', pair.key) === filter);
    if (filter === 'unreviewed') return status('groupReviews', group.key) === 'unreviewed';
    if (filter === 'pass') return status('groupReviews', group.key) === 'pass';
    return true;
  });
  const mainGroups = catalog.groups.filter(group => group.scope === 'main');
  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportReview() {
    download('minimalpairs-word-review.json', JSON.stringify({ kind: 'minimalpairs-word-review', exportedAt: new Date().toISOString(), catalogFingerprint: catalog.fingerprint, reviewState: { schemaVersion: 1, pairReviews: latest.current.clipReviews, groupReviews: latest.current.groupReviews }, catalog }, null, 2), 'application/json');
    setNotice('Word-list review exported. This includes every draft word and your corrections.');
  }
  function exportCsv() {
    const rows = catalog.groups.flatMap(group => group.pairs.map(pair => [group.languageName, group.dialect, group.dialectNote, group.scope, group.id, group.categories.join(' vs '), pair.id, pair.kind, pair.words[0].text, pair.words[0].ipa, pair.words[0].romanization || '', pair.words[0].meaning, pair.words[1].text, pair.words[1].ipa, pair.words[1].romanization || '', pair.words[1].meaning, pair.target.map(phoneme).join(' vs '), pair.position, pair.trialGroup, pair.note, [...group.findings, ...pair.findings].map(f => f.message).join(' | '), [...group.sources, ...pair.sources].join(' | '), statusNames[status('groupReviews', group.key)], reviews.groupReviews[group.key]?.note || '', statusNames[status('clipReviews', pair.key)], reviews.clipReviews[pair.key]?.note || '']));
    download('minimalpairs-word-lists.csv', '\uFEFF' + audioReviewCsv(['language','dialect','dialect_note','scope','contrast_id','contrast','pair_id','pair_type','word_1','ipa_1','reading_1','meaning_1','word_2','ipa_2','reading_2','meaning_2','target_sounds','target_position','practice_group','draft_note','research_findings','draft_references','list_review','list_note','pair_review','pair_note'], rows), 'text/csv;charset=utf-8');
  }
  async function importReview(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error('This review file is too large.');
      const value = JSON.parse(await file.text());
      if (value.kind !== 'minimalpairs-word-review' || value.reviewState?.schemaVersion !== 1) throw new Error('Choose a word-list review backup. Audio reviews stay separate.');
      const parsed = parseReviewStateWithReport({ schemaVersion: 1, clipReviews: value.reviewState.pairReviews, groupReviews: value.reviewState.groupReviews }, pairKeys, groupKeys);
      if (!parsed) throw new Error('This review backup is invalid.');
      const merged = mergeReviewState(latest.current, parsed.state);
      if (!merged) throw new Error('The combined review is too large.');
      save(merged);
      setNotice(`Review merged. ${parsed.skippedUnknownClips + parsed.skippedUnknownGroups} changed or unknown entries skipped; ${parsed.skippedInvalidClips + parsed.skippedInvalidGroups} invalid entries skipped.`);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'The review could not be imported.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  function findingList(findings: TextFinding[]) {
    if (!findings.length) return null;
    return <div className="wr-findings">{findings.map((finding, i) => <div key={i}><strong>{finding.severity === 'correction' ? 'Correction identified' : 'Decision to review'}</strong><p>{finding.message}</p>{finding.suggestedCorrection && <p><b>Suggested change:</b> {finding.suggestedCorrection}</p>}{finding.sources.map((source, index) => <a href={source} target="_blank" rel="noreferrer" key={source}>Source {index + 1} ↗</a>)}</div>)}</div>;
  }
  return <div className="wr-desk"><header className="wr-header"><Brand /><a href="/audio-review">Audio review (later) ↗</a></header><main>
    <section className="wr-intro"><div><p className="eyebrow">WORD LISTS · OWNER REVIEW</p><h1>The words,<br /><em>before the voices.</em></h1><p>Check the intended contrast, the actual words and their IPA. These are draft lists for your review. We settle the text first; audio generation comes afterwards.</p></div><div className="wr-actions"><strong>Your review stays in this browser.</strong><p>Mark corrections below, then export your notes. These checks are separate from audio ratings and do not change the practice library.</p><div><button disabled={!ready} onClick={exportReview}>Export text review</button><button disabled={!ready} onClick={() => fileInput.current?.click()}>Import review</button><button onClick={exportCsv}>Download word lists</button><button onClick={() => window.print()}>Print current view</button></div><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => void importReview(event.target.files?.[0])} /></div></section>
    <p className="wr-scope"><b>{catalog.languages.length} languages · {mainGroups.length} main contrast lists · {mainGroups.reduce((n,g) => n+g.pairs.length,0)} main pairs.</b> Shared lists appear once across voice collections. One additional German list is labelled “Preview only”. This is the current rebuild, not a claim of complete language coverage.</p>
    {error && <p className="wr-error" role="alert">{error}</p>}{notice && <p className="wr-notice" role="status">{notice}</p>}
    <nav className="wr-language-nav" aria-label="Review language"><button aria-pressed={language === 'all'} onClick={() => setLanguage('all')}>All languages</button>{catalog.languages.map(l => <button key={l.id} aria-pressed={language === l.id} onClick={() => setLanguage(l.id)}>{l.name}<small>{catalog.groups.filter(g => g.languageId === l.id && g.scope === 'main').length} main lists</small></button>)}</nav>
    <div className="wr-filters"><label>Find a word or sound<input aria-label="Find a word or sound" type="search" placeholder="Word, IPA, meaning or contrast…" value={query} onChange={e => setQuery(e.target.value)} /></label><label>List scope<select aria-label="List scope" value={scope} onChange={e => setScope(e.target.value)}><option value="all">Main + preview-only lists</option><option value="main">Main curriculum only</option><option value="preview">Preview-only additions</option></select></label><label>Show<select aria-label="Review filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All lists</option><option value="findings">Research flags</option><option value="unreviewed">Lists not reviewed</option><option value="fix">Needs correction</option><option value="unsure">Unsure</option><option value="pass">Lists marked correct</option></select></label></div>
    <div className="wr-results"><span>{groups.length} lists · {groups.reduce((n,g) => n+g.pairs.length,0)} pairs in view</span><span>{catalog.groups.filter(g => status('groupReviews',g.key) === 'pass').length}/{catalog.groups.length} lists marked correct</span></div>
    <details className="wr-help"><summary>What to check before approving the list</summary><p>Check that each spelling matches its intended meaning and IPA in the stated dialect. Check that the pair isolates the intended sound, tone, stress or consonant length. Check less common words, inflections and regional variants. A broad IPA transcription is a category target, not a complete description of every phonetic detail.</p><p>Within a practice group, X comes from another pair. The left and right word categories must stay consistent across that group. Initial and final target positions are shown so you can inspect this grouping.</p><p>References are the sources recorded with the draft. Research flags are preliminary checks, not a certification of the list. Your notes here review text only.</p></details>
    {catalog.languages.filter(l => groups.some(g => g.languageId === l.id)).map(l => <section className="wr-language" key={l.id} aria-label={`${l.name} word lists`}><header><div><p className="eyebrow">{l.nativeName}</p><h2>{l.name}</h2><p>{l.dialect}</p></div><span>{groups.filter(g => g.languageId === l.id).length} lists in view</span></header>
      {groups.filter(g => g.languageId === l.id).map(group => <article className="wr-contrast" key={group.key} data-contrast-id={group.id}>
        <header className="wr-contrast-heading"><div><p className="wr-kicker">{group.scope === 'preview' ? 'PREVIEW ONLY · EXTRA WORD LIST' : group.id}</p><h3>{group.categories.map(phoneme).join('  —  ')}</h3><p>{group.label}</p></div><label>Whole-list check<select aria-label={`Review list ${group.id}`} value={status('groupReviews',group.key)} disabled={!ready} onChange={e => edit('groupReviews',group.key,{status:e.target.value as AudioReviewStatus})}>{Object.entries(statusNames).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label></header>
        <p className="wr-description">{group.description}</p><p className="wr-focus"><b>Pronunciation target:</b> {group.dialect}</p>{group.dialectNote && <p className="wr-draft-note">{group.dialectNote}</p>}{group.focus && <p className="wr-focus"><b>Target:</b> {group.focus}</p>}{group.scope === 'preview' && <p className="wr-preview-note">This list is used only in the additional audio collection. Variety: {group.dialect}.</p>}
        {findingList(group.findings)}
        <div className="wr-pair-header" aria-hidden="true"><span>First category</span><span>Second category</span><span>Pair check</span></div>
        {group.pairs.map(pair => <div className={'wr-pair status-'+status('clipReviews',pair.key)} key={pair.key} data-pair-id={pair.id}>
          <div className="wr-word-grid">{pair.words.map((word,side) => <div className={'wr-word side-'+side} key={side}><strong lang={l.id === 'zh' ? 'zh-CN' : l.id}>{word.text}</strong>{word.romanization && <span className="wr-reading">{word.romanization}</span>}<span className="wr-ipa">{word.ipa}</span><span className="wr-meaning">{word.meaning}</span></div>)}<div className="wr-pair-review"><label className="wr-screen-reader">Review pair {pair.id}<select aria-label={`Review pair ${pair.id}`} value={status('clipReviews',pair.key)} disabled={!ready} onChange={e => edit('clipReviews',pair.key,{status:e.target.value as AudioReviewStatus})}>{Object.entries(statusNames).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><small>{pair.kind === 'tone' ? 'Tone contrast' : pair.kind === 'stress' ? 'Stress contrast' : 'Minimal pair (draft)'}</small>{pair.target.length === 2 && <span>{pair.target.map(phoneme).join(' → ')}</span>}</div></div>
          <div className="wr-pair-meta"><span>{pair.position.replaceAll('-', ' ')} · Practice group: {pair.trialGroup}</span><details><summary>{reviews.clipReviews[pair.key]?.note ? 'Edit correction / note' : 'Add correction / note'}</summary><textarea aria-label={`Note for pair ${pair.id}`} maxLength={2000} rows={2} disabled={!ready} placeholder="Correct spelling, intended word, IPA, meaning, replacement pair…" value={reviews.clipReviews[pair.key]?.note || ''} onChange={e => edit('clipReviews',pair.key,{note:e.target.value})} /></details></div>
          {reviews.clipReviews[pair.key]?.note && <p className="wr-saved-note"><b>Your note:</b> {reviews.clipReviews[pair.key].note}</p>}{pair.note && <p className="wr-draft-note">{pair.note}</p>}{findingList(pair.findings)}
          {pair.sources.length > 0 && <details className="wr-references"><summary>Pair references</summary>{pair.sources.map((url,i) => <a key={url} href={url} target="_blank" rel="noreferrer">{i+1}. {url}</a>)}</details>}
        </div>)}
        <label className="wr-group-note">List corrections or missing words<textarea aria-label={`Note for list ${group.id}`} maxLength={2000} rows={2} disabled={!ready} value={reviews.groupReviews[group.key]?.note || ''} onChange={e => edit('groupReviews',group.key,{note:e.target.value})} placeholder="A missing pair, questionable grouping, preferred dialect…" /></label>{reviews.groupReviews[group.key]?.note && <p className="wr-saved-group-note"><b>Your list note:</b> {reviews.groupReviews[group.key].note}</p>}
        {group.sources.length > 0 && <details className="wr-references"><summary>Contrast references</summary>{group.sources.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>)}</details>}
      </article>)}
      {catalog.coverageGaps.some(g => g.languageId === l.id) && <details className="wr-gaps"><summary>{catalog.coverageGaps.filter(g => g.languageId === l.id).length} former-site topics are not in the main list yet</summary><p>These are coverage gaps, not approved additions. Existing isolated candidates are excluded from this current-word inventory.</p><ul>{catalog.coverageGaps.filter(g => g.languageId === l.id).map(g => <li key={g.label}>{g.label}</li>)}</ul></details>}
    </section>)}
    {groups.length === 0 && <p className="wr-empty">No lists match. <button onClick={() => {setLanguage('all');setQuery('');setScope('all');setFilter('all');}}>Clear filters</button></p>}
    <footer><p>Text review only. No audio is loaded or generated on this page. Approvals apply to this exact draft; changed words or IPA need a new review.</p><small>Draft {catalog.fingerprint.slice(0,16)}</small></footer>
  </main></div>;
}

import { useEffect, useRef, useState } from 'react';
import type { PhonemeLibrary, PoolContrast, PoolMember } from '../lib/phoneme-library';
import { emptyReviewState, parseReviewState, parseReviewStateWithReport, mergeReviewState, readReviewState, writeReviewState, audioReviewCsv, type AudioReviewState, type AudioReviewStatus } from '../lib/audio-review-state';
import { Brand } from './ui';
import '../styles/phoneme-review.css';

const KEY = 'minimalpairs.phoneme-pools.v1';
const names = { unreviewed: 'Not reviewed', pass: 'Looks correct', fix: 'Needs correction', unsure: 'Unsure' };
const evidenceNames = { 'study-stimuli': 'Includes documented study words', 'study-contrast': 'L2 evidence for these sound categories', phonology: 'Phonology reference', 'editorial-candidate': 'Candidate for review' };
const bankIdFor = (c: PoolContrast) => c.varietyId || c.languageId;
const depthLabel = (c: PoolContrast) => !c.depth.meetsMinimum ? 'Below 4 per sound' : !c.depth.hasMinimumContext ? 'Needs context depth' : c.depth.meetsTarget ? '5+ words per sound' : '4+ words per sound';
const storage = () => ({ getItem: () => localStorage.getItem(KEY), setItem: (_key: string, value: string) => localStorage.setItem(KEY, value) });
const displayIpa = (ipa: string) => /^[/\[]/.test(ipa) || /^Tone |^T[1-4]$/.test(ipa) ? ipa : `/${ipa}/`;
const nextTime = (previous: string) => new Date(Math.max(Date.now(), Math.min(Date.parse(previous) + 1, 253402300799999))).toISOString();

export default function PhonemeReviewDesk({ library }: { library: PhonemeLibrary }) {
  const [bankId, setBankId] = useState(library.banks[0].id);
  const [selected, setSelected] = useState(library.contrasts[0].id);
  const [query, setQuery] = useState(''), [overview, setOverview] = useState(false);
  const [reviews, setReviews] = useState<AudioReviewState>(emptyReviewState), latest = useRef(reviews);
  const [ready, setReady] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const memberKeys = library.contrasts.flatMap(c => c.pools.flat().map(w => w.key));
  const contrastKeys = library.contrasts.map(c => c.key);
  const parse = (value: unknown) => parseReviewState(value, memberKeys, contrastKeys);
  useEffect(() => {
    const saved = readReviewState(storage());
    if (saved) { latest.current = parse(saved) || emptyReviewState(); setReviews(latest.current); }
    else setError('Your saved review could not be loaded. Export a backup before leaving.');
    const requested = new URLSearchParams(location.search);
    const contrast = library.contrasts.find(c => c.id === requested.get('contrast'));
    const requestedBank = requested.get('bank') || requested.get('variety') || (requested.get('language') === 'en' ? 'en-US-ga' : requested.get('language'));
    const bank = library.banks.find(b => b.id === (contrast ? bankIdFor(contrast) : requestedBank));
    if (bank) {
      setBankId(bank.id); setSelected(contrast?.id || library.contrasts.find(c => bankIdFor(c) === bank.id)!.id);
    }
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
    if (!merged) { setError('The review is too large to save. Export a backup.'); return; }
    latest.current = merged; setReviews(merged);
    setError(writeReviewState(merged, storage()) ? '' : 'Notes are only in this tab. Export a backup before closing.');
  }
  function edit(kind: 'clipReviews' | 'groupReviews', key: string, patch: { status?: AudioReviewStatus; note?: string }) {
    if (!ready) return;
    const before = latest.current[kind][key] || { status: 'unreviewed', note: '', updatedAt: new Date().toISOString() };
    save({ ...latest.current, [kind]: { ...latest.current[kind], [key]: { ...before, ...patch, updatedAt: nextTime(before.updatedAt) } } });
  }
  const status = (kind: 'clipReviews' | 'groupReviews', key: string) => reviews[kind][key]?.status || 'unreviewed';
  const currentBank = library.banks.find(b => b.id === bankId)!;
  const language = currentBank.languageId;
  const bankContrasts = library.contrasts.filter(c => bankIdFor(c) === bankId);
  const visible = bankContrasts.filter(c => [c.label, ...c.categories.map(category => category.ipa), ...c.pools.flat().flatMap(w => {
    const word = library.words[w.wordId]; return [word.text, word.ipa, word.meaning, word.reading || '', word.romanization || ''];
  })].join(' ').normalize('NFC').toLowerCase().includes(query.trim().normalize('NFC').toLowerCase()));
  const contrast = visible.find(c => c.id === selected) || visible[0];
  function choose(id: string) {
    const item = library.contrasts.find(c => c.id === id)!;
    setSelected(id); setBankId(bankIdFor(item)); setOverview(false);
    history.replaceState(null, '', `/word-review?language=${item.languageId}&bank=${encodeURIComponent(bankIdFor(item))}&contrast=${encodeURIComponent(id)}`);
  }
  function chooseBank(id: string) {
    setQuery(''); choose(library.contrasts.find(c => bankIdFor(c) === id)!.id);
  }
  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportReview() {
    download('minimalpairs-sound-pool-review.json', JSON.stringify({ kind: 'minimalpairs-sound-pool-review', exportedAt: new Date().toISOString(), libraryFingerprint: library.fingerprint, reviewState: { schemaVersion: 1, wordReviews: latest.current.clipReviews, contrastReviews: latest.current.groupReviews }, library }, null, 2), 'application/json');
    setNotice('Saved a backup with all contrasts, words, sources and your notes.');
  }
  function exportWords() {
    const rows = library.contrasts.flatMap(c => c.pools.flatMap((pool, side) => pool.map(member => {
      const word = library.words[member.wordId];
      return [library.languages.find(l => l.id === c.languageId)!.name, c.dialect, c.id, c.categories[0].ipa, c.categories[1].ipa, c.categories[side].ipa, word.text, word.ipa, word.romanization || '', word.meaning, member.position, member.group, member.targetSegment || '', member.targetOccurrence || '', c.evidenceLevel, member.stimulusSourceIds.join(' | '), member.sourceIds.join(' | '), names[status('clipReviews', member.key)], reviews.clipReviews[member.key]?.note || '', names[status('groupReviews', c.key)], reviews.groupReviews[c.key]?.note || '', c.scopeNote || '', c.varietyId || '', c.depth.distinctWords.join(' / '), c.depth.hasMinimumContext ? 'yes' : 'no', c.depth.distinctPronunciations.join(' / '), bankIdFor(c), library.release?.id || '', word.reading || '', member.segmentalFrame || '', member.split || ''];
    })));
    download('minimalpairs-sound-pools.csv', '\uFEFF' + audioReviewCsv(['language','dialect','contrast_id','sound_1','sound_2','word_category','word','ipa','reading','meaning','target_position','context_group','target_segment','target_occurrence','contrast_evidence','documented_stimulus_sources','word_reference_sources','word_review','word_note','contrast_review','contrast_note','contrast_scope_note','variety_id','distinct_words_per_sound','has_context_with_four_per_sound','distinct_ipa_forms_per_sound','bank_id','text_bank_version','kana_reading','segmental_frame','practice_split'], rows), 'text/csv;charset=utf-8');
  }
  async function importReview(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error('This review file is too large.');
      const value = JSON.parse(await file.text());
      if (value.kind !== 'minimalpairs-sound-pool-review' || value.reviewState?.schemaVersion !== 1) throw new Error('Choose a sound-pool review backup. Earlier pair reviews remain on the previous-review page.');
      const parsed = parseReviewStateWithReport({ schemaVersion: 1, clipReviews: value.reviewState.wordReviews, groupReviews: value.reviewState.contrastReviews }, memberKeys, contrastKeys);
      if (!parsed) throw new Error('This backup is invalid.');
      const merged = mergeReviewState(latest.current, parsed.state);
      if (!merged) throw new Error('The combined review is too large.');
      save(merged);
      setNotice(`Review imported. ${parsed.skippedUnknownClips + parsed.skippedUnknownGroups} changed entries and ${parsed.skippedInvalidClips + parsed.skippedInvalidGroups} invalid entries skipped.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not import the review.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }
  function references(ids: string[]) {
    return [...new Set(ids)].map(id => {
      const source = library.sources.find(s => s.id === id)!;
      return <div className="pr-source" key={id}>{source.url.startsWith('https://') ? <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : <b>{source.title} · local draft</b>}<p>{source.locator} · {source.whatItSupports}</p><small>{source.limitations}</small>{source.license && <p className="pr-source-license">Reuse / attribution: {source.license}</p>}</div>;
    });
  }
  function wordRow(member: PoolMember) {
    const word = library.words[member.wordId];
    return <li key={member.key} className={`pr-word is-${status('clipReviews', member.key)}`} data-word={word.text}>
      <div className="pr-word-title"><strong lang={language === 'zh' ? 'zh-CN' : language}>{word.text}</strong><span className="pr-ipa">{word.ipa}</span></div>
      {(word.reading || word.romanization) && <span className="pr-reading">{[word.reading, word.romanization].filter(Boolean).join(' · ')}</span>}<p className="pr-meaning">{word.meaning}</p>
      <div className="pr-word-footer"><span>{member.segmentalFrame ? `${member.segmentalFrame} · training word` : member.position.replaceAll('-', ' ')}</span><details><summary>{status('clipReviews', member.key) === 'unreviewed' && !reviews.clipReviews[member.key]?.note ? 'Review word' : names[status('clipReviews', member.key)]}</summary>
        <label>Word check<select aria-label={`Review word ${word.text}`} disabled={!ready} value={status('clipReviews', member.key)} onChange={e => edit('clipReviews', member.key, { status: e.target.value as AudioReviewStatus })}>{Object.entries(names).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <textarea aria-label={`Note for word ${word.text}`} rows={2} maxLength={2000} disabled={!ready} placeholder="Correction to the word, IPA or category…" value={reviews.clipReviews[member.key]?.note || ''} onChange={e => edit('clipReviews', member.key, { note: e.target.value })} />
        <p>{member.stimulusSourceIds.length ? 'This word is documented in the study material below. Its IPA and suitability here still need review.' : 'Proposed vocabulary. This word is not being claimed as a documented study stimulus.'}</p>
        <p>Context group: {member.group}</p>{member.targetSegment && <p>Selected target: {displayIpa(member.targetSegment)}{member.targetOccurrence ? `, occurrence ${member.targetOccurrence} in the word` : ''}.</p>}{references([...member.stimulusSourceIds, ...member.sourceIds])}
      </details></div>
      {reviews.clipReviews[member.key]?.note && <p className="pr-saved-note">{reviews.clipReviews[member.key].note}</p>}
    </li>;
  }
  function detail(c: PoolContrast) {
    const flags = c.pools.flat().filter(w => ['fix', 'unsure'].includes(status('clipReviews', w.key))).length;
    return <article className="pr-detail" data-contrast-id={c.id} key={c.id}>
      <header className="pr-detail-heading"><p className="pr-eyebrow">{currentBank.name} · {c.dialect}</p><h2>{c.categories.map(category => displayIpa(category.ipa)).join('  &  ')}</h2><p>{c.label}</p></header>
      {c.scopeNote && <p className="pr-contrast-scope"><b>What this comparison covers</b>{c.scopeNote}</p>}
      <p className="pr-depth" data-depth={c.depth.meetsMinimum && c.depth.hasMinimumContext ? 'minimum-met' : 'needs-depth'}><b>{depthLabel(c)}.</b> Aim for five distinct words in each sound category; four is the minimum. {c.depth.hasMinimumContext ? 'At least one context group also has four different words and intended pronunciations per category.' : 'The words still need a compatible context group with four per category.'} Word count alone does not validate a lesson.</p>
      <p className="pr-pool-instruction">Two word pools. Each word belongs to the sound above it; rows across the columns are not fixed pairs.</p>
      <div className="pr-pools">{c.pools.map((pool, side) => <section className={`pr-pool side-${side}`} key={side} aria-label={`Words with ${c.categories[side].ipa}`}><header><h3>{displayIpa(c.categories[side].ipa)}</h3><span>{c.depth.distinctWords[side]} words{c.depth.distinctPronunciations[side] < c.depth.distinctWords[side] ? ` · ${c.depth.distinctPronunciations[side]} IPA forms` : ''}</span></header><ul>{pool.map(wordRow)}</ul></section>)}</div>
      <section className="pr-decision"><div><h3>Does this contrast and its word grouping look right?</h3><p>{flags ? `${flags} words are flagged. Resolve those before marking the whole contrast correct.` : 'Check the sound categories, word choices and IPA. Add missing words below.'}</p></div>
        <select aria-label="Review this contrast" disabled={!ready} value={status('groupReviews', c.key)} onChange={e => edit('groupReviews', c.key, { status: e.target.value as AudioReviewStatus })}>{Object.entries(names).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <textarea aria-label="Contrast corrections or missing words" rows={2} maxLength={2000} placeholder="Corrections, missing words, a different dialect…" disabled={!ready} value={reviews.groupReviews[c.key]?.note || ''} onChange={e => edit('groupReviews', c.key, { note: e.target.value })} />
        {reviews.groupReviews[c.key]?.note && <p className="pr-print-note">Your contrast note: {reviews.groupReviews[c.key].note}</p>}
        <div className="pr-next"><span>Notes save in this browser. Export a backup to share them.</span><button disabled={visible.indexOf(c) === visible.length - 1} onClick={() => choose(visible[visible.indexOf(c) + 1].id)}>Next contrast →</button></div>
      </section>
      <details className="pr-details"><summary>Research, dialect notes & grouping</summary><p><b>{evidenceNames[c.evidenceLevel]}.</b> {c.rationale}</p>{c.learnerL1s.length > 0 && <p>Learner backgrounds considered: {c.learnerL1s.join(', ')}.</p>}
        <ul>{[...c.contextNotes, ...c.reviewNotes].map((note, i) => <li key={i}>{note}</li>)}</ul>
        <p>Groups keep comparable target positions and contexts together. Having enough words does not by itself validate every combination.</p>
        <ul>{c.contextGroups.map(group => <li key={group.id}>{group.id}: {group.counts.join(' / ')} distinct words · {group.distinctPronunciations.join(' / ')} intended pronunciations · {group.positions.join(', ')} · {group.meetsTargetDepth ? 'five-word depth target met' : group.meetsMinimumDepth ? 'four-word minimum met' : 'needs more words or grouping review'}</li>)}</ul>
        {references(c.sourceIds)}
      </details>
      <details className="pr-details"><summary>Minimal-pair links for the separate word game ({c.minimalPairs.length})</summary><p>These are proposed word-to-word links. The two sound pools above are the primary review unit. Each link still needs linguistic review.</p><div className="pr-pair-links">{c.minimalPairs.map((pair, i) => <span key={i}>{library.words[pair.leftWordId].text} — {library.words[pair.rightWordId].text}</span>)}</div></details>
    </article>;
  }
  return <div className="pr-desk"><header className="pr-header"><Brand /><span>LIBRARY REVIEW</span><a href="/word-review-previous">Earlier review & notes ↗</a></header><main>
    <section className="pr-intro"><div><p className="pr-eyebrow">01 WORDS → 02 VOICES → 03 TRAINING</p><h1>Get the sounds <em>right.</em></h1><p>Choose a contrast. Check the two word pools. We’ll review every word in every voice after the text is settled.</p></div><div className="pr-tools"><button disabled={!ready} onClick={exportReview}>Export review</button><details><summary>Downloads & backup</summary><button onClick={exportWords}>All word lists (CSV)</button><a href="/data/phoneme-library.json" download="minimalpairs-phoneme-library.json">Full research database (JSON)</a>{library.release && <a href={`/data/${library.release.id}.json`} download={`${library.release.id}.json`}>Frozen {library.release.label} (JSON)</a>}<button disabled={!ready} onClick={() => fileInput.current?.click()}>Import review</button><button onClick={() => window.print()}>Print this view</button></details><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => void importReview(e.target.files?.[0])} /></div></section>
    <p className="pr-scope"><b>{library.counts.contrasts} draft contrasts · {library.counts.uniqueWords} distinct word entries · {library.languages.length} languages · {library.banks.length} pronunciation banks.</b> Research sources and remaining gaps are recorded. These lists are for review, not a claim of complete or validated coverage.</p>
    {error && <p role="alert" className="pr-notice">{error}</p>}{notice && <p role="status" className="pr-notice">{notice}</p>}
    {library.release && <p className="pr-release"><b>{library.release.label} · scope settled.</b> Versioned word inventory. Corrections remain welcome; this text release does not approve any recordings. <a href="/voice-audition">Open the voice audition →</a></p>}
    <nav className="pr-language-nav" aria-label="Pronunciation bank">{library.banks.map(bank => <button key={bank.id} aria-pressed={bank.id === bankId} onClick={() => chooseBank(bank.id)}>{bank.name}<span>{library.contrasts.filter(c => bankIdFor(c) === bank.id).length}</span></button>)}</nav>
    {(language === 'en' || language === 'ja') && <p className="pr-bank-reference"><b>{currentBank.reference}.</b> {language === 'en' ? 'This is a separate word and voice bank. British English here means the Southern British reference, not every UK accent.' : 'Japanese readings and intended sounds are visible here for review. They will stay hidden during audio-only trials.'}</p>}
    {language === 'zh' && library.mandarinBalance && <section className="pr-tone-balance" aria-label="Mandarin tone balance">
      <h2>Same syllables. Different tones.</h2>
      <p><b>{library.mandarinBalance.lexicalItems.filter(w => w.split === 'train').length} tone words</b> across all six tone comparisons. Each comparison uses the same syllables on both sides, once per tone. The training sampler must keep those syllables equally frequent.</p>
      <p><b>{library.mandarinBalance.lexicalItems.filter(w => w.split === 'heldout').length} additional words are reserved for progress checks.</b> Their syllables are excluded from every training pool. These are isolated citation tones; connected-speech tone changes need a separate reviewed collection.</p>
      <details><summary>See the reserved assessment words</summary><p>For owner review only. These words must stay out of lessons and voice auditions.</p><div className="pr-pair-links">{library.mandarinBalance.lexicalItems.filter(w => w.split === 'heldout').map(w => <span key={w.id}><b lang="zh-CN">{w.text}</b> · {w.romanization} · {w.ipa} · {w.meaning}</span>)}</div></details>
    </section>}
    <div className="pr-workspace"><aside className="pr-sidebar"><label>Find a sound or word<input aria-label="Find a sound or word" type="search" placeholder="IPA, word or meaning…" value={query} onChange={e => setQuery(e.target.value)} /></label><button className="pr-overview-button" aria-pressed={overview} onClick={() => setOverview(!overview)}>{overview ? 'Back to word pools' : `All ${currentBank.name} contrasts`}</button>
      <p className="pr-sidebar-count">{visible.length} contrasts · {bankContrasts.filter(c => status('groupReviews', c.key) === 'pass').length} marked correct</p>
      <nav aria-label="Sound contrasts" className="pr-contrast-nav">{visible.map(c => <button key={c.id} aria-current={!overview && contrast?.id === c.id ? 'true' : undefined} onClick={() => choose(c.id)}><span>{c.categories.map(category => displayIpa(category.ipa)).join(' — ')}</span><small>{c.depth.distinctWords.join(' + ')} words{status('groupReviews', c.key) !== 'unreviewed' ? ` · ${names[status('groupReviews', c.key)]}` : ''}</small></button>)}</nav>
      <label className="pr-mobile-contrast">Sound contrast<select aria-label="Sound contrast" value={contrast?.id || ''} onChange={e => choose(e.target.value)}>{visible.map(c => <option key={c.id} value={c.id}>{c.categories.map(category => displayIpa(category.ipa)).join(' — ')} · {c.label}</option>)}</select></label>
    </aside><div className="pr-content">{!visible.length ? <p className="pr-empty">No matching contrast in {currentBank.name}. <button onClick={() => setQuery('')}>Clear search</button></p> : overview ? <section className="pr-overview"><h2>{currentBank.name}: the contrast map</h2><p>Open a sound contrast to review its two word pools.</p><div className="pr-table-wrap"><table><thead><tr><th>Sound contrast</th><th>Words per pool</th><th>Depth</th><th>Evidence</th><th>Your review</th></tr></thead><tbody>{visible.map(c => <tr key={c.id}><td><button onClick={() => choose(c.id)}>{c.categories.map(category => displayIpa(category.ipa)).join(' — ')}</button><small>{c.dialect}</small></td><td>{c.depth.distinctWords.join(' / ')}</td><td>{depthLabel(c)}</td><td>{evidenceNames[c.evidenceLevel]}</td><td>{names[status('groupReviews', c.key)]}</td></tr>)}</tbody></table></div></section> : contrast && detail(contrast)}</div></div>
    <details className="pr-details pr-method"><summary>How these pools become audio-only training</summary><p>Select two sound categories. A and B demonstrate the categories using words from their pools; X uses another word from one of those categories. The learner matches the sound category. Spelling and IPA stay hidden in the learner’s trial until an optional reveal.</p><p>Voices and answer order must vary independently. A, B and X must never be matched by an identical recording, and X must not repeat a reference word or its intended pronunciation. Homophones with different spellings do not add a new listening example. Context groups keep target position and pronunciation conditions explicit. This database contains no recordings and generates none.</p>
      <ul><li><b>ABX discrimination:</b> hear A, B and X; decide whether X belongs with A or B. This is the primary product task.</li><li><b>Identification:</b> hear one item; assign it to a named category or word. This is a separate task.</li><li><b>High variability:</b> practice across words, contexts and speakers. This describes the material, and can be used with either task.</li></ul>
      <p>Both tasks have research support. Classic identification studies used varied words and speakers. Later discrimination training included cross-word odd-one-out judgments and improved learning too; identification did better on one early test. This does not establish which task is best for our product. <a href="https://pubmed.ncbi.nlm.nih.gov/8408964/" target="_blank" rel="noreferrer">Lively et al. (1993)</a> · <a href="https://y.shinohara.w.waseda.jp/assets/files/Shinohara_and_Iverson_2018.pdf" target="_blank" rel="noreferrer">Shinohara & Iverson (2018), §2.3.1</a></p>
      <p>Categorical ABX is also an established way to assess perception across speakers. Our combination of a different word for X and independently varied voices needs its own learning and transfer checks; these studies do not establish that it is universally superior. <a href="https://ebooks.au.dk/aul/catalog/download/322/218/985?inline=1" target="_blank" rel="noreferrer">Mora & Mora-Plaza (2019), §2.4.1</a></p></details>
    <details className="pr-details"><summary>Research coverage & remaining gaps</summary><p>A documented study word means its spelling or form appears in the cited study material. It does not mean our IPA, selected dialect, commercial audio rights or training algorithm were validated by that study. Other words are separately curated proposals. Studies for one learner background do not establish the same difficulty for all learners.</p>{library.research.filter(pack => pack.languageIds.includes(language)).map((pack, i) => <div key={i}><h3>{pack.languageIds.map(id => library.languages.find(l => l.id === id)?.name).join(' · ')}</h3><ul>{pack.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul><details><summary>Search record ({pack.searchLog.length})</summary>{pack.searchLog.map((entry, index) => <p key={index}><b>{entry.query}</b><br />{entry.outcome}</p>)}</details></div>)}</details>
    {language === 'ja' && <p className="pr-attribution">Japanese vocabulary uses the <a href="https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project" target="_blank" rel="noreferrer">JMdict project</a>, copyright Jim Breen and the Electronic Dictionary Research and Development Group. The adapted Japanese vocabulary list is shared under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>; readings and meanings were selected and shortened, and IPA/context annotations are our additions. <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">Source and licence details</a>.</p>}
    <footer>Text review only · {library.release?.label || 'Draft'} · {library.fingerprint.slice(0, 12)} · Saved checks do not change live training or approve audio generation.</footer>
  </main></div>;
}

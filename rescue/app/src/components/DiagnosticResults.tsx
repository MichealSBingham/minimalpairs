import type { Language } from '../lib/types';
import { diagnosticResultText } from '../lib/diagnostic-result-i18n';
import { Icon } from './ui';
import './diagnostic-results.css';

export type DiagnosticAttempt = { contrastId: string; pairId: string; word: string; chosenWord: string; correct: boolean };
export default function DiagnosticResults({language, attempts, locale = 'en', fullAccess, onPractice}: {language: Language; attempts: DiagnosticAttempt[]; locale?: string; fullAccess: boolean; onPractice: (contrastId: string) => void}) {
  const t = (index: number) => diagnosticResultText(locale, index);
  const groups = language.contrasts.map((contrast, index) => {
    const results = attempts.filter(item => item.contrastId === contrast.id);
    const correct = results.filter(item => item.correct).length;
    return {contrast, index, results, correct, ratio: results.length ? correct/results.length : 0, free: index < 3};
  }).filter(group => group.results.length).sort((a,b) => a.ratio-b.ratio || a.index-b.index);
  const suggested = fullAccess ? groups[0] : groups.find(group => group.free);
  const weakest = groups[0];
  const label = (phonemes: string[]) => phonemes.map(p => p.startsWith('/') ? p : `/${p}/`).join(' – ');
  if (!groups.length) return null;
  return <section className="diagnostic-results" aria-label={t(0)}>
    <header><span className="eyebrow">{t(0)}</span><h3>{attempts.filter(a=>a.correct).length} / {attempts.length}</h3><span>{t(11)}</span><p>{t(1)}</p></header>
    {suggested && <div className="diagnostic-next"><div><span className="eyebrow">{t(fullAccess ? 2 : 3)}</span><strong>{label(suggested.contrast.phonemes)}</strong></div><button className="button button-dark" onClick={()=>onPractice(suggested.contrast.id)}>{t(5)}<Icon name="arrow" size={16}/></button></div>}
    {weakest && suggested?.contrast.id !== weakest.contrast.id && <p className="diagnostic-focus">{t(4)}: <strong>{label(weakest.contrast.phonemes)}</strong></p>}
    <div className="diagnostic-sound-groups"><h4>{t(13)} · {groups.length}</h4>{groups.map(group => {
      const missed = group.results.find(item => !item.correct);
      const pair = missed && group.contrast.pairs.find(pair => pair.id === missed.pairId);
      const matchingReference = pair && pair.words.find(word => word.text !== missed?.chosenWord)?.text;
      return <article className="diagnostic-sound-row" key={group.contrast.id}>
        <div className="diagnostic-row-top"><strong>{label(group.contrast.phonemes)}</strong><span>{group.correct} / {group.results.length}</span></div>
        <div className="diagnostic-bar" role="img" aria-label={`${label(group.contrast.phonemes)}: ${group.correct}/${group.results.length}`}><span style={{width:`${group.ratio*100}%`}}/></div>
        <div className="diagnostic-row-actions">{missed ? <details><summary>{t(14)}</summary><dl><dt>{t(8)}</dt><dd lang={language.locale}>{missed.word}</dd>{matchingReference && <><dt>{t(9)}</dt><dd lang={language.locale}>{matchingReference}</dd></>}<dt>{t(10)}</dt><dd lang={language.locale}>{missed.chosenWord}</dd></dl></details> : <span className="diagnostic-no-misses">{t(12)}</span>}<button className="text-button" onClick={()=>onPractice(group.contrast.id)}>{!fullAccess && !group.free && <Icon name="lock" size={14}/>} {t(fullAccess || group.free ? 5 : 6)} <span aria-hidden="true">→</span></button></div>
      </article>;
    })}</div>
  </section>;
}

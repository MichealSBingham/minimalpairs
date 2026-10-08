import type {Language,PracticeSession} from './ui';
import {diagnosticHistory} from '../lib/diagnostic-history';
import {diagnosticShortCopy} from '../lib/diagnostic-short-copy';
import './diagnostic-results.css';
export default function DiagnosticHistory({language,sessions,locale='en'}:{language:Language;sessions:PracticeSession[];locale?:string}){
 const history=diagnosticHistory(sessions,language.id),copy=diagnosticShortCopy(locale);
 return <section className="diagnostic-history" id="diagnostic-history"><h3>{copy.previousResults}</h3>{!history.length?<p>{copy.historyEmpty}</p>:history.map(run=><details key={run.date}><summary>{new Date(run.date).toLocaleDateString(locale)} · {run.correct} / {run.total}</summary><div className="diagnostic-sound-groups">{run.rows.map(row=>{const contrast=language.contrasts.find(c=>c.id===row.contrastId);return <article className="diagnostic-sound-row" key={row.id}><div className="diagnostic-row-top"><strong>{contrast?.phonemes.map(p=>`/${p}/`).join(' – ')||row.contrastId}</strong><span>{row.correct} / {row.total}</span></div><div className="diagnostic-bar" role="img" aria-label={`${row.correct}/${row.total}`}><span style={{width:`${row.correct/row.total*100}%`}}/></div>{row.mistakes.length>0&&<p lang={language.locale}>{row.mistakes.map(m=>m.word).filter(Boolean).join(' · ')}</p>}</article>})}</div></details>)}</section>;
}

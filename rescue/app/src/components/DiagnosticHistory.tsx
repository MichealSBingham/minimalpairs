import {NEXT_STEP_EXPERIMENT,NEXT_STEP_KEY} from '../lib/diagnostic-next-step.mjs';
import {diagnosticOfferCopy,DIAGNOSTIC_EXPERIMENT} from '../lib/diagnostic-experiment';
import {trackMeasurement} from '../lib/measurement';
import {saveDiagnosticReturn} from '../lib/diagnostic-return';
import {useEffect,useState} from 'react';
import DiagnosticReportGate from './DiagnosticReportGate';
import {diagnosticLengthCopy} from '../lib/diagnostic-length';
import type {Language,PracticeSession} from './ui';
import {diagnosticHistory} from '../lib/diagnostic-history';
import {diagnosticShortCopy} from '../lib/diagnostic-short-copy';
import {diagnosticReportCopy} from '../lib/diagnostic-report-copy';
import {diagnosticAttemptWords,diagnosticExamplePair,diagnosticPhonemeLabel} from '../lib/diagnostic-report';
import './diagnostic-results.css';
export default function DiagnosticHistory({language,sessions,locale='en',fullAccess=false}:{language:Language;sessions:PracticeSession[];locale?:string;fullAccess?:boolean}){
 const [selected,setSelected]=useState('');
 const [nextStep,setNextStep]=useState<string|null>(null);
 useEffect(()=>{try{const arm=localStorage.getItem(NEXT_STEP_KEY);if(arm==='control'||arm==='personalized')setNextStep(arm);}catch{}},[]);
 useEffect(()=>{setSelected(new URLSearchParams(location.search).get('report')||'');},[]);
 const history=diagnosticHistory(sessions,language.id),copy=diagnosticShortCopy(locale),report=diagnosticReportCopy(locale);
 return <section className="diagnostic-history" id="diagnostic-history"><h3>{copy.previousResults}</h3>{!history.length?<p>{copy.historyEmpty}</p>:history.map(run=><details key={run.date} open={selected===run.date} onToggle={e=>{if(e.currentTarget.open){saveDiagnosticReturn(localStorage,language.id,run.date);if(fullAccess)trackMeasurement('diagnostic_report_open',{language_id:language.id,surface:'diagnostic',ui_locale:locale,access_tier:'paid'});}}}><summary>{new Date(run.date).toLocaleDateString(locale)} · {!fullAccess&&run.rows[0]?.diagnosticExperimentVariant==='paid'?diagnosticOfferCopy(locale).ready:`${run.correct} / ${run.total}`} · {run.rows.every(r=>r.diagnosticLength==='short')?diagnosticLengthCopy(locale,run.total).short:run.rows.every(r=>r.diagnosticLength==='full')?diagnosticLengthCopy(locale,run.total).full:diagnosticLengthCopy(locale,run.total).legacy}</summary><div className="diagnostic-sound-groups">{(fullAccess?run.rows:run.rows[0]?.diagnosticExperimentVariant==='paid'?[]:run.rows.filter(r=>r.mistakes.length).slice(0,1)).map(row=>{
 const contrast=language.contrasts.find(c=>c.id===row.contrastId);
 return <article className="diagnostic-sound-row" key={row.id}><div className="diagnostic-row-top"><div><strong lang={language.locale}>{contrast?diagnosticExamplePair(contrast)?.words.map(w=>w.text).join(' / '):row.contrastId}</strong><span className="diagnostic-secondary-ipa ipa-text">{contrast&&diagnosticPhonemeLabel(contrast.phonemes)}</span></div><span>{row.correct} / {row.total}</span></div><div className="diagnostic-bar" role="img" aria-label={`${row.correct}/${row.total}`}><span style={{width:`${row.correct/row.total*100}%`}}/></div>{contrast&&row.mistakes.slice(0,fullAccess?undefined:1).map((mistake,i)=>{
 const words=diagnosticAttemptWords({...mistake,contrastId:row.contrastId,correct:false},contrast);
 return <div className="diagnostic-mistake" key={i}><dl>{[{label:report.heard,word:words.heard,kind:'heard'},{label:report.chosen,word:words.chosen,kind:'chosen'},{label:report.correctMatch,word:words.correct,kind:'correct'}].map(cell=><div className={`diagnostic-word-cell ${cell.kind}`} key={cell.kind}><dt>{cell.label}</dt><dd><strong lang={language.locale}>{cell.word?.text||'—'}</strong>{cell.word?.ipa&&<span className="ipa-text">{cell.word.ipa}</span>}</dd></div>)}</dl></div>;
 })}</article>;
 })}</div>{!fullAccess&&<DiagnosticReportGate locale={locale} languageId={language.id} offerContext={run.rows[0]?.diagnosticExperimentVariant?{experiment_id:nextStep&&run.rows[0].diagnosticExperimentVariant==='preview'?NEXT_STEP_EXPERIMENT:DIAGNOSTIC_EXPERIMENT,experiment_variant:nextStep&&run.rows[0].diagnosticExperimentVariant==='preview'?nextStep:run.rows[0].diagnosticExperimentVariant,offer_placement:'diagnostic-report',language_id:language.id,diagnostic_length:run.rows[0].diagnosticLength}:undefined} recommendation={nextStep==='personalized'&&run.rows[0]?.diagnosticExperimentVariant==='preview'?(()=>{const row=run.rows.filter(r=>r.mistakes.length).sort((a,b)=>a.correct/a.total-b.correct/b.total)[0];const c=language.contrasts.find(c=>c.id===row?.contrastId);return c?{words:diagnosticExamplePair(c,row?.mistakes[0]?.pairId)?.words.map(w=>w.text).join(' / ')||c.label,ipa:diagnosticPhonemeLabel(c.phonemes)}:undefined;})():undefined}/>}</details>)}</section>;
}

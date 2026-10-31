import {NEXT_STEP_EXPERIMENT,nextStepAssignment,nextStepFocus} from '../lib/diagnostic-next-step.mjs';
import DiagnosticPreview from './DiagnosticPreview';
import {diagnosticOfferCopy,DIAGNOSTIC_EXPERIMENT,type DiagnosticVariant} from '../lib/diagnostic-experiment';
import ChallengeShare from './ChallengeShare';
import DiagnosticReportGate from './DiagnosticReportGate';
import {useId,useEffect,useState} from 'react';
import {trackMeasurement} from '../lib/measurement';
import type {Language} from '../lib/types';
import {diagnosticResultText} from '../lib/diagnostic-result-i18n';
import {diagnosticReportCopy} from '../lib/diagnostic-report-copy';
import {diagnosticAttemptWords,diagnosticExamplePair,diagnosticPhonemeLabel,type DiagnosticAttempt} from '../lib/diagnostic-report';
import {Icon} from './ui';
import {diagnosticInsightCopy} from '../lib/diagnostic-insight-copy';
import './diagnostic-results.css';
export type {DiagnosticAttempt} from '../lib/diagnostic-report';

export default function DiagnosticResults({language,attempts,locale='en',fullAccess,onPractice,diagnosticLength,variant,attemptId}:{variant?:DiagnosticVariant;attemptId?:string;diagnosticLength?:'short'|'full';language:Language;attempts:DiagnosticAttempt[];locale?:string;fullAccess:boolean;onPractice:(contrastId:string)=>void}) {
  const reportId=useId();
  const [nextStep,setNextStep]=useState<string|null>(null);
  useEffect(()=>{if(!fullAccess&&variant==='preview')setNextStep(nextStepAssignment(window.localStorage));},[fullAccess,variant]);
  useEffect(()=>{if(nextStep&&!fullAccess)trackMeasurement('experiment_exposure',{experiment_id:NEXT_STEP_EXPERIMENT,experiment_variant:nextStep,offer_placement:'diagnostic-report',attempt_id:attemptId,language_id:language.id,diagnostic_length:diagnosticLength,surface:'diagnostic',ui_locale:locale});},[nextStep,fullAccess,attemptId,language.id,diagnosticLength,locale]);
  const offerCopy=diagnosticOfferCopy(locale);
  const experimental=Boolean(variant);
  const offerContext={...(nextStep?{experiment_id:NEXT_STEP_EXPERIMENT,experiment_variant:nextStep}:variant?{experiment_id:DIAGNOSTIC_EXPERIMENT,experiment_variant:variant}:{}),offer_placement:'diagnostic-report',attempt_id:attemptId,language_id:language.id,diagnostic_length:diagnosticLength};
  useEffect(()=>{if(fullAccess)trackMeasurement('diagnostic_report_open',{language_id:language.id,surface:'diagnostic',ui_locale:locale,access_tier:'paid',diagnostic_length:diagnosticLength});},[fullAccess,language.id,locale,diagnosticLength]);
  const t=(index:number)=>diagnosticResultText(locale,index),copy=diagnosticReportCopy(locale);
  const groups=language.contrasts.map((contrast,index)=>{
    const results=attempts.filter(item=>item.contrastId===contrast.id),correct=results.filter(item=>item.correct).length;
    return {contrast,index,results,correct,ratio:results.length?correct/results.length:0,free:index<3};
  }).filter(group=>group.results.length).sort((a,b)=>a.ratio-b.ratio||a.index-b.index);
  if(!groups.length)return null;
  const suggested=fullAccess?groups[0]:groups.find(group=>group.free),weakest=groups[0];
  const nextFocus=nextStepFocus(groups);
  const detailGroups=fullAccess?groups:groups.filter(g=>g.results.some(r=>!r.correct)).slice(0,1);
  const total=attempts.length,correct=attempts.filter(a=>a.correct).length,percent=Math.round(correct/total*100);
  const focusCount=groups.filter(group=>group.correct<group.results.length).length;
  const insight=diagnosticInsightCopy(locale,{solid:groups.length-focusCount,groups:groups.length,focus:focusCount});
  const wordLabel=(contrast:Language['contrasts'][number],pairId?:string)=>diagnosticExamplePair(contrast,pairId)?.words.map(word=>word.text.normalize('NFC')).join(' / ')||contrast.label;
  if(variant==='paid'&&!fullAccess)return <section className="diagnostic-results"><h3>{offerCopy.ready}</h3><p>{offerCopy.neutralBody}</p><DiagnosticReportGate language={language} locale={locale} languageId={language.id} diagnosticLength={diagnosticLength} offerContext={offerContext}/></section>;
  return <section className="diagnostic-results" aria-label={t(0)}>
    <header className="diagnostic-report-header">
      <div className="diagnostic-donut" role="img" aria-label={`${correct} / ${total} ${copy.matches}`} style={{background:`conic-gradient(#537361 ${percent}%, #e7e1d5 0)`}}><div><strong>{correct}<span>/{total}</span></strong><span>{percent}%</span></div></div>
      <div><span className="eyebrow">{copy.matches}</span><h3>{t(0)}</h3><p>{experimental&&!fullAccess?(percent===100?insight.perfect:offerCopy.neutralBody):<>{insight.summary} {focusCount?insight.focus:insight.perfect}</>}</p></div>
    </header>
    {!fullAccess&&!experimental&&<div className="diagnostic-conversion"><div><strong>{insight.offerTitle}</strong><span lang={language.locale}>{groups.slice(0,2).map(g=>`${wordLabel(g.contrast)} · ${diagnosticPhonemeLabel(g.contrast.phonemes)}`).join(' / ')}</span></div><a className="button button-dark" href={`#${reportId}-plans`} onClick={()=>trackMeasurement('diagnostic_offer_click',{language_id:language.id,surface:'diagnostic',ui_locale:locale,diagnostic_length:diagnosticLength})}>{insight.offerAction}<Icon name="arrow" size={16}/></a></div>}
    {suggested&&(fullAccess||!experimental)&&<div className="diagnostic-next"><div><span className="eyebrow">{t(fullAccess?2:3)}</span><strong lang={language.locale}>{wordLabel(suggested.contrast)}</strong><span className="diagnostic-secondary-ipa ipa-text">{diagnosticPhonemeLabel(suggested.contrast.phonemes)}</span></div><button className="button button-dark" onClick={()=>onPractice(suggested.contrast.id)}>{t(5)}<Icon name="arrow" size={16}/></button></div>}
    {weakest&&(fullAccess||!experimental)&&suggested?.contrast.id!==weakest.contrast.id&&<p className="diagnostic-focus">{t(4)}: <strong lang={language.locale}>{wordLabel(weakest.contrast)}</strong></p>}
    {(fullAccess||!experimental)&&<section className="diagnostic-overview" aria-label={t(13)}><h4>{t(13)} <span>{groups.length}</span></h4><nav aria-label={t(13)}>{groups.map(group=><a key={group.contrast.id} href={fullAccess?`#${reportId}-${group.contrast.id}`:undefined}><span className="diagnostic-overview-label"><span className="diagnostic-overview-words" lang={language.locale}>{wordLabel(group.contrast,group.results.find(item=>!item.correct)?.pairId)}</span><span className="diagnostic-secondary-ipa ipa-text">{diagnosticPhonemeLabel(group.contrast.phonemes)}</span></span><span className="diagnostic-overview-bar" aria-hidden="true"><span style={{width:`${group.ratio*100}%`}}/></span><span className="diagnostic-overview-count">{group.correct}/{group.results.length}<span className="diagnostic-report-sr"> {copy.matches}</span></span></a>)}</nav></section>}
    {(fullAccess||!experimental)&&<p className="diagnostic-reading-guide">{insight.readingGuide}</p>}
    <div className="diagnostic-sound-groups">{detailGroups.map(group=>{
      const missed=group.results.filter(item=>!item.correct).slice(0,fullAccess?undefined:1);
      return <article className="diagnostic-sound-row" id={`${reportId}-${group.contrast.id}`} key={group.contrast.id}>
        <div className="diagnostic-row-top"><div><strong lang={language.locale}>{wordLabel(group.contrast,missed[0]?.pairId)}</strong><span className="diagnostic-secondary-ipa ipa-text">{diagnosticPhonemeLabel(group.contrast.phonemes)}</span><span className={`diagnostic-group-status ${missed.length?'needs-practice':'matched'}`}>{missed.length?insight.needsPractice:insight.allMatched}</span></div><span className="diagnostic-group-score"><strong>{group.correct}<small>/{group.results.length}</small></strong><span>{copy.correct}</span></span></div>
        {missed.length>0?<div className="diagnostic-mistakes"><h5>{copy.missed} <span>{missed.length}</span></h5>{missed.map((attempt,index)=>{
          const words=diagnosticAttemptWords(attempt,group.contrast);
          return <div className="diagnostic-mistake" key={`${attempt.pairId}-${index}`}><span className="diagnostic-example-number">{copy.example} {index+1}</span><dl>{([{label:copy.heard,word:words.heard,kind:'heard'},{label:copy.chosen,word:words.chosen,kind:'chosen'},{label:copy.correctMatch,word:words.correct,kind:'correct'}] as const).map(cell=><div className={`diagnostic-word-cell ${cell.kind}`} key={cell.kind}><dt>{cell.label}</dt><dd><strong lang={language.locale}>{cell.word?.text||'—'}</strong>{cell.word?.ipa&&<span className="ipa-text">{cell.word.ipa}</span>}</dd></div>)}</dl></div>;
        })}</div>:<p className="diagnostic-no-misses">{t(12)}</p>}
        <div className="diagnostic-row-actions"><button className="text-button" onClick={()=>onPractice(group.contrast.id)}>{!fullAccess&&!group.free&&<Icon name="lock" size={14}/>} {t(fullAccess||group.free?5:6)} <span aria-hidden="true">→</span></button></div>
      </article>;
    })}</div>
    {!fullAccess&&<DiagnosticReportGate language={language} id={`${reportId}-plans`} locale={locale} languageId={language.id} diagnosticLength={diagnosticLength} offerContext={offerContext} recommendation={nextStep==='personalized'&&nextFocus?{words:wordLabel(nextFocus.contrast,nextFocus.results.find((r:DiagnosticAttempt)=>!r.correct)?.pairId),ipa:diagnosticPhonemeLabel(nextFocus.contrast.phonemes)}:undefined}/>}
    <ChallengeShare languageId={language.id} locale={locale}/>
  </section>;
}

import {useId} from 'react';
import type {Language} from '../lib/types';
import {diagnosticResultText} from '../lib/diagnostic-result-i18n';
import {diagnosticReportCopy} from '../lib/diagnostic-report-copy';
import {diagnosticAttemptWords,diagnosticExamplePair,diagnosticPhonemeLabel,type DiagnosticAttempt} from '../lib/diagnostic-report';
import {Icon} from './ui';
import './diagnostic-results.css';
export type {DiagnosticAttempt} from '../lib/diagnostic-report';

export default function DiagnosticResults({language,attempts,locale='en',fullAccess,onPractice}:{language:Language;attempts:DiagnosticAttempt[];locale?:string;fullAccess:boolean;onPractice:(contrastId:string)=>void}) {
  const reportId=useId();
  const t=(index:number)=>diagnosticResultText(locale,index),copy=diagnosticReportCopy(locale);
  const groups=language.contrasts.map((contrast,index)=>{
    const results=attempts.filter(item=>item.contrastId===contrast.id),correct=results.filter(item=>item.correct).length;
    return {contrast,index,results,correct,ratio:results.length?correct/results.length:0,free:index<3};
  }).filter(group=>group.results.length).sort((a,b)=>a.ratio-b.ratio||a.index-b.index);
  if(!groups.length)return null;
  const suggested=fullAccess?groups[0]:groups.find(group=>group.free),weakest=groups[0];
  const total=attempts.length,correct=attempts.filter(a=>a.correct).length,percent=Math.round(correct/total*100);
  const wordLabel=(contrast:Language['contrasts'][number],pairId?:string)=>diagnosticExamplePair(contrast,pairId)?.words.map(word=>word.text.normalize('NFC')).join(' / ')||contrast.label;
  return <section className="diagnostic-results" aria-label={t(0)}>
    <header className="diagnostic-report-header">
      <div className="diagnostic-donut" role="img" aria-label={`${correct} / ${total} ${copy.matches}`} style={{background:`conic-gradient(#537361 ${percent}%, #e7e1d5 0)`}}><div><strong>{correct}<span>/{total}</span></strong><span>{percent}%</span></div></div>
      <div><span className="eyebrow">{copy.matches}</span><h3>{t(0)}</h3><p>{t(1)}</p></div>
    </header>
    {suggested&&<div className="diagnostic-next"><div><span className="eyebrow">{t(fullAccess?2:3)}</span><strong lang={language.locale}>{wordLabel(suggested.contrast)}</strong><span className="diagnostic-secondary-ipa ipa-text">{diagnosticPhonemeLabel(suggested.contrast.phonemes)}</span></div><button className="button button-dark" onClick={()=>onPractice(suggested.contrast.id)}>{t(5)}<Icon name="arrow" size={16}/></button></div>}
    {weakest&&suggested?.contrast.id!==weakest.contrast.id&&<p className="diagnostic-focus">{t(4)}: <strong lang={language.locale}>{wordLabel(weakest.contrast)}</strong></p>}
    <section className="diagnostic-overview" aria-label={t(13)}><h4>{t(13)} <span>{groups.length}</span></h4><nav aria-label={t(13)}>{groups.map(group=><a key={group.contrast.id} href={`#${reportId}-${group.contrast.id}`}><span className="diagnostic-overview-words" lang={language.locale}>{wordLabel(group.contrast,group.results.find(item=>!item.correct)?.pairId)}</span><span className="diagnostic-overview-bar" aria-hidden="true"><span style={{width:`${group.ratio*100}%`}}/></span><span className="diagnostic-overview-count">{group.correct}/{group.results.length}<span className="diagnostic-report-sr"> {copy.matches}</span></span></a>)}</nav></section>
    <div className="diagnostic-sound-groups">{groups.map(group=>{
      const missed=group.results.filter(item=>!item.correct);
      return <article className="diagnostic-sound-row" id={`${reportId}-${group.contrast.id}`} key={group.contrast.id}>
        <div className="diagnostic-row-top"><div><strong lang={language.locale}>{wordLabel(group.contrast,missed[0]?.pairId)}</strong><span className="diagnostic-secondary-ipa ipa-text">{diagnosticPhonemeLabel(group.contrast.phonemes)}</span></div><span className="diagnostic-group-score"><strong>{group.correct}<small>/{group.results.length}</small></strong><span>{copy.correct}</span></span></div>
        {missed.length>0?<div className="diagnostic-mistakes"><h5>{copy.missed} <span>{missed.length}</span></h5>{missed.map((attempt,index)=>{
          const words=diagnosticAttemptWords(attempt,group.contrast);
          return <div className="diagnostic-mistake" key={`${attempt.pairId}-${index}`}><span className="diagnostic-example-number">{copy.example} {index+1}</span><dl>{([{label:copy.heard,word:words.heard,kind:'heard'},{label:copy.chosen,word:words.chosen,kind:'chosen'},{label:copy.correctMatch,word:words.correct,kind:'correct'}] as const).map(cell=><div className={`diagnostic-word-cell ${cell.kind}`} key={cell.kind}><dt>{cell.label}</dt><dd><strong lang={language.locale}>{cell.word?.text||'—'}</strong>{cell.word?.ipa&&<span className="ipa-text">{cell.word.ipa}</span>}</dd></div>)}</dl></div>;
        })}</div>:<p className="diagnostic-no-misses">{t(12)}</p>}
        <div className="diagnostic-row-actions"><button className="text-button" onClick={()=>onPractice(group.contrast.id)}>{!fullAccess&&!group.free&&<Icon name="lock" size={14}/>} {t(fullAccess||group.free?5:6)} <span aria-hidden="true">→</span></button></div>
      </article>;
    })}</div>
  </section>;
}

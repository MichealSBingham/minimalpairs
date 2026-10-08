import type {Language} from '../lib/types';
import type {Locale} from '../lib/locales';
import {selectDiagnosticContrasts} from '../lib/diagnostic-plan';
import {diagnosticShortCopy} from '../lib/diagnostic-short-copy';
import {diagnosticReportCopy} from '../lib/diagnostic-report-copy';
import {diagnosticExamplePair,diagnosticPhonemeLabel} from '../lib/diagnostic-report';
import './DiagnosticPreview.css';
type Props={language:Language;locale?:Locale;nativeLanguage?:string};
/** Static illustration, deliberately separate from stored personal results. */
export default function DiagnosticPreview({language,locale='en',nativeLanguage}:Props) {
  const t=diagnosticShortCopy(locale),copy=diagnosticReportCopy(locale);
  const contrasts=selectDiagnosticContrasts(language.contrasts,language.id,nativeLanguage);
  const sampleCorrect=[2,1,0,2,1,1],total=contrasts.length*2,correct=contrasts.reduce((sum,_,i)=>sum+sampleCorrect[i%sampleCorrect.length],0);
  const percent=total?Math.round(correct/total*100):0;
  return <figure className="diagnostic-preview" aria-label={t.chartLabel}>
    <figcaption><span className="diagnostic-preview-label">{t.sampleLabel}</span><h2>{t.previewTitle}</h2></figcaption>
    <div className="diagnostic-preview-overview"><div className="diagnostic-preview-donut" role="img" aria-label={`${copy.example}: ${correct}/${total} ${copy.matches}`} style={{background:`conic-gradient(#537361 ${percent}%, #e7e1d5 0)`}}><div><strong>{correct}<span>/{total}</span></strong><span>{percent}%</span></div></div><p>{t.previewBody}</p></div>
    <ul className="diagnostic-preview-bars">{contrasts.map((contrast,index)=>{
      const count=sampleCorrect[index%sampleCorrect.length],pair=diagnosticExamplePair(contrast);
      return <li key={contrast.id}><span className="diagnostic-preview-sound"><strong lang={language.locale}>{pair?.words.map(word=>word.text.normalize('NFC')).join(' / ')||contrast.label}</strong><span className="ipa-text">{diagnosticPhonemeLabel(contrast.phonemes)}</span></span><span className="diagnostic-preview-track" aria-hidden="true"><span style={{width:`${count/2*100}%`}}/></span><span className="diagnostic-preview-value">{count}/2<span className="diagnostic-preview-sr"> {copy.matches}</span></span></li>;
    })}</ul>
  </figure>;
}

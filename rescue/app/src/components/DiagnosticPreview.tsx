import type {Language} from '../lib/types';
import type {Locale} from '../lib/locales';
import {localizedSound,type PublicLocale} from '../lib/localized-public';
import {selectDiagnosticContrasts} from '../lib/diagnostic-plan';
import {diagnosticShortCopy} from '../lib/diagnostic-short-copy';
import './DiagnosticPreview.css';

type Props = {language:Language;locale?:Locale};
/** Static illustration, deliberately separate from stored personal results. */
export default function DiagnosticPreview({language,locale='en'}:Props) {
  const t=diagnosticShortCopy(locale);
  const contrasts=selectDiagnosticContrasts(language.contrasts,language.id);
  const sampleScores=[100,50,0,100,50,50];
  const sound=(value:string)=>locale==='en'?(value.includes(' ')?value:`/${value.replace(/^\/|\/$/g,'')}/`):localizedSound(value,locale as PublicLocale);
  return <figure className="diagnostic-preview" aria-label={t.chartLabel}>
    <figcaption>
      <span className="diagnostic-preview-label">{t.sampleLabel}</span>
      <h2>{t.previewTitle}</h2>
      <p>{t.previewBody}</p>
    </figcaption>
    <ul className="diagnostic-preview-bars">
      {contrasts.map((contrast,index)=>{
        const score=sampleScores[index%sampleScores.length];
        return <li key={contrast.id}>
          <span className="diagnostic-preview-sound">{contrast.phonemes.map(sound).join(' ↔ ')}</span>
          <span className="diagnostic-preview-track" aria-hidden="true"><span style={{width:`${score}%`}} /></span>
          <span className="diagnostic-preview-value">{score}%<span className="diagnostic-preview-sr"> {t.correct}</span></span>
        </li>;
      })}
    </ul>
  </figure>;
}

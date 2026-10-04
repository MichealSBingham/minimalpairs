import {diagnosticCopy} from '../lib/diagnostic-i18n';
import {localPath} from '../lib/locales';
import {localizedLanguage,type PublicLocale} from '../lib/localized-public';
import type {Language} from '../lib/types';
import '../styles/diagnostic-entry.css';
export default function DiagnosticEntry({languages,locale='en'}:{languages:Language[];locale?:string}) {
 const t=diagnosticCopy(locale);
 const available=languages.filter(l=>['en','fr','de','es','it','zh','pt','ru','ja'].includes(l.id));
 return <section className="diagnostic-entry" id="listening-check" aria-labelledby="listening-check-title">
  <div><p className="diagnostic-entry-eyebrow">{t.eyebrow}</p><h2 id="listening-check-title">{t.title}</h2><p>{t.resultsBody}</p></div>
  <nav aria-label={t.start}>{available.map(language=><a key={language.id} href={localPath(locale,`/diagnostic/${language.id}`)}><span>{locale==='en'?language.name:localizedLanguage(language.id,locale as PublicLocale)}</span><span aria-hidden="true">→</span></a>)}</nav>
 </section>;
}

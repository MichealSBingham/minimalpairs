import {feedbackText} from '../lib/feedback-i18n';
import { useEffect, useState } from 'react';
import { analyticsChoice, analyticsExcluded, browserDeclinesAnalytics, initializeMeasurement, measurementAvailable, setAnalyticsChoice, watchAnalyticsChoice } from '../lib/measurement';

export default function AnalyticsChoice({locale='en'}:{locale?:string}) {
  const t=(index:number)=>feedbackText(locale,index);
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ReturnType<typeof analyticsChoice>>(null);
  const [error, setError] = useState(false);
  const [browserDeclines, setBrowserDeclines] = useState(false);
  useEffect(() => {
    initializeMeasurement(); const configured = measurementAvailable(); setAvailable(configured); setBrowserDeclines(browserDeclinesAnalytics());
    const update = () => { const value = analyticsChoice(); setChoice(value); if (value) setOpen(false); };
    update(); setOpen(configured && !analyticsExcluded() && analyticsChoice() === null && !browserDeclinesAnalytics());
    return watchAnalyticsChoice(update);
  }, []);
  if (!available) return null;
  function choose(value: 'allowed' | 'declined') { setError(!setAnalyticsChoice(value)); }
  return <>{open ? <section className="analytics-choice" aria-label={t(9)}><div><strong>{t(10)}</strong><p>{t(11)}</p>{browserDeclines && <p>{t(12)}</p>}<a href="/privacy#analytics">{t(13)}</a></div><div className="analytics-actions"><button className="button button-light" onClick={() => choose('declined')}>{t(14)}</button>{!browserDeclines && <button className="button button-dark" onClick={() => choose('allowed')}>{t(15)}</button>}{(choice || browserDeclines) && <button className="text-button" onClick={() => setOpen(false)}>{t(16)}</button>}</div>{error && <p role="alert">{t(17)}</p>}</section> : <button className="analytics-settings" onClick={() => setOpen(true)}>{t(9)}</button>}</>;
}

import { useEffect, useState } from 'react';
import { analyticsChoice, browserDeclinesAnalytics, initializeMeasurement, measurementAvailable, setAnalyticsChoice, watchAnalyticsChoice } from '../lib/measurement';

export default function AnalyticsChoice() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ReturnType<typeof analyticsChoice>>(null);
  const [error, setError] = useState(false);
  const [browserDeclines, setBrowserDeclines] = useState(false);
  useEffect(() => {
    initializeMeasurement(); const configured = measurementAvailable(); setAvailable(configured); setBrowserDeclines(browserDeclinesAnalytics());
    const update = () => { const value = analyticsChoice(); setChoice(value); if (value) setOpen(false); };
    update(); setOpen(configured && analyticsChoice() === null && !browserDeclinesAnalytics());
    return watchAnalyticsChoice(update);
  }, []);
  if (!available) return null;
  function choose(value: 'allowed' | 'declined') { setError(!setAnalyticsChoice(value)); }
  return <>{open ? <section className="analytics-choice" aria-label="Usage analytics choices"><div><strong>Help us improve the listening experience?</strong><p>Optional Google Analytics measures visits and practice use. No microphone recordings or account emails are sent. You can practice either way.</p>{browserDeclines && <p>Your browser requests no tracking. Analytics is off.</p>}<a href="/privacy#analytics">How this works</a></div><div className="analytics-actions"><button className="button button-light" onClick={() => choose('declined')}>Keep analytics off</button>{!browserDeclines && <button className="button button-dark" onClick={() => choose('allowed')}>Allow usage analytics</button>}{(choice || browserDeclines) && <button className="text-button" onClick={() => setOpen(false)}>Close</button>}</div>{error && <p role="alert">Your browser could not save this choice. Analytics is off on this page; the choice could not be remembered.</p>}</section> : <button className="analytics-settings" onClick={() => setOpen(true)}>Analytics choices</button>}</>;
}

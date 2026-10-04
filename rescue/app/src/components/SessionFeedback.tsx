import { useEffect, useRef, useState } from 'react';
import { browserDeclinesAnalytics, sessionFeedbackPermission, shareSessionFeedback, watchAnalyticsChoice } from '../lib/measurement';
import type { SessionFeedbackCategory } from '../lib/measurement-data';
import type { PracticeSession } from './ui';
import '../styles/session-feedback.css';

const choices: { value: SessionFeedbackCategory; label: string }[] = [
  { value: 'audio_unclear', label: 'Audio sounded unclear' },
  { value: 'instructions_unclear', label: 'Instructions were unclear' },
  { value: 'too_easy', label: 'Too easy' },
  { value: 'too_difficult', label: 'Too difficult' },
  { value: 'about_right', label: 'Felt about right' },
];
export default function SessionFeedback({ session }: { session: Pick<PracticeSession, 'id' | 'languageId' | 'contrastId' | 'audioCollectionId'> }) {
  const [permission, setPermission] = useState<ReturnType<typeof sessionFeedbackPermission>>('off');
  const [browserDeclines, setBrowserDeclines] = useState(false);
  const [category, setCategory] = useState<SessionFeedbackCategory | ''>('');
  const [result, setResult] = useState<'queued' | 'duplicate' | 'off' | 'invalid' | 'unavailable' | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const update = () => {
      const next = sessionFeedbackPermission(); setPermission(next); setBrowserDeclines(browserDeclinesAnalytics());
      if (next !== 'allowed') setCategory('');
    };
    update(); return watchAnalyticsChoice(update);
  }, []);
  function submit() {
    if (!category || submitting.current || permission !== 'allowed' || result === 'queued' || result === 'duplicate') return;
    submitting.current = true;
    const value = shareSessionFeedback({ attempt_id: session.id, language_id: session.languageId, contrast_id: session.contrastId, audio_collection: session.audioCollectionId, feedback_category: category });
    setResult(value);
    if (value === 'off') { setPermission(sessionFeedbackPermission()); setCategory(''); }
    submitting.current = false;
  }
  const submitted = result === 'queued' || result === 'duplicate';
  return <details className="session-feedback">
    <summary>How was this session? <span>Optional</span></summary>
    <div className="session-feedback-body">
      {!submitted && permission !== 'allowed' && <p className="feedback-privacy">{permission === 'unavailable' ? 'Feedback is unavailable in this preview. Nothing is shared.' : browserDeclines ? 'Your browser asks us not to collect analytics. Feedback is off; nothing is shared.' : <>Feedback uses optional usage analytics, which is off. Nothing is shared. You can review your choice with “Analytics choices”.</>}</p>}
      {submitted ? <p className="feedback-receipt" role="status">{result === 'duplicate' ? 'Feedback was already queued for this session.' : 'Thank you. Feedback queued for analytics.'} Delivery isn’t confirmed.</p> : <>
        <fieldset disabled={permission !== 'allowed'}><legend>Choose one response</legend><div className="session-feedback-choices">{choices.map(choice => <label key={choice.value}><input type="radio" name={`session-feedback-${session.id}`} value={choice.value} checked={category === choice.value} onChange={() => { setCategory(choice.value); setResult(null); }} /><span>{choice.label}</span></label>)}</div></fieldset>
        <div className="session-feedback-actions"><button className="button button-light" disabled={!category || permission !== 'allowed'} onClick={submit}>Share feedback</button><a href="/privacy#analytics">What is shared?</a></div>
        {result === 'unavailable' || result === 'invalid' ? <p role="status">Feedback could not be queued. Nothing was confirmed. You can keep practicing.</p> : result === 'off' ? <p role="status">Analytics is off. Your response was not shared.</p> : null}
        <p className="feedback-fine">One response for this session, with its language, sound contrast and audio collection. No written message or account details. This is your impression, not a pronunciation check.</p>
      </>}
    </div>
  </details>;
}

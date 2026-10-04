import {feedbackText,feedbackTranslate} from '../lib/feedback-i18n';
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
export default function SessionFeedback({ session, locale='en' }: { locale?: string; session: Pick<PracticeSession, 'id' | 'languageId' | 'contrastId' | 'audioCollectionId'> }) {
  const t=(index:number)=>feedbackText(locale,index);
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
    <summary>{t(18)} <span>{t(19)}</span></summary>
    <div className="session-feedback-body">
      {!submitted && permission !== 'allowed' && <p className="feedback-privacy">{t(28)}</p>}
      {submitted ? <p className="feedback-receipt" role="status">{t(29)}</p> : <>
        <fieldset disabled={permission !== 'allowed'}><legend>{t(25)}</legend><div className="session-feedback-choices">{choices.map(choice => <label key={choice.value}><input type="radio" name={`session-feedback-${session.id}`} value={choice.value} checked={category === choice.value} onChange={() => { setCategory(choice.value); setResult(null); }} /><span>{feedbackTranslate(locale,choice.label)}</span></label>)}</div></fieldset>
        <div className="session-feedback-actions"><button className="button button-light" disabled={!category || permission !== 'allowed'} onClick={submit}>{t(26)}</button><a href="/privacy#analytics">{t(27)}</a></div>
        {result === 'unavailable' || result === 'invalid' ? <p role="status">{t(30)}</p> : result === 'off' ? <p role="status">{t(28)}</p> : null}
        <p className="feedback-fine">{t(31)}</p>
      </>}
    </div>
  </details>;
}

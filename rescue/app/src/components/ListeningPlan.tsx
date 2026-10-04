import { useEffect, useState } from 'react';
import { createListeningPlan, derivePlanProgress, LISTENING_PLAN_KEY, loadListeningPlan, planIsAvailable, planPracticeHref, saveListeningPlan, type ListeningPlan as Plan, type PlanLanguage, type PlanCompletion } from '../lib/listening-plan';
import { Icon, PROGRESS_KEY, readProgress } from './ui';
import '../styles/listening-plan.css';

const purposeLabels = ['First listen', 'Return to this sound', 'Try another sound'];
const DAY = 86_400_000;
function timingLabel(completion: PlanCompletion, previous: PlanCompletion | null) {
  if (!previous) return new Date(completion.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if ((completion.elapsedSincePrevious || 0) >= DAY) return 'At least 24 hours after the previous session';
  return new Date(completion.completedAt).toDateString() === new Date(previous.completedAt).toDateString()
    ? 'Same day as the previous session' : 'Next calendar day, less than 24 hours later';
}

export default function ListeningPlan({ catalog }: { catalog: PlanLanguage[] }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [now, setNow] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [languageId, setLanguageId] = useState('');
  const [contrastId, setContrastId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    function refresh() {
      try {
        const result = loadListeningPlan(window.localStorage);
        setPlan(result.plan); setError(result.error || '');
      } catch { setError('This browser could not load your saved plan. Ordinary practice is still available.'); }
      setHistory(readProgress().sessions); setNow(Date.now()); setLoaded(true);
    }
    function changed(event: StorageEvent) { if (!event.key || event.key === LISTENING_PLAN_KEY || event.key === PROGRESS_KEY) refresh(); }
    function visible() { if (document.visibilityState === 'visible') refresh(); }
    refresh();
    window.addEventListener('storage', changed); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const language = catalog.find(item => item.id === languageId);
  const status = plan ? derivePlanProgress(plan, history, now) : null;
  const complete = status?.completed === 3;
  const available = plan ? planIsAvailable(plan, catalog) : false;
  const nextLink = plan && status?.nextIndex !== null && status?.nextIndex !== undefined && available ? planPracticeHref(plan, status.nextIndex) : null;
  const showingForm = loaded && (!plan || choosing);
  function chooseAgain() {
    const current = catalog.find(item => item.id === plan?.languageId);
    setLanguageId(current?.id || ''); setContrastId(current?.contrasts.find(item => item.id === plan?.slots[0].contrastId)?.id || current?.contrasts[0]?.id || '');
    setChoosing(true); setNotice('');
  }
  function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const created = createListeningPlan(catalog, languageId, contrastId, { id: crypto.randomUUID(), now: Date.now() });
      if (!created) throw new Error('Choose an available language and starting sound before saving your plan.');
      saveListeningPlan(window.localStorage, created);
      setPlan(created); setNow(Date.now()); setHistory(readProgress().sessions); setChoosing(false); setNotice('Plan saved on this device.');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'This browser could not save your plan. Please try again.'); }
  }
  const assisted = status?.completions.filter(item => item?.textHintsUsed === true).length || 0;
  const unaided = status?.completions.filter(item => item?.textHintsUsed === false).length || 0;
  return <section className="listening-plan" id="listening-plan" aria-labelledby="listening-plan-title">
    <div className="listening-plan-heading"><div><span className="eyebrow">FREE · OPTIONAL PREVIEW</span><h2 id="listening-plan-title">Your listening week.</h2></div><span className="plan-mark" aria-hidden="true"><Icon name="headphones" size={23} /></span></div>
    {!loaded ? <p>Loading your device plan…</p> : <>
      {!plan && <p className="plan-intro">Three short sessions, one clear next step. Choose a language, return to a sound, then explore another.</p>}
      {plan && status && <>
        <div className="plan-progress"><strong>{plan.languageName}</strong><span role="status">{status.completed} of 3 sessions completed</span></div>
        <ol className="plan-slots">{plan.slots.map((slot, index) => {
          const completion = status.completions[index];
          return <li key={index} className={completion ? 'is-complete' : status.nextIndex === index ? 'is-next' : ''} aria-current={status.nextIndex === index ? 'step' : undefined}>
            <span className="plan-step" aria-hidden="true">{completion ? <Icon name="check" size={16} /> : index + 1}</span><div><strong>{purposeLabels[index]}</strong><span>{slot.soundLabel}{status.nextIndex === index ? ' · Up next' : ''}</span>
              {completion ? <small>{completion.textHintsUsed === true ? 'Text hints used' : completion.textHintsUsed === false ? 'Audio-only' : 'Assistance not recorded'} · {timingLabel(completion, status.completions[index - 1] || null)}</small>
                : <small>{index === 1 ? 'A later-day revisit is suggested. You can also practice now.' : 'Text hints remain optional.'}</small>}
            </div>
          </li>;
        })}</ol>
        {complete ? <div className="plan-finished"><strong>You completed your three sessions.</strong><p>{unaided} audio-only{assisted ? ` · ${assisted} with text hints` : ''}{status.completed - unaided - assisted ? ` · ${status.completed - unaided - assisted} with assistance unrecorded` : ''}. These are practice records, not a proficiency result.</p></div>
          : !available ? <p className="plan-unavailable" role="status">A sound in this saved plan is no longer available with complete cached audio. Choose a new plan to continue; your history stays saved.</p>
          : nextLink && <a className="button button-dark plan-next" href={nextLink}>Open session {status.completed + 1}<Icon name="arrow" size={16} /></a>}
        {!choosing && <button className="text-button plan-restart" onClick={chooseAgain}>{complete ? 'Plan another week' : 'Choose a new plan'}</button>}
      </>}
      {showingForm && (catalog.length ? <form className="plan-form" onSubmit={save}>
        {plan && <p>{complete ? 'Choose your next three sessions when you’re ready.' : 'Saving a new plan replaces this plan. Completed practice stays in your history.'}</p>}
        <div className="plan-fields"><label>Plan language<select value={languageId} onChange={event => { const chosen = catalog.find(item => item.id === event.target.value); setLanguageId(event.target.value); setContrastId(chosen?.contrasts[0]?.id || ''); }} required><option value="" disabled>Choose a language</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {language && <label>Starting sound<select value={contrastId} onChange={event => setContrastId(event.target.value)} required>{language.contrasts.map(item => <option key={item.id} value={item.id}>{item.soundLabel}</option>)}</select></label>}</div>
        <div className="plan-form-actions"><button className="button button-dark" type="submit" disabled={!language || !contrastId}>{plan ? 'Save new plan' : 'Save my free plan'}<Icon name="arrow" size={15} /></button>{plan && <button className="text-button" type="button" onClick={() => { setChoosing(false); setError(''); }}>Keep this plan</button>}</div>
      </form> : <p>Complete cached audio is not available for a listening plan right now. Ordinary practice is still open.</p>)}
      {notice && <p className="plan-notice" role="status">{notice}</p>}{error && <p className="audio-error" role="alert">{error}</p>}
      <details className="plan-details"><summary>How this plan works</summary><p>Three sessions and the suggested later-day revisit are a simple planning rule, not a proven learning dose. You can complete them whenever you like.</p><p>Only complete, matching 12-round sessions saved on this device after the plan was created count, in the order shown. Ordinary practice of the same sounds also counts. Each session counts once. Audio comparisons and human-audio pilots do not count toward this plan.</p><p>The language, sounds and ordinary audio collection are fixed when you save. The plan stays on this device and is not synced to your account. Progress is rebuilt from up to 1,000 saved device sessions; clearing or replacing that history can change the progress shown. Signing in does not change it. Clearing browser storage removes it.</p></details>
    </>}
  </section>;
}

import { commerce, commercePath } from '../lib/commerce-i18n';
import { useEffect, useState } from 'react';
import { createListeningPlan, derivePlanProgress, LISTENING_PLAN_KEY, loadListeningPlan, planIsAvailable, planPracticeHref, saveListeningPlan, type ListeningPlan as Plan, type PlanLanguage } from '../lib/listening-plan';
import { Icon, PROGRESS_KEY, readProgress } from './ui';
import '../styles/listening-plan.css';

export default function ListeningPlan({ catalog, locale = 'en' }: { catalog: PlanLanguage[]; locale?: string }) {
  const t = commerce(locale);
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
        setPlan(result.plan); setError(result.error ? t('error') : '');
      } catch { setError(t('error')); }
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
  function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const created = createListeningPlan(catalog, languageId, contrastId, { id: crypto.randomUUID(), now: Date.now() });
      if (!created) throw new Error('Choose an available language and starting sound before saving your plan.');
      saveListeningPlan(window.localStorage, created);
      setPlan(created); setNow(Date.now()); setHistory(readProgress().sessions); setChoosing(false); setNotice(t('savedPlan'));
    } catch (issue) { setError(t('error')); }
  }
  const assisted = status?.completions.filter(item => item?.textHintsUsed === true).length || 0;
  const unaided = status?.completions.filter(item => item?.textHintsUsed === false).length || 0;
  return <section className="listening-plan" id="listening-plan" aria-labelledby="listening-plan-title">
    <div className="listening-plan-heading"><div><span className="eyebrow">{t('free')}</span><h2 id="listening-plan-title">{t('week')}</h2></div><span className="plan-mark" aria-hidden="true"><Icon name="headphones" size={23} /></span></div>
    {!loaded ? <p>{t('loading')}</p> : <>
      {!plan && <p className="plan-intro">{t('planIntro')}</p>}
      {plan && status && <>
        <div className="plan-progress"><strong>{catalog.find(item => item.id === plan.languageId)?.name || plan.languageName}</strong><span role="status">{status.completed}/3 · {t('sessions')}</span></div>
        <ol className="plan-slots">{plan.slots.map((slot, index) => {
          const completion = status.completions[index];
          return <li key={index} className={completion ? 'is-complete' : status.nextIndex === index ? 'is-next' : ''} aria-current={status.nextIndex === index ? 'step' : undefined}>
            <span className="plan-step" aria-hidden="true">{completion ? <Icon name="check" size={16} /> : index + 1}</span><div><strong>{t(index === 0 ? 'firstListen' : index === 1 ? 'returnSound' : 'anotherSound')}</strong><span>{slot.soundLabel.replace(/^Sound contrast /, `${t('startingSound')} `)}{status.nextIndex === index ? ` · ${t('next')}` : ''}</span>
              {completion && <small>{completion.textHintsUsed === true ? t('hints') : completion.textHintsUsed === false ? t('audioOnly') : ''} · {new Date(completion.completedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</small>}
            </div>
          </li>;
        })}</ol>
        {complete ? <div className="plan-finished"><strong>{t('completedPlan')}</strong><p>{unaided} · {t('audioOnly')} {assisted ? ` · ${assisted} ${t('hints')}` : ''}</p></div>
          : !available ? <p className="plan-unavailable" role="status">{t('choosePlan')}</p>
          : nextLink && <a className="button button-dark plan-next" href={commercePath(locale, nextLink)}>{t('practice')} {status.completed + 1}<Icon name="arrow" size={16} /></a>}
        {!choosing && <button className="text-button plan-restart" onClick={chooseAgain}>{t('choosePlan')}</button>}
      </>}
      {showingForm && (catalog.length ? <form className="plan-form" onSubmit={save}>
        {plan && <p>{t('replacePlan')}</p>}
        <div className="plan-fields"><label>{t('chooseLanguage')}<select value={languageId} onChange={event => { const chosen = catalog.find(item => item.id === event.target.value); setLanguageId(event.target.value); setContrastId(chosen?.contrasts[0]?.id || ''); }} required><option value="" disabled>{t('chooseLanguage')}</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {language && <label>{t('startingSound')}<select value={contrastId} onChange={event => setContrastId(event.target.value)} required>{language.contrasts.map(item => <option key={item.id} value={item.id}>{item.soundLabel}</option>)}</select></label>}</div>
        <div className="plan-form-actions"><button className="button button-dark" type="submit" disabled={!language || !contrastId}>{t('savePlan')}<Icon name="arrow" size={15} /></button>{plan && <button className="text-button" type="button" onClick={() => { setChoosing(false); setError(''); }}>{t('keepPlan')}</button>}</div>
      </form> : <p>{t('unavailable')}</p>)}
      {notice && <p className="plan-notice" role="status">{notice}</p>}{error && <p className="audio-error" role="alert">{error}</p>}
      <details className="plan-details"><summary>{t('planRules')}</summary><p>{t('planRulesBody')}</p></details>
    </>}
  </section>;
}

import { acquisitionDetails, measurementData, measurementPath, recommendationAttribution, type EventData, type MeasurementEvent } from './measurement-data';

declare global { interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; } }
const CHOICE_KEY = 'minimalpairs.analytics-choice.v1';
const CHOICE_EVENT = 'minimalpairs:analytics-choice';
const EXCLUSION_KEY = 'minimalpairs.analytics-excluded.v1';
const ACQUISITION_KEY = 'minimalpairs.analytics-acquisition.v1';
const RETURN_KEY = 'minimalpairs.analytics-last-practice.v1';
const RECOMMENDATION_KEY = 'minimalpairs.analytics-recommendation.v1';
type Choice = 'allowed' | 'declined' | null;
let loaded = false;
let pageRecorded = false;
let initialized = false;
let storageBlocked = false;
const attempts = new Map<string, { started: number; firstAnswer: boolean; finished: boolean; errors: Set<number>; data: EventData }>();
const openedRecommendations = new Set<string>();
// Only duplicate protection, never a delivery queue. No feedback is persisted.
const sharedFeedback = new Set<string>();
function clearRecommendation() { try { window.sessionStorage.removeItem(RECOMMENDATION_KEY); } catch { /* Measurement must not interrupt practice. */ } }
function clearPendingMeasurement() { attempts.clear(); openedRecommendations.clear(); clearRecommendation(); try { window.sessionStorage.removeItem(ACQUISITION_KEY); window.localStorage.removeItem?.(RETURN_KEY); } catch {} }
function configuration() {
  if (typeof document === 'undefined') return null;
  const id = document.documentElement.dataset.measurementId || '';
  const environment = document.documentElement.dataset.measurementEnvironment || 'preview';
  return /^G-[A-Z0-9]+$/.test(id) ? { id, environment: environment === 'production' ? 'production' : 'preview' } : null;
}
export function analyticsChoice(): Choice {
  try { const value = window.localStorage.getItem(CHOICE_KEY); return value === 'allowed' || value === 'declined' ? value : null; } catch { return null; }
}
export function measurementAvailable() { return Boolean(configuration()); }
export function browserDeclinesAnalytics() {
  return typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || Boolean((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl));
}
export function analyticsExcluded() {
  try { return window.localStorage.getItem(EXCLUSION_KEY) === 'true' || /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) || Boolean(navigator.webdriver); } catch { return true; }
}
export function setAnalyticsExcluded(value: boolean) {
  try { window.localStorage.setItem(EXCLUSION_KEY, String(value)); } catch { storageBlocked = true; disabled(true); return false; }
  if(value) { setAnalyticsChoice('declined'); clearPendingMeasurement(); }
  window.dispatchEvent(new Event(CHOICE_EVENT)); return true;
}
function permitted() {
  return !analyticsExcluded() && !storageBlocked && Boolean(configuration()) && analyticsChoice() === 'allowed' && !browserDeclinesAnalytics();
}
export function sessionFeedbackPermission(): 'allowed' | 'off' | 'unavailable' {
  if (!configuration()) return 'unavailable';
  return permitted() ? 'allowed' : 'off';
}
/** Explicit completion-screen action. A true tag call means queued, not received. */
export function shareSessionFeedback(raw: EventData): 'queued' | 'duplicate' | 'off' | 'invalid' | 'unavailable' {
  const data = measurementData('practice_feedback', raw);
  if (!data) return 'invalid';
  if (!permitted()) return 'off';
  const id = String(data.attempt_id);
  if (sharedFeedback.has(id)) return 'duplicate';
  if (!trackMeasurement('practice_feedback', data)) return 'unavailable';
  if (sharedFeedback.size >= 100) sharedFeedback.delete(sharedFeedback.values().next().value!);
  sharedFeedback.add(id);
  return 'queued';
}
function disabled(value: boolean) {
  const config = configuration(); if (config) (window as unknown as Record<string, unknown>)[`ga-disable-${config.id}`] = value;
}
function acquisition(): {channel:string;source?:string;medium?:string;campaign?:string} {
  const current = acquisitionDetails(document.referrer, window.location.origin, window.location.search);
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(ACQUISITION_KEY) || 'null');
    const fresh = stored && Number.isFinite(stored.at) && Date.now() >= stored.at && Date.now() - stored.at < 30 * 60_000;
    const values = (current.channel === 'internal' || current.channel === 'direct') && fresh ? stored.values : current;
    // Re-sanitize stored values so edited browser storage cannot leak arbitrary strings.
    const clean = values.source ? acquisitionDetails('', window.location.origin, new URLSearchParams({utm_source:values.source,utm_medium:values.medium,utm_campaign:values.campaign || ''}).toString()) : {channel:current.channel};
    const selected = clean.channel === 'direct' && values.channel === 'referral' ? {channel:'referral',source:'other',medium:'referral'} : clean;
    window.sessionStorage.setItem(ACQUISITION_KEY, JSON.stringify({at:Date.now(),values:selected}));
    return selected;
  } catch { return current; }
}
/** Coarse purchase attribution only after analytics consent; never identity or URL data. */
export function checkoutAttribution() {
  if (!permitted()) return undefined;
  const source = acquisition();
  const locale = /^(en|es|fr|pt|de|it|ru|ja|zh)$/.test(document.documentElement.lang || '') ? document.documentElement.lang : 'en';
  if (source.channel === 'unknown' || source.channel === 'internal') return undefined;
  return {source:source.source || 'direct', medium:source.medium || 'none', ...(source.campaign ? {campaign:source.campaign} : {}), ui_locale:locale};
}
function common() {
  const config = configuration()!;
  const path = measurementPath(window.location.pathname);
  const source = acquisition();
  const locale = /^(en|es|fr|pt|de|it|ru|ja|zh)$/.test(document.documentElement.lang || '') ? document.documentElement.lang : 'en';
  // Google requires the debug parameter to be absent, not false, to disable it.
  return { environment: config.environment, ...(config.environment === 'preview' ? { debug_mode: true } : {}), page_location: window.location.origin + path, page_title: `MinimalPairs ${path}`, page_referrer: '', ui_locale:locale, acquisition_channel: source.channel, ...('source' in source ? {campaign_source:source.source,campaign_medium:source.medium} : {}), ...('campaign' in source ? {campaign_name:source.campaign} : {}) };
}
function loadTag() {
  const config = configuration(); if (!config || !permitted()) return false;
  disabled(false);
  if (!loaded) {
    window.dataLayer ||= [];
    window.gtag = function () { window.dataLayer!.push(arguments); };
    window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', config.id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_expires: 15_552_000, ...common() });
    const script = document.createElement('script'); script.async = true; script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.id)}`; script.dataset.minimalpairsAnalytics = 'true'; document.head.append(script);
    loaded = true;
  }
  return true;
}
export function trackMeasurement(event: MeasurementEvent, raw: EventData = {}) {
  // Measurement is best-effort: an extension, storage policy or failed tag must
  // never block audio playback, answering a question, or saving a result.
  try {
    const data = measurementData(event, raw);
    if (!data || !permitted() || !loadTag()) return false;
    if (typeof window.gtag !== 'function') return false;
    window.gtag('event', event, { ...data, ...common() });
    return true;
  } catch { return false; }
}
function recordPage() {
  if (!pageRecorded && trackMeasurement('page_view')) pageRecorded = true;
  recordRecommendationArrival();
}
export function setAnalyticsChoice(choice: Exclude<Choice, null>) {
  try { window.localStorage.setItem(CHOICE_KEY, choice); storageBlocked = false; }
  catch { storageBlocked = true; disabled(true); clearPendingMeasurement(); return false; }
  if (choice === 'allowed') { disabled(!permitted()); if (loaded && permitted()) window.gtag?.('consent', 'update', { analytics_storage: 'granted' }); recordPage(); }
  else {
    disabled(true); clearPendingMeasurement();
    if (loaded) window.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0].trim();
      if (!/^_ga(?:_|$)/.test(name)) continue;
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
      const labels = window.location.hostname.split('.');
      for (let i = 0; i < labels.length - 1; i++) document.cookie = `${name}=; Max-Age=0; path=/; domain=${labels.slice(i).join('.')}; SameSite=Lax`;
    }
  }
  window.dispatchEvent(new Event(CHOICE_EVENT)); return true;
}
export function initializeMeasurement() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true; disabled(!permitted()); if (!permitted()) clearPendingMeasurement(); recordPage();
  window.addEventListener('storage', event => { if (event.key === CHOICE_KEY || event.key === EXCLUSION_KEY || event.key === null) { disabled(!permitted()); if (permitted()) { if (loaded) window.gtag?.('consent', 'update', { analytics_storage: 'granted' }); recordPage(); } else { clearPendingMeasurement(); if (loaded) window.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }); } window.dispatchEvent(new Event(CHOICE_EVENT)); } });
}
export function watchAnalyticsChoice(listener: () => void) { window.addEventListener(CHOICE_EVENT, listener); return () => window.removeEventListener(CHOICE_EVENT, listener); }
/** Save a consented same-tab intent. Do not delay navigation for analytics. */
export function openMeasuredRecommendation(data: EventData, sameTab: boolean) {
  const clean = measurementData('review_open', data);
  if (!clean || !permitted()) { clearRecommendation(); return false; }
  if (!sameTab) { clearRecommendation(); return false; }
  const id = String(clean.recommendation_id);
  if (openedRecommendations.has(id)) return false;
  clearRecommendation();
  try {
    const saved = JSON.stringify({ ...clean, version: 1, openedAt: Date.now(), arrived: false });
    window.sessionStorage.setItem(RECOMMENDATION_KEY, saved);
    if (window.sessionStorage.getItem(RECOMMENDATION_KEY) !== saved) return false;
    if (openedRecommendations.size >= 100) openedRecommendations.delete(openedRecommendations.values().next().value!);
    openedRecommendations.add(id);
    return true;
  } catch { return false; }
}
/** Count arrival on the matching destination, rather than a fragile unload-time click. */
function recordRecommendationArrival() {
  try {
    if (!permitted() || window.location.pathname.replace(/^\/(es|fr|pt|de|it|ru|ja|zh)(?=\/)/,'').replace(/\/$/, '') !== '/practice') return;
    const raw = window.sessionStorage.getItem(RECOMMENDATION_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const query = new URLSearchParams(window.location.search);
    const target = { language_id: query.get('language'), contrast_id: query.get('contrast'), audio_collection: saved.audio_collection };
    const attribution = recommendationAttribution(saved, target, Date.now());
    if (!attribution || saved.arrived !== false) return;
    // Write first so a reload cannot repeatedly count the same arrival.
    const recorded = JSON.stringify({ ...measurementData('review_open', saved), version: 1, openedAt: saved.openedAt, arrived: true });
    window.sessionStorage.setItem(RECOMMENDATION_KEY, recorded);
    if (window.sessionStorage.getItem(RECOMMENDATION_KEY) !== recorded) return;
    trackMeasurement('review_open', { ...target, ...attribution });
  } catch { /* Missing storage or a tag cannot interrupt navigation. */ }
}
function takeRecommendation(target: EventData): EventData | null {
  try {
    const raw = window.sessionStorage.getItem(RECOMMENDATION_KEY);
    window.sessionStorage.removeItem(RECOMMENDATION_KEY);
    if (!raw || !permitted() || window.location.pathname.replace(/^\/(es|fr|pt|de|it|ru|ja|zh)(?=\/)/,'').replace(/\/$/, '') !== '/practice') return null;
    const saved = JSON.parse(raw);
    return saved?.arrived === true ? recommendationAttribution(saved, target, Date.now()) : null;
  } catch { return null; }
}
export function startMeasuredPractice(attemptId: string, data: EventData) {
  if (attempts.has(attemptId)) return;
  recordRecommendationArrival();
  const recommendation = takeRecommendation(data);
  const start = { ...data, ...recommendation, attempt_id: attemptId };
  if (trackMeasurement('practice_start', start)) {
    try {
      const previous = Number(window.localStorage.getItem(RETURN_KEY));
      const days = Math.floor((Date.now()-previous)/86_400_000);
      if(previous > 0 && days >= 0 && days <= 3650) trackMeasurement('return_practice', {...start,days_since_previous:days,return_window:days===0?'same_day':days===1?'day_1':days<=7?'days_2_7':days<=30?'days_8_30':'later'});
      window.localStorage.setItem(RETURN_KEY,String(Date.now()));
    } catch { /* Retention measurement cannot block a lesson. */ }
    if (attempts.size >= 100) attempts.delete(attempts.keys().next().value!);
    attempts.set(attemptId, { started: Date.now(), firstAnswer: false, finished: false, errors: new Set(), data: start });
    if (recommendation) trackMeasurement('review_practice_start', start);
  }
}
export function measuredFirstAnswer(attemptId: string, hintsUsed: boolean) {
  const attempt = attempts.get(attemptId); if (!attempt || attempt.firstAnswer) return;
  attempt.firstAnswer = true; trackMeasurement('practice_first_answer', { ...attempt.data, text_hints_used: hintsUsed, duration_ms: Date.now() - attempt.started });
}
export function measuredAudioFailure(attemptId: string, round: number) {
  const attempt = attempts.get(attemptId); if (!attempt || attempt.errors.has(round)) return;
  attempt.errors.add(round); trackMeasurement('practice_audio_error', { ...attempt.data, round });
}
export function completeMeasuredPractice(attemptId: string, result: EventData) {
  const attempt = attempts.get(attemptId); if (!attempt || attempt.finished) return;
  attempt.finished = true; trackMeasurement('practice_complete', { ...attempt.data, ...result, duration_ms: Date.now() - attempt.started });
  if (attempt.data.recommendation_id) trackMeasurement('review_practice_complete', { ...attempt.data, ...result, duration_ms: Date.now() - attempt.started });
}

/** Lifecycle events require a consented start; no orphan completion after late opt-in. */
export function trackMeasuredPracticeEvent(event: MeasurementEvent, raw: EventData) {
  const attempt = attempts.get(String(raw.attempt_id));
  if(!attempt) return false;
  return trackMeasurement(event,{...attempt.data,...raw});
}

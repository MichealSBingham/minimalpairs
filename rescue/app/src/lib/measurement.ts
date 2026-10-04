import { acquisitionChannel, measurementData, measurementPath, recommendationAttribution, type EventData, type MeasurementEvent } from './measurement-data';

declare global { interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; } }
const CHOICE_KEY = 'minimalpairs.analytics-choice.v1';
const CHOICE_EVENT = 'minimalpairs:analytics-choice';
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
function clearPendingMeasurement() { attempts.clear(); openedRecommendations.clear(); clearRecommendation(); }
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
function permitted() {
  return !storageBlocked && Boolean(configuration()) && analyticsChoice() === 'allowed' && !browserDeclinesAnalytics();
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
function common() {
  const config = configuration()!;
  const path = measurementPath(window.location.pathname);
  // Google requires the debug parameter to be absent, not false, to disable it.
  return { environment: config.environment, ...(config.environment === 'preview' ? { debug_mode: true } : {}), page_location: window.location.origin + path, page_title: `MinimalPairs ${path}`, page_referrer: '', acquisition_channel: acquisitionChannel(document.referrer, window.location.origin) };
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
  window.addEventListener('storage', event => { if (event.key === CHOICE_KEY || event.key === null) { disabled(!permitted()); if (permitted()) { if (loaded) window.gtag?.('consent', 'update', { analytics_storage: 'granted' }); recordPage(); } else { clearPendingMeasurement(); if (loaded) window.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }); } window.dispatchEvent(new Event(CHOICE_EVENT)); } });
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
    if (!permitted() || window.location.pathname.replace(/\/$/, '') !== '/practice') return;
    const raw = window.sessionStorage.getItem(RECOMMENDATION_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const query = new URLSearchParams(window.location.search);
    const target = { language_id: query.get('language'), contrast_id: query.get('contrast'), audio_collection: 'qwen-starter-v1' };
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
    if (!raw || !permitted() || window.location.pathname.replace(/\/$/, '') !== '/practice') return null;
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

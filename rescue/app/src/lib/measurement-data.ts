export { landingPath } from './landing-path.mjs';
export const MEASUREMENT_VERSION = 'business-funnel-v3';
export const MEASUREMENT_EVENTS = ['page_view', 'practice_start', 'practice_first_answer', 'practice_complete', 'practice_audio_error', 'practice_feedback', 'review_shown', 'review_open', 'review_practice_start', 'review_practice_complete', 'diagnostic_start', 'diagnostic_complete', 'diagnostic_results_view', 'paywall_view', 'plans_view', 'plan_selected', 'begin_checkout', 'checkout_resumed', 'checkout_error', 'billing_portal_open', 'login', 'audio_report_submitted', 'support_submitted', 'guide_audio_play', 'practice_group_complete', 'practice_exit', 'return_practice'] as const;
export const SESSION_FEEDBACK_CATEGORIES = ['audio_unclear', 'instructions_unclear', 'too_easy', 'too_difficult', 'about_right'] as const;
export type SessionFeedbackCategory = typeof SESSION_FEEDBACK_CATEGORIES[number];
export type MeasurementEvent = typeof MEASUREMENT_EVENTS[number];
export type EventData = Record<string, unknown>;
const languages = new Set(['en', 'fr', 'de', 'es', 'it', 'zh', 'pt', 'ru', 'ja']);
const languagePages = new Set(['english', 'british-english', 'french', 'german', 'spanish', 'italian', 'mandarin-chinese', 'portuguese', 'russian', 'japanese'].map(id => `/${id}-minimal-pairs`));
const publicPages = new Set(['/', '/practice', '/account', '/pricing', '/teachers', '/method', '/privacy', '/terms', '/restore-access', '/human-audio-preview', '/audio-comparison', '/audio-credits', '/support']);
const identifier = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const contrast = /^(en|fr|de|es|it|zh|pt|ru|ja)-[a-z0-9-]{1,55}$/;
const uuid = /^(?:(?:focused|mixed|diagnostic)-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const RECOMMENDATION_WINDOW_MS = 30 * 60_000;

/** Never forward query strings, fragments, account identifiers or arbitrary page paths. */
export function measurementPath(value: string) {
  const original = value.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
  const path = original.replace(/^\/(es|fr|pt|de|it|ru|ja|zh)(?=\/|$)/, '') || '/';
  if (publicPages.has(path) || languagePages.has(path) || /^\/diagnostic\/(en|fr|de|es|it|zh|pt|ru|ja)$/.test(path)) return original;
  if (path.startsWith('/learn/') && contrast.test(path.slice(7))) return original;
  return '/other';
}

const aiReferrers: Record<string, string> = {
  'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt',
  'claude.ai': 'claude', 'perplexity.ai': 'perplexity',
  'copilot.microsoft.com': 'copilot', 'gemini.google.com': 'gemini',
};
const aiSources = new Set(Object.values(aiReferrers));
function aiSource(host: string) {
  return Object.entries(aiReferrers).find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1];
}

export function acquisitionChannel(referrer: string, origin: string) {
  if (!referrer) return 'direct';
  try {
    const url = new URL(referrer); if (url.origin === origin || ['minimalpairs.co','www.minimalpairs.co','minimalpairs.web.app','checkout.stripe.com','billing.stripe.com','accounts.google.com'].includes(url.hostname)) return 'internal';
    if (aiSource(url.hostname)) return 'ai_referral';
    if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/.test(url.hostname)) return 'organic_search';
    if (/(^|\.)(reddit\.com|facebook\.com|instagram\.com|tiktok\.com|linkedin\.com|x\.com|t\.co)$/.test(url.hostname)) return 'social';
    return 'referral';
  } catch { return 'unknown'; }
}
/** A deliberately narrow allowlist: no emails, word answers, error messages or URLs. */
export function measurementData(event: string, raw: EventData = {}): EventData | null {
  if (!(MEASUREMENT_EVENTS as readonly string[]).includes(event)) return null;
  const clean: EventData = { measurement_version: MEASUREMENT_VERSION };
  if (typeof raw.language_id === 'string' && languages.has(raw.language_id)) clean.language_id = raw.language_id;
  if (typeof raw.contrast_id === 'string' && contrast.test(raw.contrast_id)) clean.contrast_id = raw.contrast_id;
  if (typeof raw.audio_collection === 'string' && identifier.test(raw.audio_collection)) clean.audio_collection = raw.audio_collection;
  for (const key of ['attempt_id', 'recommendation_id']) if (typeof raw[key] === 'string' && uuid.test(raw[key])) clean[key] = raw[key];
  if (event === 'practice_feedback') {
    if (!clean.attempt_id || !clean.language_id || !clean.contrast_id || !clean.audio_collection || !String(clean.contrast_id).startsWith(`${clean.language_id}-`) || !(SESSION_FEEDBACK_CATEGORIES as readonly unknown[]).includes(raw.feedback_category)) return null;
    // Feedback has its own strict payload, without score, words, account fields,
    // recommendation IDs, free text or arbitrary dimensions from other events.
    return { measurement_version: MEASUREMENT_VERSION, attempt_id: clean.attempt_id, language_id: clean.language_id, contrast_id: clean.contrast_id, audio_collection: clean.audio_collection, feedback_category: raw.feedback_category };
  }
  for (const key of ['text_hints_used', 'first_device_completion']) if (typeof raw[key] === 'boolean') clean[key] = raw[key];
  for (const [key, max] of [['correct', 1000], ['total', 1000], ['round', 1000], ['duration_ms', 86_400_000], ['groups_count', 200], ['days_since_previous', 3650]] as const) {
    const n = raw[key]; if (Number.isInteger(n) && Number(n) >= 0 && Number(n) <= max) clean[key] = n;
  }
  const enums: Record<string, readonly string[]> = {
    diagnostic_length:['short','full'], diagnostic_version:['diagnostic-v2'],
    activity_mode: ['abx-cross-word','word-identification'], session_kind:['focused','mixed','diagnostic'],
    plan:['monthly','lifetime'], surface:['pricing','practice','account','diagnostic','guide','support'],
    access_tier:['free','paid','lifetime'], ui_locale:['en','fr','de','es','it','zh','pt','ru','ja'],
    reason:['pronunciation','repetition','noise','playback'], topic:['account','billing','audio','other'],
    method:['google'], outcome:['confirmed','failed'], return_window:['same_day','day_1','days_2_7','days_8_30','later']
  };
  for (const [key, values] of Object.entries(enums)) if (typeof raw[key] === 'string' && values.includes(raw[key] as string)) clean[key]=raw[key];
  if (['plan_selected','begin_checkout','checkout_resumed'].includes(event) && !clean.plan) return null;
  if (event === 'login' && clean.method !== 'google') return null;
  if (event === 'audio_report_submitted' && (!clean.language_id || !clean.reason)) return null;
  if (event === 'support_submitted' && !clean.topic) return null;
  if (event.startsWith('diagnostic_') && (!clean.attempt_id || !clean.language_id)) return null;
  if (typeof raw.recommendation_kind === 'string' && ['start', 'explore', 'revisit', 'review-due'].includes(raw.recommendation_kind)) clean.recommendation_kind = raw.recommendation_kind;
  if (typeof raw.recommendation_surface === 'string' && ['completion', 'history'].includes(raw.recommendation_surface)) clean.recommendation_surface = raw.recommendation_surface;
  if (event === 'practice_audio_error') clean.failure_kind = 'playback_failed';
  if (event.startsWith('practice_') && (!clean.attempt_id || !clean.language_id || (!clean.contrast_id && !['mixed','diagnostic'].includes(String(clean.session_kind))))) return null;
  if (event.startsWith('review_') && (!clean.recommendation_id || !clean.language_id || !clean.contrast_id || !clean.audio_collection || !clean.recommendation_kind || !clean.recommendation_surface)) return null;
  if (event.startsWith('review_practice_') && !clean.attempt_id) return null;
  if (clean.language_id && clean.contrast_id && !String(clean.contrast_id).startsWith(`${clean.language_id}-`)) return null;
  return clean;
}

/** Short-lived, same-tab attribution; never infer a delayed or cross-device return. */
export function recommendationAttribution(raw: unknown, target: EventData, now: number): EventData | null {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(now)) return null;
  const saved = raw as Record<string, unknown>;
  if (saved.version !== 1 || !Number.isSafeInteger(saved.openedAt) || Number(saved.openedAt) > now || now - Number(saved.openedAt) > RECOMMENDATION_WINDOW_MS) return null;
  const clean = measurementData('review_open', saved);
  if (!clean || ['language_id', 'contrast_id', 'audio_collection'].some(key => clean[key] !== target[key])) return null;
  return { recommendation_id: clean.recommendation_id, recommendation_kind: clean.recommendation_kind, recommendation_surface: clean.recommendation_surface };
}

/** Fixed categories only: never collect a search query, arbitrary UTM value or referring path. */
export function acquisitionDetails(referrer: string, origin: string, search = ''): {channel:string;source?:string;medium?:string;campaign?:string} {
  const query = new URLSearchParams(search);
  const sources = ['google','bing','duckduckgo','yahoo','other','reddit','facebook','instagram','tiktok','linkedin','x','youtube','newsletter','refold','partner',...aiSources];
  const mediums = ['organic','social','email','referral','cpc'];
  const rawSource = (query.get('utm_source') || '').toLowerCase();
  const source = aiReferrers[rawSource] || rawSource, medium = query.get('utm_medium') || (aiSources.has(source) ? 'referral' : '');
  const campaign = query.get('utm_campaign') || '';
  if (sources.includes(source) && mediums.includes(medium)) return {channel: aiSources.has(source) && medium === 'referral' ? 'ai_referral' : medium === 'organic' ? 'organic_search' : medium === 'cpc' ? 'paid' : medium, source, medium, ...(['launch','diagnostic','sound-guide','comparison'].includes(campaign) ? {campaign} : {})};
  const channel = acquisitionChannel(referrer, origin);
  if (channel === 'internal' || channel === 'direct' || channel === 'unknown') return {channel};
  try {
    const host = new URL(referrer).hostname;
    const provider = aiSource(host) || (/(^|\.)google\.[a-z.]+$/.test(host) ? 'google' : sources.find(s => host === `${s}.com` || host.endsWith(`.${s}.com`)) || (host === 't.co' ? 'x' : 'other'));
    return {channel, source:provider, medium:channel === 'organic_search' ? 'organic' : channel === 'social' ? 'social' : 'referral'};
  } catch { return {channel:'unknown'}; }
}

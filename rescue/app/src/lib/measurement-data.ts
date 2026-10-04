export const MEASUREMENT_VERSION = 'abx-funnel-v2';
export const MEASUREMENT_EVENTS = ['page_view', 'practice_start', 'practice_first_answer', 'practice_complete', 'practice_audio_error', 'practice_feedback', 'review_shown', 'review_open', 'review_practice_start', 'review_practice_complete'] as const;
export const SESSION_FEEDBACK_CATEGORIES = ['audio_unclear', 'instructions_unclear', 'too_easy', 'too_difficult', 'about_right'] as const;
export type SessionFeedbackCategory = typeof SESSION_FEEDBACK_CATEGORIES[number];
export type MeasurementEvent = typeof MEASUREMENT_EVENTS[number];
export type EventData = Record<string, unknown>;
const languages = new Set(['en', 'fr', 'de', 'es', 'it', 'zh', 'pt', 'ru']);
const languagePages = new Set(['english', 'french', 'german', 'spanish', 'italian', 'mandarin-chinese', 'portuguese', 'russian'].map(id => `/${id}-minimal-pairs`));
const publicPages = new Set(['/', '/practice', '/account', '/pricing', '/teachers', '/method', '/privacy', '/terms', '/restore-access', '/human-audio-preview', '/audio-comparison', '/audio-credits']);
const identifier = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const contrast = /^(en|fr|de|es|it|zh|pt|ru)-[a-z0-9-]{1,55}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const RECOMMENDATION_WINDOW_MS = 30 * 60_000;

/** Never forward query strings, fragments, account identifiers or arbitrary page paths. */
export function measurementPath(value: string) {
  const path = value.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
  if (publicPages.has(path) || languagePages.has(path)) return path;
  if (path.startsWith('/learn/') && contrast.test(path.slice(7))) return path;
  return '/other';
}
export function acquisitionChannel(referrer: string, origin: string) {
  if (!referrer) return 'direct';
  try {
    const url = new URL(referrer); if (url.origin === origin) return 'internal';
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
  for (const [key, max] of [['correct', 100], ['total', 100], ['round', 100], ['duration_ms', 86_400_000]] as const) {
    const n = raw[key]; if (Number.isInteger(n) && Number(n) >= 0 && Number(n) <= max) clean[key] = n;
  }
  if (['start', 'explore', 'revisit', 'review-due'].includes(String(raw.recommendation_kind))) clean.recommendation_kind = raw.recommendation_kind;
  if (['completion', 'history'].includes(String(raw.recommendation_surface))) clean.recommendation_surface = raw.recommendation_surface;
  if (event === 'practice_audio_error') clean.failure_kind = 'playback_failed';
  if (event.startsWith('practice_') && (!clean.attempt_id || !clean.language_id || !clean.contrast_id)) return null;
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

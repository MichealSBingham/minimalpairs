import type { Language } from './types';

type HistoryItem = {
  id: string; mode?: string; schemaVersion?: number; textHintsUsed?: boolean; audioCollectionId?: string;
  completedAt: string; languageId: string; contrastId: string; correct: number; total: number;
};
type Observation = HistoryItem & { time: number };
export type ReviewRecommendation = {
  kind: 'start' | 'explore' | 'revisit' | 'review-due';
  languageId: string; languageName: string; contrastId: string; soundLabel: string; href: string;
  title: string; reason: string; explanation: string; action: string;
};
const DAY = 86_400_000;
const RECENT_WINDOW = 90 * DAY;
// Explicitly opt in compatible ordinary collections. A future version is not
// comparable merely because its identifier shares a prefix. Experimental and
// source-unknown history remains visible elsewhere but never schedules practice.
const ORDINARY_REVIEW_COLLECTIONS = new Set(['qwen-starter-v1']);

/** A transparent practice-order heuristic, never a proficiency or mastery estimate. */
export function recommendReview(languages: Language[], history: readonly HistoryItem[], options: { languageId?: string; now?: number } = {}): ReviewRecommendation | null {
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) return null;
  const available = languages.filter(language => language.contrasts.length > 0);
  if (!available.length) return null;
  const seen = new Set<string>();
  const observations: Observation[] = [];
  for (const item of history) {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || item.mode !== 'abx-cross-word' || item.schemaVersion !== 2) continue;
    if (typeof item.audioCollectionId !== 'string' || !ORDINARY_REVIEW_COLLECTIONS.has(item.audioCollectionId)) continue;
    const time = Date.parse(item.completedAt);
    if (!Number.isFinite(time) || time > now || !Number.isInteger(item.total) || item.total <= 0 || !Number.isInteger(item.correct) || item.correct < 0 || item.correct > item.total) continue;
    if (!available.some(language => language.id === item.languageId && language.contrasts.some(contrast => contrast.id === item.contrastId))) continue;
    seen.add(item.id); observations.push({ ...item, time });
  }
  observations.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const language = available.find(item => item.id === options.languageId)
    || available.find(item => item.id === observations.at(-1)?.languageId) || available[0];
  const records = language.contrasts.map((contrast, position) => {
    const sessions = observations.filter(item => item.languageId === language.id && item.contrastId === contrast.id);
    const unaided = sessions.filter(item => item.textHintsUsed === false && now - item.time <= RECENT_WINDOW).slice(-5);
    const lower = unaided.filter(item => item.correct / item.total < 0.8);
    const repeated = unaided.length >= 3 && unaided.at(-1)!.time - unaided[0].time >= DAY;
    const repeatedLower = repeated && lower.length >= 2 && lower.at(-1)!.time - lower[0].time >= DAY;
    const last = sessions.at(-1);
    const elapsed = last ? now - last.time : Infinity;
    const interval = repeatedLower ? 2 * DAY : 7 * DAY;
    return { contrast, position, sessions, unaided, repeated, repeatedLower, last, elapsed, interval };
  });
  const base = (record: typeof records[number]) => ({
    languageId: language.id, languageName: language.name, contrastId: record.contrast.id,
    soundLabel: `Sound contrast ${String(record.position + 1).padStart(2, '0')}`,
    href: `/practice?language=${encodeURIComponent(language.id)}&contrast=${encodeURIComponent(record.contrast.id)}`,
  });
  const due = records.filter(record => record.repeated && record.elapsed >= record.interval)
    .sort((a, b) => Number(b.repeatedLower) - Number(a.repeatedLower) || b.elapsed / b.interval - a.elapsed / a.interval || a.position - b.position)[0];
  if (due) return {
    ...base(due), kind: 'review-due', title: 'Return to a familiar sound.', action: 'Revisit this sound',
    reason: due.repeatedLower
      ? `Multiple audio-only sessions on different days had scores below 80% for this contrast. Your last practice was ${Math.floor(due.elapsed / DAY)} days ago.`
      : `You have practiced this contrast across different days. It has been ${Math.floor(due.elapsed / DAY)} days since your last session.`,
    explanation: `This suggestion uses ${due.unaided.length} recent sessions from the ordinary audio collection explicitly recorded without text hints. Our simple rule suggests a revisit after two days when at least two scores below 80% are a day apart, otherwise after seven days. It requires at least three audio-only sessions spanning a day. A newer session in the same collection, including one with hints, restarts the interval. Audio comparisons, pilots and records with an unknown audio source are excluded. This is a practice suggestion, not an assessment of ability.`,
  };
  const untried = records.find(record => !record.last);
  const oldest = records.filter(record => record.last).sort((a, b) => b.elapsed - a.elapsed || a.position - b.position)[0];
  if (!oldest) return {
    ...base(records[0]), kind: 'start', title: 'Make your first listening note.', action: 'Start a free session',
    reason: `Try 12 audio-only listening rounds in ${language.name}. No account is needed.`,
    explanation: 'No completed listening sessions from the ordinary audio collection are recorded for this language yet. Earlier word-identification results, audio comparisons, pilots and records with an unknown audio source are not used to choose this review.',
  };
  if (oldest.elapsed >= DAY) return {
    ...base(oldest), kind: 'revisit', title: 'Give a familiar sound another listen.', action: 'Revisit this sound',
    reason: `It has been ${Math.floor(oldest.elapsed / DAY)} ${Math.floor(oldest.elapsed / DAY) === 1 ? 'day' : 'days'} since you last practiced this contrast. A fresh mix is ready.`,
    explanation: 'This is an ordinary revisit based on elapsed time. A single score, text-assisted sessions, and sessions with unrecorded assistance do not establish a recurring difficulty. Only explicitly audio-only results count toward a more targeted suggestion.',
  };
  if (untried) return {
    ...base(untried), kind: 'explore', title: 'A different sound for your next listen.', action: 'Try this sound next',
    reason: 'You have practiced recently. This contrast is still new in your recorded listening history.',
    explanation: 'Your recent result does not label a strength or weakness. This simply offers another contrast in the same language; you can return to the earlier one on another day.',
  };
  return {
    ...base(oldest), kind: 'revisit', title: 'Your next revisit is here when you are.', action: 'Open this sound',
    reason: 'You have practiced all of these contrasts recently. Take a break, or return for another mix whenever you want.',
    explanation: 'Nothing is overdue. This is the contrast you practiced least recently. Recent scores are practice records, not proof of mastery or a stable difficulty.',
  };
}

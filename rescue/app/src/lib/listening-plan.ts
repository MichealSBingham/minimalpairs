import { normalizeSession } from './progress-data.ts';
import type { PracticeSession } from '../components/ui';

export const LISTENING_PLAN_KEY = 'minimalpairs.listening-plan.v1';
export const PLAN_AUDIO_COLLECTION = 'qwen-starter-v1';
export type PlanContrast = { id: string; soundLabel: string; profileCount: number; reviewed: boolean };
export type PlanLanguage = { id: string; name: string; audioCollectionId: typeof PLAN_AUDIO_COLLECTION; contrasts: PlanContrast[] };
export type PlanSlot = { contrastId: string; soundLabel: string; purpose: 'first-listen' | 'return-listen' | 'explore' };
export type ListeningPlan = {
  schemaVersion: 1; id: string; createdAt: string; languageId: string; languageName: string;
  audioCollectionId: typeof PLAN_AUDIO_COLLECTION; slots: [PlanSlot, PlanSlot, PlanSlot];
};
export type PlanCompletion = { sessionId: string; completedAt: string; correct: number; total: 12; textHintsUsed: boolean | undefined; elapsedSincePrevious: number | null };
export type PlanProgress = { completions: (PlanCompletion | null)[]; completed: number; nextIndex: number | null };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const label = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100;

export function normalizeListeningPlan(value: unknown): ListeningPlan | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || !identifier(item.id) || !identifier(item.languageId) || !label(item.languageName)
    || item.audioCollectionId !== PLAN_AUDIO_COLLECTION || typeof item.createdAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T/.test(item.createdAt) || !Number.isFinite(Date.parse(item.createdAt))
    || !Array.isArray(item.slots) || item.slots.length !== 3) return null;
  const purposes = ['first-listen', 'return-listen', 'explore'];
  const slots: PlanSlot[] = [];
  for (const [index, slot] of item.slots.entries()) {
    if (!slot || !identifier(slot.contrastId) || !label(slot.soundLabel) || slot.purpose !== purposes[index]) return null;
    slots.push({ contrastId: slot.contrastId, soundLabel: slot.soundLabel, purpose: slot.purpose });
  }
  if (slots[0].contrastId !== slots[1].contrastId || slots[0].contrastId === slots[2].contrastId) return null;
  return { schemaVersion: 1, id: item.id, createdAt: new Date(item.createdAt).toISOString(), languageId: item.languageId, languageName: item.languageName, audioCollectionId: PLAN_AUDIO_COLLECTION, slots: slots as ListeningPlan['slots'] };
}

/** Three sessions is a transparent planning heuristic, not a tested learning dose. */
export function createListeningPlan(catalog: readonly PlanLanguage[], languageId: string, contrastId: string, options: { id: string; now: number }): ListeningPlan | null {
  const language = catalog.find(item => item.id === languageId && item.audioCollectionId === PLAN_AUDIO_COLLECTION);
  const first = language?.contrasts.find(item => item.id === contrastId);
  const another = language?.contrasts.find(item => item.id !== contrastId);
  if (!language || !first || !another || !Number.isFinite(options.now)) return null;
  return normalizeListeningPlan({ schemaVersion: 1, id: options.id, createdAt: new Date(options.now).toISOString(), languageId, languageName: language.name, audioCollectionId: PLAN_AUDIO_COLLECTION, slots: [
    { contrastId: first.id, soundLabel: first.soundLabel, purpose: 'first-listen' },
    { contrastId: first.id, soundLabel: first.soundLabel, purpose: 'return-listen' },
    { contrastId: another.id, soundLabel: another.soundLabel, purpose: 'explore' },
  ] });
}

export function planIsAvailable(plan: ListeningPlan, catalog: readonly PlanLanguage[]): boolean {
  const language = catalog.find(item => item.id === plan.languageId && item.audioCollectionId === plan.audioCollectionId);
  return !!language && plan.slots.every(slot => language.contrasts.some(contrast => contrast.id === slot.contrastId));
}

/** Match completed device records chronologically; never backfill an earlier slot. */
export function derivePlanProgress(plan: ListeningPlan, history: readonly unknown[], now = Date.now()): PlanProgress {
  const completions: (PlanCompletion | null)[] = [null, null, null];
  const created = Date.parse(plan.createdAt);
  if (!Number.isFinite(now) || created > now) return { completions, completed: 0, nextIndex: 0 };
  const unique = new Map<string, PracticeSession>();
  const conflicts = new Set<string>();
  for (const value of history) {
    const session = normalizeSession(value);
    if (!session) continue;
    const previous = unique.get(session.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(session)) conflicts.add(session.id);
    else unique.set(session.id, session);
  }
  const sessions = [...unique.values()].filter(session => !conflicts.has(session.id)
    && session.total === 12 && session.mistakes.length === 12 - session.correct
    && session.languageId === plan.languageId && session.audioCollectionId === plan.audioCollectionId
    && Date.parse(session.completedAt) > created && Date.parse(session.completedAt) <= now)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
  let completed = 0;
  let last = created;
  for (const session of sessions) {
    const time = Date.parse(session.completedAt);
    if (completed === 3) break;
    if (session.contrastId !== plan.slots[completed].contrastId || time <= last) continue;
    completions[completed] = { sessionId: session.id, completedAt: session.completedAt, correct: session.correct, total: 12,
      textHintsUsed: session.textHintsUsed, elapsedSincePrevious: completed ? time - last : null };
    last = time;
    completed += 1;
  }
  return { completions, completed, nextIndex: completed === 3 ? null : completed };
}

export function planPracticeHref(plan: ListeningPlan, index: number): string | null {
  const slot = plan.slots[index];
  return slot ? `/practice?language=${encodeURIComponent(plan.languageId)}&contrast=${encodeURIComponent(slot.contrastId)}` : null;
}

export function loadListeningPlan(storage: Pick<Storage, 'getItem'>): { plan: ListeningPlan | null; error: string | null } {
  try {
    const raw = storage.getItem(LISTENING_PLAN_KEY);
    if (!raw) return { plan: null, error: null };
    const plan = normalizeListeningPlan(JSON.parse(raw));
    return plan ? { plan, error: null } : { plan: null, error: 'This device’s saved plan could not be read. You can replace it with a new plan; your practice history stays available.' };
  } catch { return { plan: null, error: 'This browser could not load your saved plan. You can try saving a new one; your practice history is separate.' }; }
}

export function saveListeningPlan(storage: Storage, plan: ListeningPlan): void {
  const valid = normalizeListeningPlan(plan);
  if (!valid) throw new Error('This plan could not be saved. Please choose the language and starting sound again.');
  try {
    const serialized = JSON.stringify(valid);
    storage.setItem(LISTENING_PLAN_KEY, serialized);
    if (storage.getItem(LISTENING_PLAN_KEY) !== serialized) throw new Error('Storage did not retain the plan.');
  } catch { throw new Error('This browser could not save the plan. Try again or continue ordinary practice; your practice history has not been changed.'); }
}

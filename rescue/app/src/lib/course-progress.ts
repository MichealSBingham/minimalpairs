import type { Contrast } from './types';
import type { PracticeSession } from '../components/ui';
export type CourseMode = 'abx-cross-word' | 'word-identification';
export const courseModes: CourseMode[] = ['abx-cross-word', 'word-identification'];
type CourseSession = PracticeSession & { purpose?: string };
export function courseProgress(contrasts: Contrast[], sessions: CourseSession[], languageId: string, fullAccess: boolean) {
  const seen = new Set<string>();
  const valid = sessions.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return s.languageId === languageId && s.audioCollectionId?.startsWith('chatterbox-') && (s.mode !== 'abx-cross-word' || s.textHintsUsed === false) && courseModes.includes(s.mode as CourseMode) && s.purpose !== 'diagnostic' && !s.id.startsWith('diagnostic-') && Number.isFinite(s.total) && s.total > 0 && Number.isFinite(s.correct) && s.correct >= 0 && s.correct <= s.total && Number.isFinite(Date.parse(s.completedAt));
  }).sort((a,b) => Date.parse(a.completedAt)-Date.parse(b.completedAt));
  const steps = contrasts.flatMap((contrast,index) => courseModes.map(mode => {
    const history = valid.filter(s => s.contrastId === contrast.id && s.mode === mode);
    const recent = history.slice(-5);
    const total = recent.reduce((n,s)=>n+s.total,0);
    const correct = recent.reduce((n,s)=>n+s.correct,0);
    // Completion means a finished focused exercise, not mastery or a diagnostic score.
    const completed = history.some(s => s.total >= 6 && s.purpose !== 'mixed' && !s.id.startsWith('mixed-') && (mode === 'word-identification' || s.textHintsUsed === false));
    return {contrast, mode, index, history, completed, locked: !fullAccess && index >= 3, total, correct, rate: total ? correct/total : null};
  }));
  const next = steps.find(s=>!s.locked&&!s.completed) ?? null;
  const mistakes = valid.slice().reverse().flatMap(s => (s.mistakes ?? []).map(m => ({...m, contrastId:s.contrastId,mode:s.mode as CourseMode}))).filter(m=>contrasts.some(c=>c.id===m.contrastId)).slice(0,8);
  const trends = courseModes.map(mode => ({mode, sessions: valid.filter(s=>s.mode===mode && contrasts.some(c=>c.id===s.contrastId)).slice(-10)}));
  const ranked = steps.filter(s=>s.total>=6 && s.rate!==null).sort((a,b)=>a.rate!-b.rate!);
  return {steps,next,trends,mistakes, completed:steps.filter(s=>s.completed).length, needsPractice:ranked.filter(s=>s.rate!<.8).slice(0,3), strengths:[...ranked].reverse().filter(s=>s.rate!>=.8).slice(0,3)};
}

export function nextCourseStep(contrasts: Contrast[], sessions: CourseSession[], languageId: string, fullAccess: boolean) { return courseProgress(contrasts,sessions,languageId,fullAccess).next; }

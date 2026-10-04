import type { Contrast } from './types';
import type { PracticeSession } from '../components/ui';
export type JourneyMode = 'focused' | 'mixed' | 'diagnostic';
export function journeyStats(contrasts: Contrast[], sessions: PracticeSession[], languageId: string, activityMode: 'abx-cross-word'|'word-identification' = 'abx-cross-word') {
  return contrasts.map(contrast => {
    const eligible = sessions.filter(s => s.languageId === languageId && s.contrastId === contrast.id && s.mode === activityMode && (activityMode === 'word-identification' || s.textHintsUsed === false) && s.purpose !== 'diagnostic' && !s.id.startsWith('diagnostic-') && s.audioCollectionId?.startsWith('chatterbox-'));
    const history = [...eligible].sort((a,b) => (a.completedAt || '').localeCompare(b.completedAt || '')).slice(-6);
    const total = history.reduce((n,s) => n + s.total, 0);
    const correct = history.reduce((n,s) => n + s.correct, 0);
    return { contrast, total, correct, practiced: eligible.filter(s => !s.id.startsWith('diagnostic-') && !s.id.startsWith('mixed-')).reduce((n,s) => n+s.total,0) >= 12, rate: total ? correct / total : null };
  });
}
export function selectJourneyContrasts(contrasts: Contrast[], sessions: PracticeSession[], languageId: string, fullAccess: boolean, mode: JourneyMode, selected: string, activityMode: 'abx-cross-word'|'word-identification' = 'abx-cross-word') {
  const available = contrasts.filter((_,i) => fullAccess || i < 3);
  if (mode === 'focused') return available.filter(c => c.id === selected);
  if (mode === 'diagnostic') return available;
  return journeyStats(available, sessions, languageId, activityMode).sort((a,b) => (a.rate ?? -1) - (b.rate ?? -1) || a.total - b.total).slice(0,3).map(s => s.contrast);
}

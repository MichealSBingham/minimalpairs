import type { PracticeSession, Progress } from '../components/ui';

/** Accept only the completed current session schema this app can safely synchronize. */
export function normalizeSession(value: unknown): PracticeSession | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const identifier = (text: unknown) => typeof text === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(text);
  if (!identifier(item.id) || !identifier(item.languageId) || !identifier(item.contrastId)
    || !['abx-cross-word', 'word-identification'].includes(item.mode as string) || item.schemaVersion !== 2
    || (item.mode === 'word-identification' && item.textHintsUsed !== true)
    || (item.purpose !== undefined && !['focused', 'mixed', 'diagnostic'].includes(item.purpose as string))
    || typeof item.completedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(item.completedAt) || !Number.isFinite(Date.parse(item.completedAt))
    || !Number.isInteger(item.correct) || !Number.isInteger(item.total)
    || (item.total as number) < 1 || (item.total as number) > 100
    || (item.correct as number) < 0 || (item.correct as number) > (item.total as number)
    || (item.textHintsUsed !== undefined && typeof item.textHintsUsed !== 'boolean')
    || (item.audioCollectionId !== undefined && !identifier(item.audioCollectionId))
    || !Array.isArray(item.mistakes) || item.mistakes.length > 100) return null;
  const mistakes: PracticeSession['mistakes'] = [];
  for (const mistake of item.mistakes) {
    if (!mistake || typeof mistake !== 'object' || !identifier(mistake.pairId)
      || typeof mistake.word !== 'string' || mistake.word.length > 120
      || typeof mistake.chosenWord !== 'string' || mistake.chosenWord.length > 120) return null;
    const detail: Record<string,string> = {};
    for (const key of ['correctWord','heardIpa','chosenIpa','correctIpa']) {
      if (mistake[key] !== undefined) {
        if (typeof mistake[key] !== 'string' || mistake[key].length > 120) return null;
        detail[key] = mistake[key];
      }
    }
    mistakes.push({ ...detail, pairId: mistake.pairId, word: mistake.word, chosenWord: mistake.chosenWord });
  }
  return {
    id: item.id as string, mode: item.mode as PracticeSession['mode'], schemaVersion: 2,
    ...(item.purpose ? { purpose: item.purpose as PracticeSession['purpose'] } : {}),
    completedAt: new Date(item.completedAt).toISOString(), languageId: item.languageId as string,
    contrastId: item.contrastId as string, correct: item.correct as number, total: item.total as number,
    mistakes, ...(typeof item.textHintsUsed === 'boolean' ? { textHintsUsed: item.textHintsUsed } : {}),
    ...(typeof item.audioCollectionId === 'string' ? { audioCollectionId: item.audioCollectionId } : {}),
  };
}

export function validSessions(values: unknown): PracticeSession[] {
  if (!Array.isArray(values)) return [];
  const byId = new Map<string, PracticeSession>();
  for (const value of values) { const session = normalizeSession(value); if (session) byId.set(session.id, session); }
  return [...byId.values()].sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id)).slice(-1000);
}

/** Server versions win a duplicate ID; never count a repeated upload twice. */
export function mergeAccountProgress(local: Progress, remote: readonly PracticeSession[]): Progress {
  const sessions = validSessions([...validSessions(local.sessions), ...remote]);
  return {
    sessions,
    ...(local.preferredLanguage ? { preferredLanguage: local.preferredLanguage } : sessions.length ? { preferredLanguage: sessions.at(-1)!.languageId } : {}),
    ...(local.nativeLanguage ? { nativeLanguage: local.nativeLanguage } : {}),
  };
}

export function missingAccountSessions(local: Progress, remote: readonly PracticeSession[]): PracticeSession[] {
  const known = new Set(remote.map(session => session.id));
  return validSessions(local.sessions).filter(session => !known.has(session.id));
}

import { collection, doc, getDocsFromServer, limit, orderBy, query, setDoc, writeBatch } from 'firebase/firestore';
import { getDatabase, getSession } from './auth';
import { mergeAccountProgress, missingAccountSessions, normalizeSession, validSessions } from './progress-data';
import type { PracticeSession, Progress } from '../components/ui';

const SYNC_KEY = 'minimalpairs.account-sync.v1';
const TIMEOUT_MS = 15000;
export type AccountProgress = { progress: Progress; accountId: string; syncEnabled: boolean };

function enabledFor(accountId: string) {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(SYNC_KEY) === accountId; }
  catch { return false; }
}
export function disconnectDeviceHistory(accountId: string) {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(SYNC_KEY) === accountId) window.localStorage.removeItem(SYNC_KEY);
    if (window.localStorage.getItem(SYNC_KEY) === accountId) throw new Error('Preference is still enabled');
  } catch { throw new Error('This browser could not turn off automatic saving. Please retry or sign out to stop account saves.'); }
}
async function identity() {
  const session = await getSession();
  if (!session?.user.email_verified) throw new Error('Sign in with a verified account to connect practice history.');
  const db = getDatabase();
  if (!db) throw new Error('Account history is not configured. Your device history is still available.');
  return { accountId: session.user.id, db };
}
async function sameAccount(accountId: string) {
  const current = await getSession();
  if (current?.user.id !== accountId || !current.user.email_verified) throw new Error('Your signed-in account changed. Please try again.');
}
async function confirmed<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The account update could not be confirmed. Your device history is safe; retry when connected.')), TIMEOUT_MS);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function cloudSessions(db: NonNullable<ReturnType<typeof getDatabase>>, accountId: string) {
  const result = await confirmed(getDocsFromServer(query(collection(db, 'users', accountId, 'sessions'), orderBy('completedAt', 'desc'), limit(1000))));
  return validSessions(result.docs.flatMap(item => {
    const value = normalizeSession(item.data());
    return value && value.id === item.id ? [value] : [];
  }));
}

/** Sign-in permits reading your cloud history; it never uploads device history. */
export async function loadAccountProgress(local: Progress): Promise<AccountProgress> {
  const { db, accountId } = await identity();
  const remote = await cloudSessions(db, accountId);
  await sameAccount(accountId);
  return { progress: mergeAccountProgress(local, remote), accountId, syncEnabled: true };
}

/** Explicitly attach this device's completed ABX sessions to the current account. */
export async function connectDeviceHistory(local: Progress): Promise<AccountProgress & { uploaded: number; syncEnabled: true }> {
  const { db, accountId } = await identity();
  const remote = await cloudSessions(db, accountId);
  const missing = missingAccountSessions(local, remote);
  for (let offset = 0; offset < missing.length; offset += 100) {
    await sameAccount(accountId);
    const batch = writeBatch(db);
    for (const session of missing.slice(offset, offset + 100)) batch.set(doc(db, 'users', accountId, 'sessions', session.id), session);
    await confirmed(batch.commit());
  }
  await sameAccount(accountId);
  try { window.localStorage.setItem(SYNC_KEY, accountId); }
  catch { throw new Error('Your history was saved to your account, but this browser cannot remember automatic sync. Use Save history again after practicing.'); }
  return { progress: mergeAccountProgress(local, [...remote, ...missing]), accountId, syncEnabled: true, uploaded: missing.length };
}

/** Local completion always succeeds independently; callers show only confirmed cloud saves. */
export async function saveCompletedSession(value: PracticeSession): Promise<'saved' | 'disabled'> {
  const session = await getSession();
  if (!session?.user.email_verified) return 'disabled';
  const normalized = normalizeSession(value);
  if (!normalized) throw new Error('This practice record could not be synchronized. Your device copy remains available.');
  const db = getDatabase();
  if (!db) throw new Error('Account history is not configured.');
  const accountId = session.user.id;
  await sameAccount(accountId);
  await confirmed(setDoc(doc(db, 'users', accountId, 'sessions', normalized.id), normalized));
  await sameAccount(accountId);
  return 'saved';
}

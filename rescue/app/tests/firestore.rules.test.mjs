import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';

// This suite never connects to a real project. Run inside `firebase emulators:exec`.
const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = 'demo-minimalpairs-security';
const email = 'buyer@example.invalid';
let env;
let owner;
let stranger;
let unverified;
let anonymous;
const validSession = {
  id: 'session-1', completedAt: '2026-09-28T12:00:00.000Z', languageId: 'fr',
  contrastId: 'fr-u-y', correct: 8, total: 10, mistakes: ['tout/tu'],
};
const abxSession = { ...validSession, mode: 'abx-cross-word', schemaVersion: 2 };

describe('Firestore isolation and server-owned entitlement rules', { skip: !host && 'Run with the Firestore emulator to execute security tests' }, () => {
  before(async () => {
    assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/, 'Only a local emulator is allowed');
    setLogLevel('silent'); // Expected denied writes should not flood the test output.
    const [hostname, port] = host.split(':');
    env = await initializeTestEnvironment({
      projectId,
      firestore: { host: hostname, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
    });
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'legacyEntitlements', email), { active: true, plan: 'lifetime', purchaseIds: ['ch_synthetic'] });
      await setDoc(doc(db, 'entitlements', 'buyer'), { active: true, plan: 'annual', currentPeriodEnd: 2000000000 });
      await setDoc(doc(db, 'users', 'buyer', 'sessions', 'session-1'), validSession);
    });
    owner = env.authenticatedContext('buyer', { email, email_verified: true }).firestore();
    stranger = env.authenticatedContext('other', { email: 'other@example.invalid', email_verified: true }).firestore();
    unverified = env.authenticatedContext('buyer', { email, email_verified: false }).firestore();
    anonymous = env.unauthenticatedContext().firestore();
  });
  after(async () => { if (env) await env.cleanup(); });

  it('lets a verified buyer read only their own lifetime grant, including case-normalized email', async () => {
    const result = await assertSucceeds(getDoc(doc(owner, 'legacyEntitlements', email)));
    assert.equal(result.data().plan, 'lifetime');
    const upper = env.authenticatedContext('buyer', { email: 'Buyer@Example.Invalid', email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(upper, 'legacyEntitlements', email)));
  });
  it('denies wrong-email, unverified and unauthenticated lifetime reads', async () => {
    for (const db of [stranger, unverified, anonymous]) await assertFails(getDoc(doc(db, 'legacyEntitlements', email)));
  });
  it('does not accept an email claim without explicit verification', async () => {
    const db = env.authenticatedContext('buyer', { email }).firestore();
    await assertFails(getDoc(doc(db, 'legacyEntitlements', email)));
  });
  it('denies lifetime grant listing, even to the verified buyer', async () => {
    await assertFails(getDocs(collection(owner, 'legacyEntitlements')));
  });
  it('denies browser-created lifetime grants', async () => {
    await assertFails(setDoc(doc(stranger, 'legacyEntitlements', 'other@example.invalid'), { active: true, plan: 'lifetime' }));
  });
  it('denies browser updates and deletion of existing lifetime grants', async () => {
    const ref = doc(owner, 'legacyEntitlements', email);
    await assertFails(updateDoc(ref, { active: false }));
    await assertFails(deleteDoc(ref));
  });
  it('lets verified users read only their own subscription', async () => {
    await assertSucceeds(getDoc(doc(owner, 'entitlements', 'buyer')));
    for (const db of [stranger, unverified, anonymous]) await assertFails(getDoc(doc(db, 'entitlements', 'buyer')));
  });
  it('denies subscription listing and all browser grant mutations', async () => {
    await assertFails(getDocs(collection(owner, 'entitlements')));
    await assertFails(setDoc(doc(stranger, 'entitlements', 'other'), { active: true, plan: 'annual' }));
    await assertFails(updateDoc(doc(owner, 'entitlements', 'buyer'), { currentPeriodEnd: 9999999999 }));
    await assertFails(deleteDoc(doc(owner, 'entitlements', 'buyer')));
  });
  it('permits verified own-session reads and listing', async () => {
    await assertSucceeds(getDoc(doc(owner, 'users', 'buyer', 'sessions', 'session-1')));
    await assertSucceeds(getDocs(collection(owner, 'users', 'buyer', 'sessions')));
  });
  it('denies session reads and listing across users and for unverified accounts', async () => {
    for (const db of [stranger, unverified, anonymous]) {
      await assertFails(getDoc(doc(db, 'users', 'buyer', 'sessions', 'session-1')));
      await assertFails(getDocs(collection(db, 'users', 'buyer', 'sessions')));
    }
  });
  it('accepts valid own ABX sessions with explicit schema version', async () => {
    await assertSucceeds(setDoc(doc(owner, 'users', 'buyer', 'sessions', 'session-abx'), { ...abxSession, id: 'session-abx' }));
  });
  it('accepts identification schema2 and preserves its purpose', async () => {
    const id = 'identification'; const ref = doc(owner, 'users', 'buyer', 'sessions', id);
    await assertSucceeds(setDoc(ref, { ...abxSession, id, mode: 'word-identification', textHintsUsed: true, purpose: 'focused' }));
    assert.equal((await getDoc(ref)).data().purpose, 'focused');
    for (const db of [stranger, unverified, anonymous]) await assertFails(setDoc(doc(db, 'users', 'buyer', 'sessions', 'forged-identification'), { ...abxSession, id: 'forged-identification', mode: 'word-identification', textHintsUsed: true, purpose: 'focused' }));
  });
  for (const patch of [{schemaVersion: 1}, {textHintsUsed: false}, {purpose: 'unknown'}]) {
    it(`rejects unsupported identification ${JSON.stringify(patch)}`, async () => {
      await assertFails(setDoc(doc(owner, 'users', 'buyer', 'sessions', 'bad-identification'), { ...abxSession, id: 'bad-identification', mode: 'word-identification', textHintsUsed: true, ...patch }));
    });
  }
  it('accepts and preserves either boolean text-hint value on ABX sessions', async () => {
    for (const textHintsUsed of [false, true]) {
      const id = `hints-${textHintsUsed}`;
      const ref = doc(owner, 'users', 'buyer', 'sessions', id);
      await assertSucceeds(setDoc(ref, { ...abxSession, id, textHintsUsed }));
      assert.equal((await getDoc(ref)).data().textHintsUsed, textHintsUsed);
    }
  });
  it('rejects new writes in the legacy unspecified schema', async () => {
    const id = 'legacy-no-hints';
    await assertFails(setDoc(doc(owner, 'users', 'buyer', 'sessions', id), { ...validSession, id }));
  });
  it('preserves an optional declared audio collection without inferring older sources', async () => {
    const id = 'human-audio-session';
    const ref = doc(owner, 'users', 'buyer', 'sessions', id);
    await assertSucceeds(setDoc(ref, { ...abxSession, id, audioCollectionId: 'human-fr-u-y-v1' }));
    assert.equal((await getDoc(ref)).data().audioCollectionId, 'human-fr-u-y-v1');
  });
  for (const textHintsUsed of ['true', 1, null, [], {}]) {
    it(`rejects non-boolean text-hint value ${JSON.stringify(textHintsUsed)}`, async () => {
      const ref = doc(owner, 'users', 'buyer', 'sessions', 'invalid-hints');
      await assertFails(setDoc(ref, { ...abxSession, id: 'invalid-hints', textHintsUsed }));
    });
  }
  it('allows identical retries and deletion but prevents overwriting completed results', async () => {
    const ref = doc(owner, 'users', 'buyer', 'sessions', 'session-update');
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'buyer', 'sessions', 'session-update'), { ...abxSession, id: 'session-update' });
    });
    await assertSucceeds(setDoc(ref, { ...abxSession, id: 'session-update' }));
    await assertFails(updateDoc(ref, { correct: 9 }));
    await assertFails(updateDoc(ref, { textHintsUsed: false }));
    await assertSucceeds(deleteDoc(ref));
  });
  it('denies session writes across users and for unverified accounts', async () => {
    for (const db of [stranger, unverified, anonymous]) {
      await assertFails(setDoc(doc(db, 'users', 'buyer', 'sessions', 'forged'), { ...abxSession, id: 'forged' }));
      await assertFails(updateDoc(doc(db, 'users', 'buyer', 'sessions', 'session-1'), { correct: 10 }));
      await assertFails(deleteDoc(doc(db, 'users', 'buyer', 'sessions', 'session-1')));
    }
  });
  for (const [label, patch] of [
    ['mismatched document id', { id: 'wrong-id' }],
    ['non-string completion time', { completedAt: 1 }],
    ['non-string language', { languageId: 1 }],
    ['non-string contrast', { contrastId: {} }],
    ['fractional score', { correct: 1.5 }],
    ['negative score', { correct: -1 }],
    ['score over total', { correct: 11 }],
    ['zero total', { total: 0, correct: 0 }],
    ['unbounded total', { total: 101 }],
    ['non-list mistakes', { mistakes: 'x' }],
    ['unbounded mistakes', { mistakes: Array(101).fill('x') }],
    ['client privilege field', { active: true }],
    ['unknown practice mode', { mode: 'administrator' }],
    ['unknown schema version', { schemaVersion: 999 }],
    ['non-string audio collection', { audioCollectionId: 7 }],
    ['unsafe audio collection', { audioCollectionId: '../unknown' }],
  ]) {
    it(`denies invalid session: ${label}`, async () => {
      await assertFails(setDoc(doc(owner, 'users', 'buyer', 'sessions', 'invalid'), { ...abxSession, id: 'invalid', ...patch }));
    });
  }
  it('preserves diagnostic length metadata and rejects invalid values', async () => {
    const ref=doc(owner,'users','buyer','sessions','diagnostic-length');
    await assertSucceeds(setDoc(ref,{...abxSession,id:'diagnostic-length',purpose:'diagnostic',diagnosticLength:'full',diagnosticVersion:'diagnostic-v2',diagnosticGroups:32,diagnosticExperimentVariant:'paid'}));
    for(const [i,patch] of [{diagnosticLength:'bogus'},{diagnosticGroups:0},{diagnosticVersion:'bogus'},{diagnosticExperimentVariant:'bogus'}].entries()){
      const id='invalid-diagnostic-'+i;
      await assertFails(setDoc(doc(owner,'users','buyer','sessions',id),{...abxSession,id,purpose:'diagnostic',...patch}));
    }
  });
  it('requires all session fields', async () => {
    const data = { ...abxSession, id: 'missing' };
    delete data.correct;
    await assertFails(setDoc(doc(owner, 'users', 'buyer', 'sessions', 'missing'), data));
  });
  it('denies unrelated collections by default', async () => {
    await assertFails(getDoc(doc(owner, 'private', 'configuration')));
    await assertFails(setDoc(doc(owner, 'private', 'configuration'), { injected: true }));
  });
});

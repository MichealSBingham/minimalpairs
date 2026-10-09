import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as data from '../src/lib/measurement-data.ts';

const CHOICE = 'minimalpairs.analytics-choice.v1';
const attempt = '00000000-0000-4000-8000-000000000001';
const recommendationId = '00000000-0000-4000-8000-000000000002';
const PENDING = 'minimalpairs.analytics-recommendation.v1';
const trial = { language_id: 'fr', contrast_id: 'fr-u-y', audio_collection: 'qwen-starter-v1', total: 12, text_hints_used: false };
const suggestion = { language_id: 'fr', contrast_id: 'fr-u-y', audio_collection: 'qwen-starter-v1', recommendation_id: recommendationId, recommendation_kind: 'revisit', recommendation_surface: 'history' };
function client(options = {}) {
  const storage = options.storage || new Map(options.choice ? [[CHOICE, options.choice]] : []);
  const session = options.session || new Map();
  const scripts = [], cookies = [];
  const events = new EventTarget();
  const window = {
    location: { origin: 'https://minimalpairs.web.app', hostname: 'minimalpairs.web.app', pathname: '/practice', search: '?email=private@example.invalid', hash: '#secret' },
    localStorage: { getItem: key => { if (options.blockStorageRead) throw Error('blocked'); return storage.get(key) ?? null; }, setItem: (key, value) => { if (options.blockStorageWrite) throw Error('blocked'); storage.set(key, value); } },
    sessionStorage: {
      getItem: key => { if (options.blockSessionStorage) throw Error('blocked'); return session.get(key) ?? null; },
      setItem: (key, value) => { if (options.blockSessionStorage) throw Error('blocked'); session.set(key, value); },
      removeItem: key => { if (options.blockSessionStorage || options.blockSessionRemove) throw Error('blocked'); session.delete(key); },
    },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
  };
  const document = {
    documentElement: { dataset: { measurementId: options.configured === false ? '' : 'G-TEST123', measurementEnvironment: options.environment || 'preview' } },
    referrer: 'https://www.google.com/search?q=private',
    head: { append: script => { if (options.blockScript) throw Error('blocked'); scripts.push(script); } },
    createElement: () => ({ dataset: {} }),
    get cookie() { return '_ga=existing; _ga_TEST123=existing; session=keep'; },
    set cookie(value) { cookies.push(value); },
  };
  const navigator = { doNotTrack: options.dnt, globalPrivacyControl: options.gpc, webdriver: options.webdriver };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/measurement.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', 'window', 'document', 'navigator', 'Event', compiled)(name => { assert.equal(name, './measurement-data'); return data; }, exports, window, document, navigator, Event);
  const calls = () => (window.dataLayer || []).map(args => Array.from(args));
  const measured = () => calls().filter(call => call[0] === 'event');
  const storageEvent = key => { const event = new Event('storage'); Object.defineProperty(event, 'key', { value: key }); window.dispatchEvent(event); };
  return { api: exports, scripts, cookies, window, document, storage, session, calls, measured, storageEvent };
}

test('measurement remains absent before consent and after declining', () => {
  const c = client(); c.api.initializeMeasurement();
  c.api.startMeasuredPractice(attempt, trial); c.api.measuredFirstAnswer(attempt, false);
  c.api.setAnalyticsChoice('declined'); c.api.completeMeasuredPractice(attempt, { correct: 8, total: 12 });
  assert.deepEqual(c.scripts, []); assert.deepEqual(c.calls(), []);
  assert.equal(c.api.analyticsChoice(), 'declined');
});

test('allowed measurement loads once, sanitizes page details, and denies advertising', () => {
  const c = client(); assert.equal(c.api.setAnalyticsChoice('allowed'), true); c.api.initializeMeasurement(); c.api.initializeMeasurement();
  assert.equal(c.scripts.length, 1);
  const config = c.calls().find(call => call[0] === 'config')[2];
  assert.equal(config.send_page_view, false); assert.equal(config.allow_google_signals, false); assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(config.page_location, 'https://minimalpairs.web.app/practice'); assert.equal(config.page_referrer, ''); assert.equal(config.debug_mode, true);
  assert.equal(c.measured().filter(call => call[1] === 'page_view').length, 1);
  assert.doesNotMatch(JSON.stringify(c.calls()), /private|@|secret/);
  assert.deepEqual(c.calls()[0], ['consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
});

test('production omits debug_mode entirely so the developer filter cannot discard customers', () => {
  const c = client({ choice: 'allowed', environment: 'production' }); c.api.initializeMeasurement();
  c.api.startMeasuredPractice(attempt, trial);
  const config = c.calls().find(call => call[0] === 'config')[2];
  assert.equal(config.environment, 'production'); assert.equal('debug_mode' in config, false);
  assert.ok(c.measured().every(call => !('debug_mode' in call[2])));
});

for (const preference of [{ dnt: '1' }, { gpc: true }]) test(`browser privacy preference prevents tag loading: ${JSON.stringify(preference)}`, () => {
  const c = client({ choice: 'allowed', ...preference }); c.api.initializeMeasurement(); c.api.setAnalyticsChoice('allowed');
  c.api.startMeasuredPractice(attempt, trial);
  assert.equal(c.api.browserDeclinesAnalytics(), true); assert.deepEqual(c.scripts, []); assert.deepEqual(c.calls(), []);
});

test('missing configuration or blocked storage fails closed', () => {
  for (const options of [{ configured: false }, { blockStorageRead: true }]) {
    const c = client({ choice: 'allowed', ...options }); c.api.initializeMeasurement(); c.api.startMeasuredPractice(attempt, trial);
    assert.deepEqual(c.scripts, []); assert.deepEqual(c.calls(), []);
  }
  const c = client({ choice: 'allowed', blockStorageWrite: true });
  assert.equal(c.api.setAnalyticsChoice('declined'), false); assert.equal(c.api.trackMeasurement('page_view'), false);
  assert.deepEqual(c.scripts, []);
});

test('events count each start, first answer, per-round error and completion once', () => {
  const c = client({ choice: 'allowed' });
  for (let i = 0; i < 2; i++) {
    c.api.startMeasuredPractice(attempt, trial); c.api.measuredFirstAnswer(attempt, true); c.api.measuredAudioFailure(attempt, 2); c.api.completeMeasuredPractice(attempt, { correct: 8, total: 12, text_hints_used: true });
  }
  assert.deepEqual(c.measured().map(call => call[1]), ['practice_start', 'practice_first_answer', 'practice_audio_error', 'practice_complete']);
  assert.equal(c.measured().at(-1)[2].text_hints_used, true);
  assert.equal(c.measured().at(-1)[2].correct, 8);
  assert.equal(c.measured()[2][2].round, 2);
});

test('late opt-in does not invent an unobserved start or count its completion', () => {
  const c = client(); c.api.startMeasuredPractice(attempt, trial); c.api.setAnalyticsChoice('allowed');
  c.api.measuredFirstAnswer(attempt, false); c.api.completeMeasuredPractice(attempt, { correct: 8, total: 12 });
  assert.deepEqual(c.measured().map(call => call[1]), ['page_view']);
});

test('withdrawal stops events, forgets active attempts and only clears GA cookies', () => {
  const c = client({ choice: 'allowed' }); c.api.initializeMeasurement(); c.api.startMeasuredPractice(attempt, trial);
  const count = c.measured().length;
  c.api.setAnalyticsChoice('declined'); c.api.measuredFirstAnswer(attempt, false); c.api.completeMeasuredPractice(attempt, { correct: 8, total: 12 });
  assert.equal(c.measured().length, count); assert.equal(c.window['ga-disable-G-TEST123'], true);
  assert.ok(c.cookies.length > 0); assert.ok(c.cookies.every(cookie => /^_ga(?:_|=)/.test(cookie)));
  c.api.setAnalyticsChoice('allowed'); c.api.completeMeasuredPractice(attempt, { correct: 8, total: 12 });
  assert.equal(c.measured().length, count);
});

test('another tab declining or clearing storage disables ongoing measurement', () => {
  for (const key of [CHOICE, null]) {
    const c = client({ choice: 'allowed' }); c.api.initializeMeasurement(); c.api.startMeasuredPractice(attempt, trial);
    c.storage.clear(); c.storageEvent(key); const count = c.measured().length;
    c.api.completeMeasuredPractice(attempt, { correct: 8, total: 12 });
    assert.equal(c.window['ga-disable-G-TEST123'], true); assert.equal(c.measured().length, count);
    assert.equal(c.calls().at(-1)[2].analytics_storage, 'denied');
  }
});

test('tag failures cannot interrupt the practice caller', () => {
  const c = client({ choice: 'allowed', blockScript: true });
  assert.doesNotThrow(() => c.api.startMeasuredPractice(attempt, trial));
  assert.equal(c.api.trackMeasurement('page_view'), false);
  assert.deepEqual(c.measured(), []);
  c.window.gtag = () => { throw Error('extension'); };
  assert.equal(c.api.trackMeasurement('page_view'), false);
  assert.doesNotThrow(() => c.api.completeMeasuredPractice(attempt, { total: 12, correct: 12 }));
});

test('data allowlist discards personal fields, unknown events and malformed attempts', () => {
  const clean = data.measurementData('practice_start', { ...trial, attempt_id: attempt, email: 'private@example.invalid', answer: 'tout', error: 'private URL', url: 'https://private.invalid' });
  assert.doesNotMatch(JSON.stringify(clean), /private|tout/);
  assert.equal(data.measurementData('purchase', { email: 'private@example.invalid' }), null);
  assert.equal(data.measurementData('practice_start', { ...trial, attempt_id: '-'.repeat(36) }), null);
  assert.equal(data.measurementData('practice_start', { ...trial, language_id: 'unknown', attempt_id: attempt }), null);
  assert.equal(data.measurementPath('/auth/action?oobCode=secret'), '/other');
  assert.equal(data.measurementPath('/practice?email=private#secret'), '/practice');
  assert.equal(data.measurementPath('/learn/fr-u-y?secret=1'), '/learn/fr-u-y');
  assert.equal(data.measurementPath('/accounts/private@example.invalid'), '/other');
  assert.equal(data.acquisitionChannel('https://www.google.com/search?q=private', 'https://minimalpairs.web.app'), 'organic_search');
});

test('a followed suggestion attributes exactly one matching attempt across page navigation', () => {
  const c = client({ choice: 'allowed' });
  assert.equal(c.api.openMeasuredRecommendation({ ...suggestion, email: 'private@example.invalid', url: '/private' }, true), true);
  assert.equal(c.api.openMeasuredRecommendation(suggestion, true), false);
  assert.deepEqual(c.measured(), []);
  assert.doesNotMatch(c.session.get(PENDING), /private|email|url/);
  const nextPage = client({ storage: c.storage, session: c.session });
  nextPage.window.location.search = '?language=fr&contrast=fr-u-y&private_probe=never-send';
  nextPage.api.initializeMeasurement();
  nextPage.api.startMeasuredPractice(attempt, trial);
  nextPage.api.startMeasuredPractice(attempt, trial);
  nextPage.api.measuredFirstAnswer(attempt, false);
  nextPage.api.completeMeasuredPractice(attempt, { total: 12, correct: 7 });
  nextPage.api.completeMeasuredPractice(attempt, { total: 12, correct: 7 });
  assert.deepEqual(nextPage.measured().map(call => call[1]), ['page_view', 'review_open', 'practice_start', 'review_practice_start', 'practice_first_answer', 'practice_complete', 'review_practice_complete']);
  assert.ok(nextPage.measured().filter(call => call[1] !== 'page_view').every(call => call[2].recommendation_id === recommendationId));
  assert.equal(nextPage.session.has(PENDING), false);
  nextPage.api.startMeasuredPractice('00000000-0000-4000-8000-000000000003', trial);
  assert.equal(nextPage.measured().filter(c=>c[1]==='practice_start').at(-1)[1], 'practice_start');
  assert.equal(nextPage.measured().at(-1)[2].recommendation_id, undefined);
});

test('starting another language, contrast, collection or surface consumes without attribution', () => {
  for (const changed of [{ language_id: 'en', contrast_id: 'en-i-ih' }, { contrast_id: 'fr-an-on' }, { audio_collection: 'comparison-human-v1' }, { path: '/audio-comparison' }]) {
    const c = client({ choice: 'allowed' }); c.api.openMeasuredRecommendation(suggestion, true);
    if (changed.path) c.window.location.pathname = changed.path;
    c.api.startMeasuredPractice(attempt, { ...trial, ...changed });
    assert.equal(c.measured().filter(call => call[1] === 'review_practice_start').length, 0);
    assert.equal(c.measured().at(-1)[2].recommendation_id, undefined);
    assert.equal(c.session.has(PENDING), false);
  }
});

test('expired, future, malformed and mismatched recommendation records cannot attribute a session', () => {
  const now = Date.now();
  for (const saved of [null, 'bad', { ...suggestion, version: 2, openedAt: now }, { ...suggestion, version: 1, openedAt: now + 1 }, { ...suggestion, version: 1, openedAt: now - data.RECOMMENDATION_WINDOW_MS - 1 }, { ...suggestion, version: 1, openedAt: now, language_id: 'en' }, { ...suggestion, version: 1, openedAt: now, recommendation_id: 'not-an-id' }]) {
    assert.equal(data.recommendationAttribution(saved, trial, now), null);
  }
  assert.equal(data.recommendationAttribution({ ...suggestion, version: 1, openedAt: now - data.RECOMMENDATION_WINDOW_MS }, trial, now).recommendation_id, recommendationId);
  const c = client({ choice: 'allowed', session: new Map([[PENDING, '{invalid']]) });
  assert.doesNotThrow(() => c.api.startMeasuredPractice(attempt, trial));
  assert.equal(c.measured().at(-1)[2].recommendation_id, undefined);
});

test('new-tab clicks and unavailable storage cannot fabricate arrival or attribution', () => {
  for (const options of [{ sameTab: false }, { blockSessionStorage: true }, { blockSessionRemove: true }]) {
    const c = client({ choice: 'allowed', ...options });
    assert.doesNotThrow(() => c.api.openMeasuredRecommendation(suggestion, options.sameTab !== false));
    c.api.startMeasuredPractice(attempt, trial);
    assert.deepEqual(c.measured().map(call => call[1]), ['practice_start']);
    assert.equal(c.measured().at(-1)[2].recommendation_id, undefined);
  }
});

test('modified clicks do not arm attribution and a later ordinary click can arm it once', () => {
  const c = client({ choice: 'allowed' });
  assert.equal(c.api.openMeasuredRecommendation(suggestion, false), false);
  assert.equal(Number(c.session.has(PENDING)), 0);
  assert.equal(c.api.openMeasuredRecommendation(suggestion, true), true);
  assert.deepEqual(c.measured(), []);
  c.window.location.search = '?language=fr&contrast=fr-u-y';
  c.api.initializeMeasurement();
  c.api.startMeasuredPractice(attempt, trial);
  assert.equal(c.measured().at(-1)[1], 'review_practice_start');
  assert.equal(c.api.openMeasuredRecommendation(suggestion, true), false);
  assert.equal(Number(c.session.has(PENDING)), 0);
});

test('arrival is counted on the matching destination once across reloads, without navigation delays', () => {
  const c = client({ choice: 'allowed' });
  c.api.openMeasuredRecommendation(suggestion, true);
  const wrongPage = client({ storage: c.storage, session: c.session });
  wrongPage.window.location.search = '?language=de&contrast=de-u-ue'; wrongPage.api.initializeMeasurement();
  assert.equal(wrongPage.measured().filter(call => call[1] === 'review_open').length, 0);
  const arrived = client({ storage: c.storage, session: c.session });
  arrived.window.location.search = '?language=fr&contrast=fr-u-y&email=never-send'; arrived.api.initializeMeasurement();
  assert.equal(arrived.measured().filter(call => call[1] === 'review_open').length, 1);
  assert.doesNotMatch(JSON.stringify(arrived.measured()), /never-send|event_callback|event_timeout/);
  const reloaded = client({ storage: c.storage, session: c.session });
  reloaded.window.location.search = arrived.window.location.search; reloaded.api.initializeMeasurement();
  assert.equal(reloaded.measured().filter(call => call[1] === 'review_open').length, 0);
  reloaded.api.startMeasuredPractice(attempt, trial);
  assert.equal(reloaded.measured().at(-1)[1], 'review_practice_start');
});

test('consent withdrawal and browser privacy preferences clear suggestion attribution', () => {
  const c = client({ choice: 'allowed' }); c.api.initializeMeasurement(); c.api.openMeasuredRecommendation(suggestion, true);
  c.api.setAnalyticsChoice('declined'); assert.equal(c.session.has(PENDING), false);
  c.api.setAnalyticsChoice('allowed'); c.api.startMeasuredPractice(attempt, trial);
  assert.equal(c.measured().at(-1)[2].recommendation_id, undefined);
  const d = client({ choice: 'allowed' }); d.api.initializeMeasurement(); d.api.openMeasuredRecommendation(suggestion, true);
  d.storage.clear(); d.storageEvent(CHOICE); assert.equal(d.session.has(PENDING), false);
  for (const options of [{}, { choice: 'declined' }, { choice: 'allowed', dnt: '1' }, { choice: 'allowed', gpc: true }]) {
    const privateClient = client(options);
    assert.equal(privateClient.api.openMeasuredRecommendation(suggestion, true), false);
    assert.deepEqual(privateClient.measured(), []); assert.equal(privateClient.session.size, 0);
  }
});

test('invalid data cannot arm attribution and a blocked tag does not block navigation intent', () => {
  const c = client({ choice: 'allowed' });
  for (const malformed of [{ ...suggestion, recommendation_id: undefined }, { ...suggestion, recommendation_kind: 'anything' }, { ...suggestion, language_id: 'en' }]) assert.equal(c.api.openMeasuredRecommendation(malformed, true), false);
  assert.equal(Number(c.session.has(PENDING)), 0);
  const failed = client({ choice: 'allowed', blockScript: true });
  assert.equal(failed.api.openMeasuredRecommendation(suggestion, true), true);
  failed.window.location.search = '?language=fr&contrast=fr-u-y'; failed.api.initializeMeasurement();
  assert.deepEqual(failed.measured(), []);
  assert.equal(data.measurementData('review_practice_complete', suggestion), null);
});


test('a diverted or generic visit cannot attribute an unconfirmed destination arrival', () => {
  const c = client({ choice: 'allowed' }); c.api.openMeasuredRecommendation(suggestion, true);
  const generic = client({ storage: c.storage, session: c.session });
  generic.window.location.search = '?language=fr'; generic.api.initializeMeasurement();
  generic.api.startMeasuredPractice(attempt, trial);
  assert.equal(generic.measured().filter(call => call[1].startsWith('review_')).length, 0);
  assert.equal(generic.measured().at(-1)[2].recommendation_id, undefined);
  assert.equal(generic.session.has(PENDING), false);
});

const feedback = { ...trial, attempt_id: attempt, feedback_category: 'audio_unclear' };
test('session feedback is absent without consent, with unavailable configuration and under browser privacy preferences', () => {
  for (const options of [{}, { choice: 'declined' }, { choice: 'allowed', configured: false }, { choice: 'allowed', dnt: '1' }, { choice: 'allowed', gpc: true }, { choice: 'allowed', blockStorageRead: true }]) {
    const c = client(options);
    assert.notEqual(c.api.sessionFeedbackPermission(), 'allowed');
    assert.equal(c.api.shareSessionFeedback(feedback), 'off');
    assert.deepEqual(c.calls(), []); assert.deepEqual(c.scripts, []); assert.equal(Number(c.session.has(PENDING)), 0);
  }
});
test('feedback accepts only one fixed category and the exact privacy-safe session fields', () => {
  const raw = { ...feedback, email: 'private@example.invalid', uid: 'private-user', comment: 'private message', word: 'tout', correct: 8, text_hints_used: false, recommendation_id: recommendationId, recommendation_kind: 'revisit' };
  const clean = data.measurementData('practice_feedback', raw);
  assert.deepEqual(clean, { measurement_version: data.MEASUREMENT_VERSION, attempt_id: attempt, language_id: 'fr', contrast_id: 'fr-u-y', audio_collection: 'qwen-starter-v1', feedback_category: 'audio_unclear' });
  for (const change of [{ feedback_category: 'private@example.invalid' }, { feedback_category: ['too_easy', 'too_difficult'] }, { attempt_id: undefined }, { audio_collection: undefined }, { language_id: 'en' }]) assert.equal(data.measurementData('practice_feedback', { ...feedback, ...change }), null);
  for (const category of data.SESSION_FEEDBACK_CATEGORIES) assert.equal(data.measurementData('practice_feedback', { ...feedback, feedback_category: category }).feedback_category, category);
});
test('feedback queues once per completion even after repeated clicks, new category or consent toggle', () => {
  const c = client({ choice: 'allowed' });
  assert.equal(c.api.shareSessionFeedback(feedback), 'queued');
  assert.equal(c.api.shareSessionFeedback(feedback), 'duplicate');
  assert.equal(c.api.shareSessionFeedback({ ...feedback, feedback_category: 'too_easy' }), 'duplicate');
  c.api.setAnalyticsChoice('declined'); assert.equal(c.api.shareSessionFeedback(feedback), 'off');
  c.api.setAnalyticsChoice('allowed'); assert.equal(c.api.shareSessionFeedback(feedback), 'duplicate');
  const rows = c.measured().filter(row => row[1] === 'practice_feedback'); assert.equal(rows.length, 1);
  assert.equal(rows[0][2].feedback_category, 'audio_unclear'); assert.equal(rows[0][2].attempt_id, attempt);
  assert.equal(Number(c.session.has(PENDING)), 0); assert.deepEqual([...c.storage.keys()], [CHOICE]);
});
test('late consent never sends an earlier feedback choice or invents practice funnel events', () => {
  const c = client();
  assert.equal(c.api.shareSessionFeedback(feedback), 'off');
  c.api.setAnalyticsChoice('allowed'); assert.deepEqual(c.measured().map(row => row[1]), ['page_view']);
  assert.equal(c.api.shareSessionFeedback(feedback), 'queued');
  assert.deepEqual(c.measured().map(row => row[1]), ['page_view', 'practice_feedback']);
  assert.equal(c.api.shareSessionFeedback({ ...feedback, attempt_id: recommendationId, feedback_category: 'about_right' }), 'queued');
});
test('unqueueable feedback reports failure and withdrawal in another tab blocks submission', () => {
  const failed = client({ choice: 'allowed', blockScript: true });
  assert.equal(failed.api.shareSessionFeedback(feedback), 'unavailable'); assert.deepEqual(failed.measured(), []);
  const noTag = client({ choice: 'allowed' }); noTag.api.initializeMeasurement(); delete noTag.window.gtag;
  assert.equal(noTag.api.shareSessionFeedback(feedback), 'unavailable');
  assert.equal(noTag.measured().filter(row => row[1] === 'practice_feedback').length, 0);
  const c = client({ choice: 'allowed' }); c.api.initializeMeasurement(); c.storage.set(CHOICE, 'declined'); c.storageEvent(CHOICE);
  assert.equal(c.api.shareSessionFeedback(feedback), 'off'); assert.equal(c.measured().filter(row => row[1] === 'practice_feedback').length, 0);
});

test('owner exclusion blocks saved consent and propagates across tabs',()=>{
 const c=client({choice:'allowed'});assert.equal(c.api.setAnalyticsExcluded(true),true);c.api.initializeMeasurement();c.api.setAnalyticsChoice('allowed');c.api.startMeasuredPractice(attempt,trial);assert.deepEqual(c.scripts,[]);assert.deepEqual(c.measured(),[]);
 const other=client({choice:'allowed'});other.api.initializeMeasurement();const n=other.measured().length;other.storage.set('minimalpairs.analytics-excluded.v1','true');other.storageEvent('minimalpairs.analytics-excluded.v1');assert.equal(other.window['ga-disable-G-TEST123'],true);other.api.trackMeasurement('page_view');assert.equal(other.measured().length,n);
});
test('localhost is excluded and removing exclusion never grants consent',()=>{
 const c=client({choice:'allowed'});c.window.location.hostname='127.0.0.1';c.api.initializeMeasurement();assert.deepEqual(c.scripts,[]);
 const owner=client({choice:'allowed'});owner.api.setAnalyticsExcluded(true);owner.api.setAnalyticsExcluded(false);assert.equal(owner.api.analyticsChoice(),'declined');assert.equal(owner.api.trackMeasurement('page_view'),false);
});
test('prefixed attempt IDs, Japanese, full diagnostics and localized paths are recognized',()=>{
 const d={attempt_id:'diagnostic-'+attempt,language_id:'ja',session_kind:'diagnostic',activity_mode:'abx-cross-word',total:108,correct:90};assert.ok(data.measurementData('practice_start',d));assert.equal(data.measurementData('practice_complete',d).total,108);
 for(const p of ['/ja/learn/ja-a-o','/fr/diagnostic/en','/es/pricing','/japanese-minimal-pairs'])assert.equal(data.measurementPath(p+'?email=private@example.com'),p);assert.equal(data.measurementPath('/fr/private@example.com'),'/other');
});
test('diagnostic events require an observed consented start',()=>{
 const c=client();const d={attempt_id:'diagnostic-'+attempt,language_id:'ja',session_kind:'diagnostic'};c.api.startMeasuredPractice(d.attempt_id,d);c.api.setAnalyticsChoice('allowed');assert.equal(c.api.trackMeasuredPracticeEvent('diagnostic_complete',d),false);c.api.startMeasuredPractice(d.attempt_id,d);assert.equal(c.api.trackMeasuredPracticeEvent('diagnostic_complete',d),true);c.api.setAnalyticsChoice('declined');assert.equal(c.api.trackMeasuredPracticeEvent('diagnostic_complete',d),false);
});
test('acquisition preserves source without raw referrers or arbitrary UTM',()=>{
 const c=client({choice:'allowed'});c.api.initializeMeasurement();assert.equal(c.measured()[0][2].campaign_source,'google');assert.equal(c.measured()[0][2].campaign_medium,'organic');assert.equal(c.measured()[0][2].page_referrer,'');
 const next=client({storage:c.storage,session:c.session});next.document.referrer='https://minimalpairs.web.app/learn/fr-u-y';next.api.initializeMeasurement();assert.equal(next.measured()[0][2].campaign_source,'google');assert.deepEqual(data.acquisitionDetails('', 'https://minimalpairs.co','?utm_source=private@example.com&utm_medium=email'),{channel:'direct'});
 const evil=client({choice:'allowed',session:new Map([['minimalpairs.analytics-acquisition.v1',JSON.stringify({at:Date.now(),values:{channel:'social',source:'private@example.com',medium:'email'}})]])});evil.document.referrer='https://minimalpairs.web.app/';evil.api.initializeMeasurement();assert.doesNotMatch(JSON.stringify(evil.calls()),/private@example/);
});
test('business payloads discard words, identity, payment IDs and error text',()=>{
 for(const event of ['plan_selected','begin_checkout','checkout_error','audio_report_submitted','support_submitted','guide_audio_play','plans_view']){const clean=data.measurementData(event,{plan:'lifetime',language_id:'es',reason:'noise',topic:'billing',email:'private@example.com',word:'cosa',uid:'secret',transaction_id:'secret',error:'secret'});assert.ok(clean);assert.doesNotMatch(JSON.stringify(clean),/private|secret|cosa/);}
});

test('checkout attribution is coarse, consented, and excluded for owner traffic', () => {
  const c = client(); assert.equal(c.api.checkoutAttribution(), undefined);
  c.api.setAnalyticsChoice('allowed');
  assert.deepEqual(c.api.checkoutAttribution(), {landing_page:'/practice',source:'google',medium:'organic',ui_locale:'en'});
  c.api.setAnalyticsExcluded(true); assert.equal(c.api.checkoutAttribution(), undefined);
});
test('Yahoo acquisition survives billing return without leaking queries', () => {
  const c = client({choice:'allowed'}); c.document.referrer='https://search.yahoo.com/search?p=secret';
  assert.equal(c.api.checkoutAttribution().source,'yahoo');
  c.document.referrer='https://checkout.stripe.com/c/pay/private';
  assert.deepEqual(c.api.checkoutAttribution(),{landing_page:'/practice',source:'yahoo',medium:'organic',ui_locale:'en'});
});
test('enum payloads cannot smuggle nested free text via string coercion', () => {
  const nested = {toString:()=> 'monthly',email:'private@example.invalid'};
  assert.equal(data.measurementData('begin_checkout',{plan:nested}),null);
  assert.equal(data.measurementData('plans_view',{surface:{toString:()=> 'pricing',email:'private@example.invalid'}}).surface,undefined);
});

test('WebDriver browsers never emit analytics even with prior consent', () => {
 const c=client({choice:'allowed',webdriver:true}); c.api.initializeMeasurement(); c.api.startMeasuredPractice(attempt,trial); assert.deepEqual(c.calls(),[]); assert.equal(c.api.checkoutAttribution(),undefined);
});

test('AI discovery uses fixed provider labels, never prompts or referring paths', () => {
  const hosts = {'chatgpt.com':'chatgpt','chat.openai.com':'chatgpt','claude.ai':'claude','www.perplexity.ai':'perplexity','copilot.microsoft.com':'copilot','gemini.google.com':'gemini'};
  for (const [host, source] of Object.entries(hosts)) {
    const referrer=`https://${host}/private-conversation?prompt=secret`;
    assert.deepEqual(data.acquisitionDetails(referrer,'https://minimalpairs.co'), {channel:'ai_referral',source,medium:'referral'});
    const c=client({choice:'allowed'});c.document.referrer=referrer;c.api.initializeMeasurement();
    assert.equal(c.measured()[0][2].acquisition_channel,'ai_referral');
    assert.equal(c.measured()[0][2].campaign_source,source);
    c.document.referrer='https://minimalpairs.web.app/pricing';
    assert.deepEqual(c.api.checkoutAttribution(),{landing_page:'/practice',source,medium:'referral',ui_locale:'en'});
    assert.doesNotMatch(JSON.stringify(c.calls()),/private-conversation|prompt|secret/);
  }
});
test('AI UTM links work without referrers and spoofed domains are not AI', () => {
  assert.deepEqual(data.acquisitionDetails('','https://minimalpairs.co','?utm_source=chatgpt.com'),{channel:'ai_referral',source:'chatgpt',medium:'referral'});
  assert.deepEqual(data.acquisitionDetails('','https://minimalpairs.co','?utm_source=claude&utm_medium=referral'),{channel:'ai_referral',source:'claude',medium:'referral'});
  for(const host of ['evilchatgpt.com','chatgpt.com.evil.test','google.com']) assert.notEqual(data.acquisitionDetails(`https://${host}/`,'https://minimalpairs.co').channel,'ai_referral');
  assert.deepEqual(data.acquisitionDetails('','https://minimalpairs.co','?utm_source=someone@example.com'),{channel:'direct'});
});


test('landing attribution retains the first consented public page through checkout and strips private URL data', () => {
 const c=client({choice:'allowed'});
 c.window.location.pathname='/fr/learn/fr-u-y'; c.api.initializeMeasurement();
 c.window.location.pathname='/pricing'; c.document.referrer='https://minimalpairs.web.app/fr/learn/fr-u-y';
 assert.equal(c.api.checkoutAttribution().landing_page,'/fr/learn/fr-u-y');
 assert.ok(c.measured().every(call=>call[2].landing_page==='/fr/learn/fr-u-y'));
 c.api.setAnalyticsChoice('declined'); assert.equal(c.session.has('minimalpairs.analytics-landing.v1'),false);
 c.window.location.pathname='/pricing'; c.document.referrer=''; c.api.setAnalyticsChoice('allowed');
 assert.equal(c.api.checkoutAttribution().landing_page,'/pricing');
});
test('late consent never reconstructs an earlier landing and malformed or expired storage is discarded', () => {
 const c=client(); c.window.location.pathname='/learn/fr-u-y';c.api.initializeMeasurement();
 assert.equal(c.session.has('minimalpairs.analytics-landing.v1'),false);
 c.window.location.pathname='/pricing';c.api.setAnalyticsChoice('allowed');
 assert.equal(c.api.checkoutAttribution().landing_page,'/pricing');
 for(const stored of [{at:Date.now()-31*60000,page:'/learn/fr-u-y'},{at:Date.now()+10000,page:'/learn/fr-u-y'},{at:Date.now(),page:'/learn/en-private-customer-name'}]) {
  c.session.set('minimalpairs.analytics-landing.v1',JSON.stringify(stored));
  assert.equal(c.api.checkoutAttribution().landing_page,'/pricing');
 }
 c.api.setAnalyticsExcluded(true);assert.equal(c.session.has('minimalpairs.analytics-landing.v1'),false);
});
test('fixed landing route allowlist excludes account details, invented guide IDs and external URLs',()=>{
 assert.equal(data.landingPath('/fr/learn/fr-u-y/?email=private@example.com#token'),'/fr/learn/fr-u-y');
 for(const path of ['/account','/restore-access','/learn/en-private-customer-name','https://minimalpairs.co/pricing','//evil.test','/pricing/extra','/learn/en-%40private'])assert.equal(data.landingPath(path),undefined);
});

test('checkout recovery requires a supported plan and excludes customer identifiers',()=>{
 assert.equal(data.measurementData('checkout_resumed',{}),null);
 const payload=data.measurementData('checkout_resumed',{plan:'lifetime',surface:'pricing',email:'private@example.com',session_id:'secret'});
 assert.equal(payload.plan,'lifetime'); assert.equal(payload.email,undefined); assert.equal(payload.session_id,undefined);
});

for (const [referrer,source,medium,channel] of [
  ['https://www.google.com/search?q=private','google','organic','organic_search'],
  ['https://www.reddit.com/r/French/comments/private','reddit','social','social'],
  ['https://chatgpt.com/c/private','chatgpt','referral','ai_referral'],
]) test(`discovery source survives consented navigation and checkout: ${source}`, () => {
  const c=client({choice:'allowed',environment:'production'});c.document.referrer=referrer;
  c.window.location.pathname='/french-minimal-pairs';c.window.location.search='';
  c.api.initializeMeasurement();
  const config=c.calls().find(call=>call[0]==='config')[2];
  assert.equal(config.campaign_source,source);assert.equal(config.campaign_medium,medium);
  assert.equal(config.acquisition_channel,channel);assert.equal(config.page_referrer,'');
  assert.equal(config.acquisition_source,source);assert.equal(config.acquisition_medium,medium);
  c.document.referrer='https://minimalpairs.web.app/french-minimal-pairs';c.window.location.pathname='/practice';
  const attribution=c.api.checkoutAttribution();
  assert.equal(attribution.source,source);assert.equal(attribution.medium,medium);
  assert.equal(attribution.landing_page,'/french-minimal-pairs');
  assert.doesNotMatch(JSON.stringify(c.calls()), /q=private|comments\/private|c\/private/);
  c.api.setAnalyticsChoice('declined');assert.equal(c.api.checkoutAttribution(),undefined);
});

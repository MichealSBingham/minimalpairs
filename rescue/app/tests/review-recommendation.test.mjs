import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendReview } from '../src/lib/review-recommendation.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-28T12:00:00Z');
const languages = ['fr', 'es'].map(id => ({ id, name: id === 'fr' ? 'French' : 'Spanish', contrasts: [1, 2, 3].map(index => ({ id: `${id}-${index}`, label: `Secret word ${index}` })) }));
let id = 0;
const session = (days, correct = 6, extra = {}) => ({ id: `session-${++id}`, mode: 'abx-cross-word', schemaVersion: 2, textHintsUsed: false, audioCollectionId: 'qwen-starter-v1', completedAt: new Date(NOW - days * DAY).toISOString(), languageId: 'fr', contrastId: 'fr-1', correct, total: 12, ...extra });
const choose = (history, extra = {}) => recommendReview(languages, history, { now: NOW, ...extra });

test('a new learner gets an exact free contrast link without exposing words', () => {
  const result = choose([]);
  assert.equal(result.kind, 'start');
  assert.equal(result.href, '/practice?language=fr&contrast=fr-1');
  assert.equal(result.soundLabel, 'Sound contrast 01');
  assert.ok(!JSON.stringify(result).includes('Secret word'));
});

test('old identification and incomplete or invalid records do not influence ABX recommendations', () => {
  const invalid = [session(4, 6, { mode: 'word-identification' }), session(5, 6, { schemaVersion: undefined }), session(-1), session(1, 99), session(1, 2, { total: 0 }), session(1, 3.5), session(1, 6, { completedAt: 'invalid' }), session(1, 6, { contrastId: 'removed' })];
  assert.equal(choose(invalid).kind, 'start');
});

test('hint-assisted and unrecorded assistance never establish repeated lower performance', () => {
  for (const textHintsUsed of [true, undefined]) {
    const result = choose([session(8, 0, { textHintsUsed }), session(6, 0, { textHintsUsed }), session(3, 0, { textHintsUsed })]);
    assert.equal(result.kind, 'revisit');
    assert.ok(!result.reason.includes('below 80%'));
  }
});

test('repeated unaided lower results across days prioritize a due contrast', () => {
  const result = choose([session(12, 6), session(8, 7), session(3, 9), session(11, 12, { contrastId: 'fr-2' }), session(10, 12, { contrastId: 'fr-2' }), session(9, 12, { contrastId: 'fr-2' })]);
  assert.equal(result.kind, 'review-due');
  assert.equal(result.contrastId, 'fr-1');
  assert.ok(result.reason.includes('Multiple audio-only sessions'));
});

test('one low score among otherwise higher scores does not trigger a short interval', () => {
  const result = choose([session(8, 12), session(5, 12), session(3, 0)]);
  assert.equal(result.kind, 'revisit');
  assert.ok(!result.reason.includes('below 80%'));
});

test('several results from one day do not create cross-day evidence', () => {
  assert.equal(choose([session(3.3), session(3.2), session(3.1)]).kind, 'revisit');
  assert.equal(choose([session(8, 12), session(3.2), session(3.1)]).kind, 'revisit');
});

test('a recent session including hints restarts the interval and suggests another contrast', () => {
  const result = choose([session(9), session(6), session(3), session(0, 3, { textHintsUsed: true })]);
  assert.equal(result.kind, 'explore');
  assert.equal(result.contrastId, 'fr-2');
});

test('a first completed session gets an ordinary revisit after a day, never a weakness label', () => {
  assert.equal(choose([session(2, 0)]).kind, 'revisit');
  assert.equal(choose([session(0, 0)]).kind, 'explore');
});

test('routine repeated practice can be revisited after seven days without a mastery claim', () => {
  const result = choose([session(12, 12), session(10, 12), session(7, 12)]);
  assert.equal(result.kind, 'review-due');
  assert.ok(!result.reason.includes('below 80%'));
});

test('language selection is respected and invalid preferences fall back to latest valid history', () => {
  const history = [session(4, 6, { languageId: 'es', contrastId: 'es-2' })];
  assert.equal(choose(history, { languageId: 'fr' }).languageId, 'fr');
  assert.equal(choose(history, { languageId: 'es' }).contrastId, 'es-2');
  assert.equal(choose(history, { languageId: 'removed' }).languageId, 'es');
});

test('deduplicated and stale evidence cannot manufacture a targeted suggestion', () => {
  const repeated = session(3);
  assert.equal(choose([repeated, repeated, repeated]).kind, 'revisit');
  assert.equal(choose([session(100), session(99), session(3)]).kind, 'revisit');
});

test('recently practiced complete collections offer an optional least-recent revisit', () => {
  const result = choose([session(0.5), session(0.3, 9, { contrastId: 'fr-2' }), session(0, 10, { contrastId: 'fr-3' })]);
  assert.equal(result.contrastId, 'fr-1');
  assert.ok(result.reason.includes('Take a break'));
  assert.ok(result.explanation.includes('Nothing is overdue'));
});

test('empty curriculum and invalid clocks produce no broken link', () => {
  assert.equal(recommendReview([], [], { now: NOW }), null);
  assert.equal(recommendReview([{ id: 'fr', contrasts: [] }], [], { now: NOW }), null);
  assert.equal(choose([], { now: NaN }), null);
});

test('comparison, pilot, unknown and unapproved future collections never mark ordinary contrasts practiced', () => {
  for (const audioCollectionId of ['comparison-generated-v1', 'comparison-human-v1', 'comparison-fixed-reference-v1', 'human-fr-u-y-v1', 'human-en-i-ih-v1', undefined, '', 'qwen-starter-v2']) {
    const history = [session(8, 0, { audioCollectionId }), session(6, 0, { audioCollectionId }), session(3, 0, { audioCollectionId })];
    const result = choose(history);
    assert.equal(result.kind, 'start', String(audioCollectionId));
    assert.equal(result.contrastId, 'fr-1');
    assert.ok(result.explanation.includes('ordinary audio collection'));
  }
});

test('different audio conditions cannot combine into repeated lower performance', () => {
  const result = choose([
    session(8, 0),
    session(6, 0, { audioCollectionId: 'comparison-human-v1' }),
    session(3, 0, { audioCollectionId: 'comparison-fixed-reference-v1' }),
  ]);
  assert.equal(result.kind, 'revisit');
  assert.ok(result.reason.includes('8 days'));
  assert.ok(!result.reason.includes('below 80%'));
});

test('unknown-source historical records cannot supplement ordinary performance evidence', () => {
  const result = choose([session(8, 0, { audioCollectionId: undefined }), session(6, 0), session(3, 0)]);
  assert.equal(result.kind, 'revisit');
  assert.ok(!result.reason.includes('below 80%'));
});

test('an experimental or unknown-source recent session does not postpone a due ordinary review', () => {
  for (const audioCollectionId of ['comparison-generated-v1', 'human-fr-u-y-v1', undefined]) {
    const result = choose([session(9), session(6), session(3), session(0, 12, { audioCollectionId, textHintsUsed: true })]);
    assert.equal(result.kind, 'review-due');
    assert.ok(result.reason.includes('3 days'));
  }
});

test('the first ordinary completion after comparison suggests the next unpracticed ordinary contrast', () => {
  const result = choose([
    session(3, 0, { audioCollectionId: 'comparison-human-v1', contrastId: 'fr-2' }),
    session(2, 0, { audioCollectionId: 'comparison-generated-v1', contrastId: 'fr-3' }),
    session(0),
  ]);
  assert.equal(result.kind, 'explore');
  assert.equal(result.contrastId, 'fr-2');
});

test('excluded sources cannot choose the default language but an explicit language still applies', () => {
  const history = [session(0, 0, { audioCollectionId: 'comparison-human-v1', languageId: 'es', contrastId: 'es-2' })];
  assert.equal(choose(history).languageId, 'fr');
  assert.equal(choose(history, { languageId: 'es' }).languageId, 'es');
  assert.equal(choose(history, { languageId: 'es' }).kind, 'start');
  assert.equal(choose([...history, session(3)]).languageId, 'fr');
});

test('an excluded-source record cannot hide an ordinary record through ID deduplication', () => {
  const ordinary = session(3);
  const result = choose([{ ...ordinary, audioCollectionId: 'comparison-human-v1' }, ordinary]);
  assert.equal(result.kind, 'revisit');
});

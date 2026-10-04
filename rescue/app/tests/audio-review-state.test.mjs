import test from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../src/lib/audio-review-state.ts';

const old = '2026-09-30T10:00:00.000Z';
const recent = '2026-09-30T11:00:00.000Z';
const item = (status = 'pass', note = 'Owner listened.', updatedAt = old) => ({ status, note, updatedAt });
const state = (clipReviews = {}, groupReviews = {}) => ({ schemaVersion: 1, clipReviews, groupReviews });
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('empty reviews and JSON backups round-trip without sharing mutable objects', () => {
  const first = review.emptyReviewState();
  first.clipReviews['clip:sha1'] = item();
  assert.deepEqual(review.emptyReviewState(), state());
  const parsed = review.parseReviewState(JSON.stringify(first));
  assert.deepEqual(parsed, first);
  parsed.clipReviews['clip:sha1'].note = 'Changed copy';
  assert.equal(first.clipReviews['clip:sha1'].note, 'Owner listened.');
});

test('exact current inventory identities exclude unknown and changed-hash passes', () => {
  const backup = state({ 'word:old-sha': item(), 'word:current-sha': item('fix'), unrelated: item() }, {
    'contrast:old-fingerprint': item(), 'contrast:current-fingerprint': item('unsure'),
  });
  const parsed = review.parseReviewStateWithReport(backup, ['word:current-sha'], ['contrast:current-fingerprint']);
  assert.deepEqual(parsed.state, state({ 'word:current-sha': item('fix') }, { 'contrast:current-fingerprint': item('unsure') }));
  assert.equal(parsed.skippedUnknownClips, 2);
  assert.equal(parsed.skippedUnknownGroups, 1);
  assert.deepEqual(review.parseReviewState(backup, [], []), state());
  assert.deepEqual(review.parseReviewState(backup), backup, 'archive parsing preserves unknown IDs only without allowlists');
});

test('malformed envelopes fail; invalid statuses, dates and notes cannot become a pass', () => {
  for (const value of [null, [], {}, '{', state([], {}), { ...state(), schemaVersion: 2 }, new Date()]) {
    assert.equal(review.parseReviewState(value), null);
  }
  const invalid = [
    item('approved'), item({ toString: null }), item('pass', 1), item('pass', '', 'tomorrow'),
    item('pass', '', '2026-02-30T10:00:00.000Z'), item('pass', '', '2026-09-30T25:00:00.000Z'),
    item('pass', '', '2026-09-30T10:00:00'), item('pass', '', '2026-09-30'), null, [],
  ];
  const parsed = review.parseReviewStateWithReport(state(Object.fromEntries(invalid.map((value, index) => [`bad-${index}`, value]))));
  assert.deepEqual(parsed.state, state());
  assert.equal(parsed.skippedInvalidClips, invalid.length);
});

test('calendar-valid timestamps normalize for chronological merges and notes are bounded', () => {
  const parsed = review.parseReviewState(state({
    leap: item('pass', 'a'.repeat(2001), '2024-02-29T10:00:00Z'),
    offset: item('fix', 'Unicode boundary ' + 'a'.repeat(1982) + '😀', '2026-09-30T07:00:00.12-04:00'),
  }));
  assert.equal(parsed.clipReviews.leap.updatedAt, '2024-02-29T10:00:00.000Z');
  assert.equal(parsed.clipReviews.leap.note.length, 2000);
  assert.equal(parsed.clipReviews.offset.updatedAt, '2026-09-30T11:00:00.120Z');
  assert.ok(parsed.clipReviews.offset.note.length <= 2000);
  assert.doesNotMatch(parsed.clipReviews.offset.note, /[\uD800-\uDBFF]$/);
});

test('prototype keys and accessor objects cannot pollute state or execute during import', () => {
  const payload = JSON.parse('{"schemaVersion":1,"clipReviews":{"__proto__":{"status":"pass","note":"pwn","updatedAt":"2026-09-30T10:00:00.000Z"},"constructor":{"status":"pass","note":"pwn","updatedAt":"2026-09-30T10:00:00.000Z"},"prototype":{"status":"pass","note":"pwn","updatedAt":"2026-09-30T10:00:00.000Z"}},"groupReviews":{}}');
  const parsed = review.parseReviewStateWithReport(payload);
  assert.deepEqual(parsed.state, state());
  assert.equal(parsed.skippedInvalidClips, 3);
  assert.equal({}.status, undefined);
  let calls = 0;
  const getters = state({ accessor: { get status() { calls++; return 'pass'; }, note: '', updatedAt: old } });
  Object.defineProperty(getters.clipReviews, 'entry', { enumerable: true, get() { calls++; return item(); } });
  assert.deepEqual(review.parseReviewState(getters), state());
  assert.equal(calls, 0);
  const inherited = Object.create({ schemaVersion: 1, clipReviews: {}, groupReviews: {} });
  assert.equal(review.parseReviewState(inherited), null);
});

test('merge keeps unrelated reviews, picks timestamps rather than approval status and keeps ties', () => {
  const existing = state({ stale: item('pass'), tied: item('fix'), preserved: item('unsure') }, { group: item('pass') });
  const incoming = state({ stale: item('fix', 'New failure', recent), tied: item('pass'), added: item('unreviewed') }, { group: item('unreviewed', '', recent) });
  const merged = review.mergeReviewState(existing, incoming);
  assert.equal(merged.clipReviews.stale.status, 'fix');
  assert.equal(merged.clipReviews.tied.status, 'fix');
  assert.equal(merged.clipReviews.preserved.status, 'unsure');
  assert.equal(merged.clipReviews.added.status, 'unreviewed');
  assert.equal(merged.groupReviews.group.status, 'unreviewed');
  merged.clipReviews.preserved.note = 'Changed';
  assert.equal(existing.clipReviews.preserved.note, 'Owner listened.');
  assert.equal(incoming.clipReviews.stale.note, 'New failure');
});

test('oversized imports and merged unions fail without silently losing unrelated history', () => {
  const full = state(Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`clip-${i}`, item()])));
  assert.equal(Object.keys(review.parseReviewState(full).clipReviews).length, 10000);
  assert.equal(review.parseReviewState({ ...full, groupReviews: { extra: item() } }), null);
  assert.equal(review.mergeReviewState(full, state({ extra: item() })), null);
  assert.equal(Object.keys(full.clipReviews).length, 10000);
});

test('local persistence distinguishes empty, damaged, blocked and successfully verified storage', () => {
  const store = storage();
  assert.deepEqual(review.readReviewState(store), state());
  const data = state({ clip: item('unsure', 'Needs another listen') });
  assert.equal(review.writeReviewState(data, store), true);
  assert.deepEqual(review.readReviewState(store), data);
  assert.equal(store.getItem(review.AUDIO_REVIEW_STORAGE_KEY), JSON.stringify(data));
  store.setItem(review.AUDIO_REVIEW_STORAGE_KEY, '{');
  assert.equal(review.readReviewState(store), null);
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  assert.equal(review.readReviewState(blocked), null);
  assert.equal(review.writeReviewState(data, blocked), false);
  assert.equal(review.writeReviewState(data, { getItem: () => null, setItem() {} }), false);
  assert.equal(review.writeReviewState(state({ bad: item('approved') }), store), false);
  assert.equal(store.getItem(review.AUDIO_REVIEW_STORAGE_KEY), '{', 'invalid writes do not touch existing storage');
});

test('CSV quotes multiline and quote-containing notes and neutralizes formulas in every column', () => {
  const csv = review.audioReviewCsv(['id', '=header'], [
    ['clip,"one"', 'line 1\nline 2'], ['+SUM(1,2)', ' =HYPERLINK("bad")'],
    ['@cmd', '-10'], ['\tformula', '\rformula'], [null, true],
  ]);
  assert.equal(csv, '"id","\'=header"\r\n"clip,""one""","line 1\nline 2"\r\n"\'+SUM(1,2)","\' =HYPERLINK(""bad"")"\r\n"\'@cmd","\'-10"\r\n"\'\tformula","\'\rformula"\r\n"","true"\r\n');
  assert.throws(() => review.audioReviewCsv(['one'], [['one', 'extra']]), /header length/);
});

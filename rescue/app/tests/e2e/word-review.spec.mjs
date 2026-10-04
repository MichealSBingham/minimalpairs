import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const baseURL = process.env.MINIMALPAIRS_TEST_URL || 'http://127.0.0.1:4323';
const origin = new URL(baseURL).origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Word-review checks require a local preview URL.');
}
test.use({ baseURL });
const evidence = new WeakMap();
const audioKey = 'minimalpairs.audio-review.v1';
const wordKey = 'minimalpairs.word-review.v1';

test.beforeEach(async ({ page }) => {
  const observed = { audioRequests: [], mediaEvents: [], pageErrors: [], expectedAudioState: null };
  evidence.set(page, observed);
  page.on('pageerror', error => observed.pageErrors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/audio/') || request.resourceType() === 'media') observed.audioRequests.push(request.url());
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin && !url.pathname.startsWith('/audio/') ? route.continue() : route.abort();
  });
  await page.exposeBinding('__wordReviewMedia', (_source, event) => observed.mediaEvents.push(event));
  await page.addInitScript(() => {
    const report = event => void window.__wordReviewMedia(event);
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) { report('media.play'); return originalPlay.apply(this, args); };
    window.Audio = new Proxy(window.Audio, { construct(target, args) { report('new Audio'); return Reflect.construct(target, args); } });
    if (window.speechSynthesis) {
      const originalSpeak = speechSynthesis.speak;
      speechSynthesis.speak = function (...args) { report('speechSynthesis.speak'); return originalSpeak.apply(this, args); };
    }
    const seen = new WeakSet();
    const inspect = node => {
      if (node instanceof HTMLMediaElement && !seen.has(node)) { seen.add(node); report(`element:${node.tagName}`); }
      if (node.querySelectorAll) node.querySelectorAll('audio,video').forEach(inspect);
    };
    new MutationObserver(changes => changes.forEach(change => change.addedNodes.forEach(inspect)))
      .observe(document, { childList: true, subtree: true });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const observed = evidence.get(page);
  await expect(page.locator('audio, video')).toHaveCount(0);
  expect(observed.audioRequests).toEqual([]);
  expect(observed.mediaEvents).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), audioKey)).toBe(observed.expectedAudioState);
  await testInfo.attach('text-only-evidence', { body: JSON.stringify(observed, null, 2), contentType: 'application/json' });
});

async function openDesk(page, query = '') {
  await page.goto(`/word-review-previous${query}`);
  await expect(page.getByRole('button', { name: 'Export text review', exact: true })).toBeEnabled();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
}

async function selectLanguage(page, name) {
  await page.getByRole('navigation', { name: 'Review language' }).getByRole('button', { name: new RegExp(`^${name}(?:$|\\s|\\d)`) }).click();
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
}

async function download(page, name) {
  const received = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const file = await received;
  expect(await file.failure()).toBeNull();
  return readFile(await file.path(), 'utf8');
}

async function backup(page) { return JSON.parse(await download(page, 'Export text review')); }
async function importData(page, data) {
  await page.locator('input[type="file"]').setInputFiles({ name: 'word-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
}

test('one text inventory preserves French IPA, Chinese readings and the separate German preview list', async ({ page }, testInfo) => {
  await openDesk(page);
  await expect(page.locator('.wr-language')).toHaveCount(8);
  await expect(page.locator('.wr-contrast')).toHaveCount(49);
  await expect(page.locator('.wr-pair')).toHaveCount(146);
  await expect(page.locator('.wr-results')).toContainText('49 lists · 146 pairs in view');
  await expect(page.locator('.wr-scope')).toContainText('8 languages · 48 main contrast lists · 144 main pairs');
  const ids = await page.locator('.wr-contrast').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-contrast-id')));
  expect(new Set(ids).size).toBe(49);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('word-review-overview.png') });

  await selectLanguage(page, 'French');
  await expect(page.locator('.wr-language')).toHaveCount(1);
  await expect(page.locator('.wr-contrast')).toHaveCount(23);
  await expect(page.locator('.wr-pair')).toHaveCount(70);
  await expect(page.locator('.wr-results')).toContainText('23 lists · 70 pairs in view');
  const toutTu = page.locator('[data-pair-id="fr-tout-tu"]');
  await expect(toutTu.locator('.wr-word strong')).toHaveText(['tout', 'tu']);
  await expect(toutTu.locator('.wr-ipa')).toHaveText(['/tu/', '/ty/']);
  await expect(toutTu.locator('.wr-meaning')).toHaveText(['all; everything', 'you, informal singular']);
  await noOverflow(page);

  await selectLanguage(page, 'Mandarin Chinese');
  await expect(page.locator('.wr-contrast')).toHaveCount(3);
  await expect(page.locator('.wr-pair')).toHaveCount(9);
  const ma = page.locator('[data-pair-id="zh-ma1-ma4"]');
  await expect(ma.locator('.wr-word strong')).toHaveText(['妈', '骂']);
  await expect(ma.locator('.wr-reading')).toHaveText(['mā', 'mà']);
  await expect(ma.locator('.wr-ipa')).toHaveText(['/ma˥/', '/ma˥˩/']);
  await expect(ma.locator('.wr-pair-review')).toContainText('Tone 1 → Tone 4');
  await page.getByRole('searchbox', { name: 'Find a word or sound', exact: true }).fill('shū');
  await expect(page.locator('.wr-contrast')).toHaveCount(1);
  await expect(page.locator('[data-pair-id="zh-shu1-shu4"] .wr-reading')).toHaveText(['shū', 'shù']);
  await page.getByRole('searchbox', { name: 'Find a word or sound', exact: true }).fill('');
  await noOverflow(page);
  await ma.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('word-review-chinese-readings.png') });

  await selectLanguage(page, 'German');
  await page.getByLabel('List scope', { exact: true }).selectOption('preview');
  await expect(page.locator('.wr-contrast')).toHaveCount(1);
  await expect(page.locator('.wr-pair')).toHaveCount(2);
  const preview = page.locator('[data-contrast-id="de-i-length-pronouns"]');
  await expect(preview.locator('.wr-kicker')).toHaveText('PREVIEW ONLY · EXTRA WORD LIST');
  await expect(preview.locator('.wr-preview-note')).toContainText('regional accents under review');
  await expect(preview.locator('[data-pair-id="de-in-ihn"] .wr-ipa')).toHaveText(['/ɪn/', '/iːn/']);
  await page.getByLabel('List scope', { exact: true }).selectOption('main');
  await expect(preview).toHaveCount(0);
  await noOverflow(page);
});

test('research corrections stay adjacent to their exact pair and search never changes the draft words', async ({ page }, testInfo) => {
  await openDesk(page);
  await selectLanguage(page, 'Italian');
  await page.getByLabel('Review filter', { exact: true }).selectOption('findings');
  await page.getByRole('searchbox', { name: 'Find a word or sound', exact: true }).fill('varo');
  await expect(page.locator('.wr-contrast')).toHaveCount(1);
  const pair = page.locator('[data-pair-id="it-faro-varo"]');
  await expect(pair.locator('.wr-word strong')).toHaveText(['faro', 'varo']);
  const correction = pair.locator('.wr-findings > div').filter({ has: page.getByText('Correction identified', { exact: true }) });
  await expect(correction).toHaveCount(1);
  await expect(correction).toContainText('varo2');
  await expect(correction).toContainText('varo3');
  await expect(correction.locator('a[href="https://www.treccani.it/vocabolario/varo2/"]')).toBeVisible();
  await expect(correction.locator('a[href="https://www.treccani.it/vocabolario/varo3/"]')).toBeVisible();
  await expect(pair.getByLabel('Review pair it-faro-varo', { exact: true })).toHaveValue('unreviewed');
  await expect(page.locator('.wr-results')).toContainText('0/49 lists marked correct');
  await noOverflow(page);
  await correction.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('word-review-sourced-correction.png') });
  await page.getByRole('searchbox', { name: 'Find a word or sound', exact: true }).fill('no-such-word-qa-930');
  await expect(page.locator('.wr-contrast')).toHaveCount(0);
  await expect(page.getByText('No lists match.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.wr-contrast')).toHaveCount(49);
  await expect(page.locator('.wr-pair')).toHaveCount(146);
});

test('text ratings and notes persist independently and backup imports reject audio or changed content', async ({ page }, testInfo) => {
  await openDesk(page, '?language=fr');
  const sentinel = JSON.stringify({ schemaVersion: 1, clipReviews: { 'untouched-audio-review': { status: 'fix', note: 'Audio review is separate.', updatedAt: '2026-09-30T10:00:00.000Z' } }, groupReviews: {} });
  expect(await page.evaluate(key => localStorage.getItem(key), audioKey)).toBeNull();
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: audioKey, value: sentinel });
  evidence.get(page).expectedAudioState = sentinel;
  const pair = page.locator('[data-pair-id="fr-tout-tu"]');
  const group = page.locator('[data-contrast-id="fr-u-y"]');
  // Text approval is immediately available; no listening gate belongs on this page.
  await expect(pair.getByLabel('Review pair fr-tout-tu', { exact: true })).toBeEnabled();
  await pair.getByLabel('Review pair fr-tout-tu', { exact: true }).selectOption('pass');
  await group.getByLabel('Review list fr-u-y', { exact: true }).selectOption('pass');
  await pair.getByText('Add correction / note', { exact: true }).click();
  const formula = '=1+1\n"Check this IPA"';
  await pair.getByLabel('Note for pair fr-tout-tu', { exact: true }).fill(formula);
  await group.getByLabel('Note for list fr-u-y', { exact: true }).fill('Text checked; voices remain unapproved.');
  await expect(page.locator('.wr-results')).toContainText('1/49 lists marked correct');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Export text review', exact: true })).toBeEnabled();
  await expect(pair.getByLabel('Review pair fr-tout-tu', { exact: true })).toHaveValue('pass');
  await expect(group.getByLabel('Review list fr-u-y', { exact: true })).toHaveValue('pass');
  await expect(pair.locator('.wr-saved-note')).toContainText(formula);
  await expect(group.getByLabel('Note for list fr-u-y', { exact: true })).toHaveValue('Text checked; voices remain unapproved.');
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), wordKey);
  expect(stored.schemaVersion).toBe(1);
  const exported = await backup(page);
  expect(exported.kind).toBe('minimalpairs-word-review');
  expect(exported.reviewState.schemaVersion).toBe(1);
  expect(exported.reviewState.clipReviews).toBeUndefined();
  const groupMeta = exported.catalog.groups.find(g => g.id === 'fr-u-y');
  const pairMeta = groupMeta.pairs.find(p => p.id === 'fr-tout-tu');
  expect(Object.keys(exported.reviewState.pairReviews)).toEqual([pairMeta.key]);
  expect(Object.keys(exported.reviewState.groupReviews)).toEqual([groupMeta.key]);
  expect(pairMeta.key).toMatch(/^pair-[a-f0-9]{64}$/);
  expect(groupMeta.key).toMatch(/^group-[a-f0-9]{64}$/);
  expect(exported.reviewState.pairReviews[pairMeta.key]).toMatchObject({ status: 'pass', note: formula });
  const csv = await download(page, 'Download word lists');
  expect(csv).toContain('"reading_1"');
  expect(csv).toContain('"mā"');
  expect(csv).toContain('"\'=1+1\n""Check this IPA"""');

  await importData(page, { kind: 'minimalpairs-audio-review', reviewState: JSON.parse(sentinel) });
  await expect(page.getByRole('status')).toHaveText('Choose a word-list review backup. Audio reviews stay separate.');
  await expect(pair.getByLabel('Review pair fr-tout-tu', { exact: true })).toHaveValue('pass');
  const incoming = structuredClone(exported);
  const later = new Date(Date.now() + 60_000).toISOString();
  incoming.reviewState.pairReviews[pairMeta.key] = { status: 'fix', note: 'Imported correction to this exact pair.', updatedAt: later };
  incoming.reviewState.pairReviews['pair-changed-ipa-hash'] = { status: 'pass', note: 'Do not import.', updatedAt: later };
  incoming.reviewState.groupReviews['group-changed-words-hash'] = { status: 'pass', note: 'Do not import.', updatedAt: later };
  await importData(page, incoming);
  await expect(page.getByRole('status')).toHaveText('Review merged. 2 changed or unknown entries skipped; 0 invalid entries skipped.');
  await expect(pair.getByLabel('Review pair fr-tout-tu', { exact: true })).toHaveValue('fix');
  await expect(pair.locator('.wr-saved-note')).toContainText('Imported correction to this exact pair.');
  await pair.getByText('Edit correction / note', { exact: true }).click();
  await pair.getByLabel('Note for pair fr-tout-tu', { exact: true }).fill('Local edit after the imported future timestamp.');
  const merged = await backup(page);
  expect(Object.keys(merged.reviewState.pairReviews)).toEqual([pairMeta.key]);
  expect(Object.keys(merged.reviewState.groupReviews)).toEqual([groupMeta.key]);
  expect(merged.reviewState.pairReviews[pairMeta.key].note).toBe('Local edit after the imported future timestamp.');
  expect(merged.reviewState.pairReviews[pairMeta.key].updatedAt > later).toBe(true);
  expect(merged.reviewState.groupReviews[groupMeta.key]).toEqual(exported.reviewState.groupReviews[groupMeta.key]);
  await noOverflow(page);
  await pair.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('word-review-persisted-note.png') });
  await page.emulateMedia({ media: 'print' });
  await expect(pair.locator('.wr-saved-note')).toBeVisible();
  await expect(pair.locator('.wr-saved-note')).toContainText('Local edit after the imported future timestamp.');
  await expect(group.locator('.wr-saved-group-note')).toBeVisible();
  await expect(group.locator('.wr-saved-group-note')).toContainText('Text checked; voices remain unapproved.');
  await expect(pair.getByLabel('Review pair fr-tout-tu', { exact: true })).toBeHidden();
  await noOverflow(page);
  await pair.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('word-review-print-notes.png') });
  await page.emulateMedia({ media: 'screen' });
});

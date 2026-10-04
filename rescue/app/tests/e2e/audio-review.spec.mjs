import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Owner-review tests are local only. Nothing is deployed or sent to an account.
const baseURL = process.env.MINIMALPAIRS_TEST_URL || 'http://localhost:4322';
const origin = new URL(baseURL).origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Audio-review browser tests require an explicit local preview URL.');
}
test.use({ baseURL });

test.beforeEach(async ({ page }) => {
  // Keep all requests on this local preview, including the negative file fixture.
  await page.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.__reviewPlayback = { plays: [], endings: [], synthesisCalls: 0 };
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const source = this.currentSrc || this.src;
      const entry = {
        source,
        passDisabledAtPlay: Array.from(document.querySelectorAll('.qa-clip option[value="pass"]')).every(option => option.disabled),
      };
      window.__reviewPlayback.plays.push(entry);
      this.addEventListener('ended', event => {
        window.__reviewPlayback.endings.push({ source, trusted: event.isTrusted, ended: this.ended, currentTime: this.currentTime, duration: this.duration });
      }, { once: true });
      return originalPlay.apply(this, args);
    };
    if (window.speechSynthesis) {
      const originalSpeak = speechSynthesis.speak;
      speechSynthesis.speak = function (...args) {
        window.__reviewPlayback.synthesisCalls += 1;
        return originalSpeak.apply(this, args);
      };
    }
  });
});

async function openReview(page, query = '') {
  await page.goto(`/audio-review${query}`);
  await expect(page.getByRole('button', { name: 'Export review', exact: true })).toBeEnabled();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
}

async function download(page, name) {
  const received = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const file = await received;
  expect(await file.failure()).toBeNull();
  return readFile(await file.path(), 'utf8');
}

async function backup(page) { return JSON.parse(await download(page, 'Export review')); }

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
}

async function playbackEvidence(page) {
  const evidence = await page.evaluate(() => window.__reviewPlayback);
  expect(evidence.synthesisCalls).toBe(0);
  for (const ending of evidence.endings) {
    expect(ending.trusted).toBe(true);
    expect(ending.ended).toBe(true);
    expect(ending.duration).toBeGreaterThan(0);
    expect(ending.currentTime).toBeCloseTo(ending.duration, 2);
  }
  return evidence;
}

test('French review inventory, ended-gated approval and local notes survive backup and import', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openReview(page);
  await expect(page.getByLabel('Audio collection', { exact: true })).toHaveValue('qwen-starter-v1');
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('fr');
  await expect(page.locator('.qa-counts')).toContainText('23 contrast groups');
  await expect(page.locator('.qa-counts')).toContainText('0/206 recordings marked correct');
  await expect(page.getByRole('navigation', { name: 'Contrast review index' }).getByRole('button')).toHaveCount(23);
  await noOverflow(page);

  const first = page.locator('.qa-pairs .qa-clip').nth(0);
  const second = page.locator('.qa-pairs .qa-clip').nth(1);
  const firstId = await first.getAttribute('data-clip-id');
  const secondId = await second.getAttribute('data-clip-id');
  await expect(first.locator('option[value="pass"]')).toHaveJSProperty('disabled', true);
  await expect(second.locator('option[value="pass"]')).toHaveJSProperty('disabled', true);
  await first.getByRole('button', { name: /^Play / }).click();
  await expect(first.getByLabel('Played to the end', { exact: true })).toBeVisible();
  await expect(first.locator('option[value="pass"]')).toHaveJSProperty('disabled', false);
  await expect(second.locator('option[value="pass"]')).toHaveJSProperty('disabled', true);
  const evidence = await playbackEvidence(page);
  expect(evidence.plays).toHaveLength(1);
  expect(evidence.plays[0].passDisabledAtPlay).toBe(true);
  expect(evidence.endings).toHaveLength(1);
  await first.getByRole('combobox').selectOption('pass');
  await second.getByRole('combobox').selectOption('fix');
  const correction = '=1+1\n"Needs another listen"';
  await second.getByRole('textbox').fill(correction);
  await page.getByLabel('Word list and grouping', { exact: true }).selectOption('fix');
  await page.getByLabel('Group note', { exact: true }).fill('Check the written categories before accepting this group.');
  await expect(page.locator('.qa-counts')).toContainText('1/206 recordings marked correct');
  await expect(page.locator('.qa-counts')).toContainText('1 need fixing');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Export review', exact: true })).toBeEnabled();
  await expect(first.getByRole('combobox')).toHaveValue('pass');
  await expect(second.getByRole('combobox')).toHaveValue('fix');
  await expect(second.getByRole('textbox')).toHaveValue(correction);
  await expect(page.getByLabel('Word list and grouping', { exact: true })).toHaveValue('fix');
  await expect(page.getByLabel('Group note', { exact: true })).toHaveValue('Check the written categories before accepting this group.');
  // Reload preserves the owner's note, but does not pretend playback happened in this tab.
  await expect(first.getByLabel('Played to the end', { exact: true })).toHaveCount(0);
  await expect(first.locator('option[value="pass"]')).toHaveJSProperty('disabled', true);

  const exported = await backup(page);
  expect(exported.reviewState.clipReviews[firstId].status).toBe('pass');
  expect(exported.reviewState.clipReviews[secondId]).toMatchObject({ status: 'fix', note: correction });
  const groupId = Object.keys(exported.reviewState.groupReviews)[0];
  expect(exported.reviewState.groupReviews[groupId].status).toBe('fix');
  const csv = await download(page, 'Recording CSV');
  expect(csv).toContain('"\'=1+1\n""Needs another listen"""');

  const imported = structuredClone(exported);
  // Deliberate clock skew: a fresh local correction must supersede this imported note.
  const later = new Date(Date.now() + 60_000).toISOString();
  imported.reviewState.clipReviews[secondId] = { status: 'unsure', note: 'Second review needs a decision.', updatedAt: later };
  imported.reviewState.clipReviews['clip-replaced-content-hash'] = { status: 'pass', note: 'Must not count.', updatedAt: later };
  imported.reviewState.groupReviews[`${groupId}:changed-content`] = { status: 'pass', note: 'Must not count.', updatedAt: later };
  await page.locator('input[type="file"]').setInputFiles({ name: 'review-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByRole('status')).toContainText('2 entries for different or replaced material skipped');
  await expect(second.getByRole('combobox')).toHaveValue('unsure');
  await expect(second.getByRole('textbox')).toHaveValue('Second review needs a decision.');
  await expect(page.locator('.qa-counts')).toContainText('1/206 recordings marked correct');
  await second.getByRole('textbox').fill('Local correction after importing the newer backup.');
  await expect(second.getByRole('textbox')).toHaveValue('Local correction after importing the newer backup.');
  const merged = await backup(page);
  expect(merged.reviewState.clipReviews[firstId].status).toBe('pass');
  expect(merged.reviewState.clipReviews[secondId].note).toBe('Local correction after importing the newer backup.');
  expect(merged.reviewState.clipReviews[secondId].updatedAt > later).toBe(true);
  expect(merged.reviewState.clipReviews['clip-replaced-content-hash']).toBeUndefined();
  expect(merged.reviewState.groupReviews[`${groupId}:changed-content`]).toBeUndefined();
  expect(merged.reviewState.groupReviews[groupId]).toEqual(exported.reviewState.groupReviews[groupId]);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('audio-review-notes.png'), fullPage: true });
  expect(errors).toEqual([]);
  await testInfo.attach('genuine-clip-playback', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('changed recording bytes are rejected before playback or approval', async ({ page }, testInfo) => {
  await openReview(page);
  const row = page.locator('.qa-pairs .qa-clip').first();
  const id = await row.getAttribute('data-clip-id');
  const { catalog } = await backup(page);
  const original = catalog.clips.find(clip => clip.id === id);
  const replacement = catalog.clips.find(clip => clip.exists && clip.url && clip.sha256 !== original.sha256);
  // Substitute a different real, same-origin recording solely for this checksum failure.
  const bytes = await page.request.get(new URL(replacement.url, baseURL).href);
  expect(bytes.ok()).toBe(true);
  const replacementBytes = await bytes.body();
  await page.route(new URL(original.url, baseURL).href, route => route.fulfill({
    status: 200, contentType: 'audio/mpeg', body: replacementBytes,
  }));
  await row.getByRole('button', { name: /^Play / }).click();
  await expect(row.getByRole('alert')).toContainText('It cannot be approved here');
  await expect(row.locator('option[value="pass"]')).toHaveJSProperty('disabled', true);
  await expect(row.getByRole('combobox')).toHaveValue('unreviewed');
  await expect(row.getByLabel('Played to the end', { exact: true })).toHaveCount(0);
  await expect(page.locator('.qa-counts')).toContainText('0/206 recordings marked correct');
  const evidence = await playbackEvidence(page);
  expect(evidence.plays).toHaveLength(0);
  expect(evidence.endings).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('audio-review-hash-rejection.png'), fullPage: true });
});

test('missing main English zh-j recordings cannot play, pass or form a false trial', async ({ page }) => {
  await openReview(page, '?collection=qwen-starter-v1&contrast=en-zh-j');
  await expect(page.locator('.qa-group-heading code')).toHaveText('en-zh-j');
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
  const clips = page.locator('.qa-pairs .qa-clip');
  await expect(clips).toHaveCount(12);
  for (const row of await clips.all()) {
    await expect(row.getByRole('button', { name: /^Play / })).toBeDisabled();
    await expect(row.locator('option[value="pass"]')).toHaveJSProperty('disabled', true);
    await expect(row).toContainText('Recording missing');
  }
  await page.getByRole('button', { name: 'Choose a combination', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('needs two complete voice profiles');
  await expect(page.locator('.qa-trial-samples')).toHaveCount(0);
  const evidence = await playbackEvidence(page);
  expect(evidence.plays).toHaveLength(0);
  await noOverflow(page);
});

test('actual engine produces distinct-word, cross-profile A B X and plays all three exact recordings', async ({ page }, testInfo) => {
  const fetched = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin && /^\/audio\/.*\.(mp3|wav|ogg|m4a|webm)$/.test(url.pathname)) fetched.push(url.pathname);
  });
  await openReview(page, '?collection=qwen-starter-v1&contrast=fr-u-y');
  await expect(page.locator('.qa-group-heading code')).toHaveText('fr-u-y');
  const { catalog } = await backup(page);
  const group = catalog.groups.find(item => item.collectionId === 'qwen-starter-v1' && item.contrastId === 'fr-u-y');
  const observations = [];
  let currentClips;
  for (let draw = 0; draw < 8; draw++) {
    await page.getByRole('button', { name: 'Choose a combination', exact: true }).click();
    const samples = page.locator('.qa-trial-samples button');
    await expect(samples).toHaveCount(3);
    const words = await samples.locator('strong').allTextContents();
    const voices = await samples.locator('small').allTextContents();
    expect(voices[0]).toBe(voices[1]);
    expect(voices[2]).not.toBe(voices[0]);
    expect(words[2]).not.toBe(words[0]);
    expect(words[2]).not.toBe(words[1]);
    const reference = group.pairs.find(pair => pair.words.some(word => word.text === words[0]));
    expect(reference.words.map(word => word.text).sort()).toEqual([words[0], words[1]].sort());
    const target = group.pairs.find(pair => pair.words.some(word => word.text === words[2]));
    expect(target.id).not.toBe(reference.id);
    expect(target.trialGroup).toBe(reference.trialGroup);
    expect(target.targetPosition).toBe(reference.targetPosition);
    const targetSide = target.words.findIndex(word => word.text === words[2]);
    const match = words[0] === reference.words[targetSide].text ? 'A' : 'B';
    await expect(page.locator('.qa-trial-bottom strong')).toHaveText(match);
    currentClips = words.map((word, index) => catalog.clips.find(clip => clip.text === word && clip.voiceName === voices[index] && clip.collectionIds.includes(group.collectionId) && clip.languageId === 'fr'));
    expect(currentClips.every(clip => clip?.exists && clip.sha256)).toBe(true);
    observations.push({ words, voices, answer: match, trialGroup: reference.trialGroup });
  }
  fetched.length = 0;
  await page.getByRole('button', { name: 'Play A → B → X', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.__reviewPlayback.endings)).length).toBe(3);
  await expect(page.getByRole('button', { name: 'Play A → B → X', exact: true })).toBeEnabled();
  const evidence = await playbackEvidence(page);
  expect(evidence.plays).toHaveLength(3);
  expect(evidence.endings).toHaveLength(3);
  expect(fetched).toEqual(currentClips.map(clip => clip.url));
  for (const clip of currentClips) {
    const row = page.locator(`.qa-pairs .qa-clip[data-clip-id="${clip.id}"]`);
    await expect(row.getByLabel('Played to the end', { exact: true })).toBeVisible();
    await expect(row.locator('option[value="pass"]')).toHaveJSProperty('disabled', false);
  }
  // Playing the sequence does not automatically record a passing review.
  await expect(page.locator('.qa-counts')).toContainText('0/206 recordings marked correct');
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('audio-review-real-abx.png'), fullPage: true });
  await page.locator('.qa-trial').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('audio-review-abx-viewport.png') });
  await testInfo.attach('engine-and-real-playback', { body: JSON.stringify({ observations, fetched, evidence }, null, 2), contentType: 'application/json' });
});

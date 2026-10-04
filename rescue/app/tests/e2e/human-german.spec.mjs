import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';

// Real local media completion; no audio mocks, fake ended events, seeded
// history or React-state access. Asset identity checks are not listening review.
test('German human two-pair session preserves audio-only mapping, licenses and source history', async ({ page, context }, testInfo) => {
  const errors = [], requests = [], wrongSource = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('.mp3')) requests.push(path);
    if (path === '/audio/manifest.json' || path.startsWith('/audio/clips/')) wrongSource.push(path);
  });
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/audio/human-library.json');
  await page.goto('/human-audio-preview?language=de&contrast=de-i-length-pronouns');
  await keepAnalyticsOff(page);
  const manifest = await (await responsePromise).json();
  const clips = manifest.clips.filter(clip => clip.languageId === 'de');
  const byPath = new Map(clips.map(clip => [clip.url, clip]));
  const category = new Map([['in', 0], ['im', 0], ['ihn', 1], ['ihm', 1]]);
  expect(clips).toHaveLength(8);
  expect(manifest.voicesByLanguage.de.map(voice => voice.id)).toEqual(['human-de-jeuwre', 'human-de-joni']);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByLabel('I’m learning')).toHaveValue('de');
  await expect(page.locator('.contrast-option')).toHaveCount(1);
  await expect(page.locator('.contrast-option')).toHaveText('Sound contrast 01');
  await expect(page.locator('.pilot-notice')).toContainText('French, English and German. Pronunciation and voice consistency are under review.');
  await expect(page.locator('.voice-setting')).toContainText('Human recordings · listening review in progress');
  const hints = page.getByRole('checkbox', { name: 'Show text hints' });
  await expect(hints).not.toBeChecked();
  const answerA = page.locator('.abx-answer-options .answer-card').first();
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  let correct = 0;
  const observed = [];
  for (let round = 1; round <= 12; round++) {
    await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
    await expect(answerA).toBeDisabled();
    await expect(answerA).toBeEnabled();
    await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
    await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    const accessible = await page.locator('.practice-layout').ariaSnapshot();
    expect(accessible).not.toMatch(/\b(?:ihn|ihm|im)\b|ɪ|iː|direct object|dative|In or ihn/i);
    for (const name of ['Play A, reference sound', 'Play B, reference sound', 'Play X, test word']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1);
    }
    const paths = requests.filter((path, index) => index === 0 || path !== requests[index - 1]);
    expect(paths).toHaveLength(3);
    const played = paths.map(path => byPath.get(path));
    expect(played.every(Boolean)).toBe(true);
    expect(played[0].voiceId).toBe(played[1].voiceId);
    expect(played[2].voiceId).not.toBe(played[0].voiceId);
    expect(played[2].text).not.toBe(played[0].text);
    expect(played[2].text).not.toBe(played[1].text);
    expect(category.get(played[0].text)).not.toBe(category.get(played[1].text));
    const expectedA = category.get(played[0].text) === category.get(played[2].text);
    if (round === 1) await page.screenshot({ path: testInfo.outputPath('human-german-audio-only.png'), fullPage: true });
    if (round === 3) {
      await page.locator('.toggle-label').click();
      await expect(hints).toBeChecked();
      expect(await page.locator('.abx-word-hint strong').allTextContents()).toEqual(played.map(clip => clip.text));
      await page.locator('.toggle-label').click();
      await expect(hints).not.toBeChecked();
      await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    }
    await answerA.click();
    await expect(page.locator('.answer-feedback strong')).toHaveText(expectedA ? 'You heard the shared feature.' : 'X shares B’s target feature.');
    if (expectedA) correct++;
    observed.push({ paths, words: played.map(clip => clip.text), contributors: played.map(clip => clip.voiceId), expectedA });
    requests.length = 0;
    await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
  }
  await expect(page.locator('.session-results > div').first().locator('strong')).toHaveText(`${correct}/12`);
  await expect(page.locator('.score-note')).toContainText('Text hints were used in this session.');
  await expect(page.getByRole('region', { name: 'Your next listening suggestion' })).toHaveCount(0);
  await expect(page.locator('a[href="/practice?language=de&contrast=de-i-length-pronouns"]')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')).sessions);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ languageId: 'de', contrastId: 'de-i-length-pronouns', audioCollectionId: 'human-library-v1',
    mode: 'abx-cross-word', schemaVersion: 2, textHintsUsed: true, total: 12, correct });
  await page.getByRole('link', { name: 'View your history', exact: true }).click();
  const row = page.locator('.history-row');
  await expect(row).toContainText('Human recordings');
  await expect(row).toContainText('Text hints used');
  await expect(row.getByRole('link')).toHaveAttribute('href', '/human-audio-preview?language=de&contrast=de-i-length-pronouns');
  await page.reload();
  await expect(row.getByRole('link')).toHaveAttribute('href', '/human-audio-preview?language=de&contrast=de-i-length-pronouns');
  await row.getByRole('link').click();
  await expect(page.getByLabel('I’m learning')).toHaveValue('de');
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
  await expect(hints).not.toBeChecked();
  await page.getByRole('link', { name: 'Recording credits', exact: true }).click();
  await expect(page.locator('#human-recordings')).toContainText('the German preview has two');
  await expect(page.locator('#german-recordings article')).toHaveCount(8);
  await expect(page.locator('#german-recordings')).toContainText('not a controlled same-session collection');
  for (const clip of clips) {
    const article = page.locator('#german-recordings article').filter({ has: page.getByRole('heading', { name: `${clip.text} · ${clip.author}`, exact: true }) });
    await expect(article).toHaveCount(1);
    await expect(article.getByRole('link', { name: clip.sourceTitle, exact: true })).toHaveAttribute('href', clip.sourcePage);
    await expect(article.getByRole('link', { name: clip.license.id, exact: true })).toHaveAttribute('href', clip.license.url);
    await expect(article.getByRole('link', { name: 'Audited source revision', exact: true })).toHaveAttribute('href', clip.sourceRevision);
  }
  expect(wrongSource).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach('german-human-mapping', { body: JSON.stringify({ observed, session: saved[0], phoneticListeningVerified: false }, null, 2), contentType: 'application/json' });
  await cdp.detach();
});

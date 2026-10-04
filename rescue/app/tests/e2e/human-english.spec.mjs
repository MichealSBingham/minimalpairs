import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';

test('English human cat-cut practice uses only its two credited contributors and revisits the same source', async ({ page }, testInfo) => {
  const errors = [], clips = [], wrongSource = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    const path = new URL(r.url()).pathname;
    if (path.endsWith('.mp3')) clips.push(path);
    if (path.startsWith('/audio/clips/') || path === '/audio/manifest.json') wrongSource.push(path);
  });
  await page.goto('/human-audio-preview?language=en&contrast=en-ae-strut');
  await keepAnalyticsOff(page);
  await expect(page.getByLabel('I’m learning')).toHaveValue('en');
  await expect(page.locator('.contrast-option')).toHaveCount(2);
  await expect(page.locator('.voice-setting')).toContainText('Human recordings · listening review in progress');
  await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  let correct = 0;
  const answer = page.locator('.abx-answer-options .answer-card').first();
  for (let round = 1; round <= 12; round++) {
    await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
    await expect(answer).toBeEnabled();
    await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
    await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    if (round === 1) await page.screenshot({ path: testInfo.outputPath('human-english-audio-only.png'), fullPage: true });
    await answer.click();
    if (await page.locator('.answer-feedback strong').innerText() === 'You heard the shared feature.') correct++;
    await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
  }
  await expect(page.locator('.session-results > div').first().locator('strong')).toHaveText(`${correct}/12`);
  expect(clips.length).toBeGreaterThan(0);
  expect(clips.every(path => path.startsWith('/audio/human-en-ae-strut/clips/'))).toBe(true);
  expect(wrongSource).toEqual([]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')).sessions);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ languageId: 'en', contrastId: 'en-ae-strut', audioCollectionId: 'human-library-v1', textHintsUsed: false, total: 12, correct });
  await page.getByRole('link', { name: 'View your history', exact: true }).click();
  const row = page.locator('.history-row');
  await expect(row).toContainText('Human recordings');
  await expect(row.getByRole('link')).toHaveAttribute('href', '/human-audio-preview?language=en&contrast=en-ae-strut');
  await row.getByRole('link').click();
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
  await expect(page.getByLabel('I’m learning')).toHaveValue('en');
  await page.getByRole('link', { name: 'Recording credits', exact: true }).click();
  await expect(page.locator('#english-recordings article')).toHaveCount(24);
  for (const name of ['cat', 'cut', 'cap', 'cup', 'lack', 'luck']) for (const speaker of ['Dvortygirl', 'Grendelkhan']) {
    await expect(page.getByRole('heading', { name: `${name} · ${speaker}`, exact: true })).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});

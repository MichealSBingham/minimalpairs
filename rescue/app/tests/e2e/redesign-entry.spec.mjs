import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';

// Real cached media and user controls; no simulated playback completion.
test('plain-language homepage demo plays and leads into practice', async ({ page }, testInfo) => {
  const errors = [], audio = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/audio/clips/')) audio.push(request.url()); });
  await page.goto('/');
  await keepAnalyticsOff(page);
  await expect(page.locator('main h1')).toContainText('You can read it.');
  await expect(page.locator('main')).not.toContainText('ABX');
  await expect(page.locator('.rd-language-card')).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const demo = page.locator('.demo-abx');
  await expect(demo.locator('.demo-answer').first()).toBeDisabled();
  await demo.getByRole('button', { name: 'Play A → B → X', exact: true }).click();
  await expect(demo.locator('.demo-answer').first()).toBeDisabled();
  await expect(demo.locator('.demo-answer').first()).toBeEnabled();
  await expect(demo.locator('.abx-heard-mark')).toHaveCount(3);
  expect(new Set(audio).size).toBe(3);
  await expect(demo.locator('.abx-word-hint')).toHaveCount(0);
  await demo.locator('.demo-answer').first().click();
  await expect(demo.getByRole('link', { name: 'Practice this contrast' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  await demo.getByRole('link', { name: 'Practice this contrast' }).click();
  await expect(page).toHaveURL(/practice\?language=fr&contrast=fr-u-y/);
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('sound guides play cached examples and distinguish missing recordings', async ({ page }, testInfo) => {
  const errors = [], audio = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/audio/clips/')) audio.push(request.url()); });
  await page.goto('/learn/fr-u-y');
  await keepAnalyticsOff(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('.guide-play').first()).toBeEnabled();
  for (const index of [0, 1]) {
    const button = page.locator('.guide-play').nth(index);
    await button.click();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveAttribute('aria-busy', 'false');
    await expect(button).toBeEnabled();
  }
  expect(new Set(audio).size).toBe(2);
  await expect(page.locator('.guide-audio-error')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('french-guide.png'), fullPage: true });
  await page.goto('/learn/en-foot-strut');
  await expect(page.locator('.guide-play').first()).toBeDisabled();
  await expect(page.locator('.guide-recording-unavailable').first()).toBeVisible();
  expect(errors).toEqual([]);
});

import { test, expect } from '@playwright/test';

// Explicit local Astro preview; real adapter and existing cached MP3 files.
test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseURL)) throw new Error('Guide checks require an explicit local preview URL.');
  await page.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.guidePlayback = { ended: [], deviceCalls: 0 };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      this.addEventListener('ended', () => window.guidePlayback.ended.push(this.currentSrc), { once: true });
      return play.apply(this, args);
    };
    speechSynthesis.speak = () => { window.guidePlayback.deviceCalls++; };
  });
});
async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('French guide shows curated explanations and plays real cached words', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/learn/fr-u-y');
  const consent = page.getByRole('button', { name: 'Keep analytics off', exact: true });
  if (await consent.isVisible()) await consent.click();
  await expect(page.locator('h1')).toContainText('French /u/ vs /y/');
  await expect(page.locator('.guide-sound-card')).toHaveCount(2);
  await expect(page.locator('.guide-trap')).toContainText('Do not add a separate y sound');
  await expect(page.locator('.guide-pair-row')).toHaveCount(4);
  await expect(page.locator('.guide-audio-label')).toContainText('Generated audio');
  const word = page.getByRole('button', { name: 'Play tout', exact: true });
  await expect(word).toBeEnabled(); await word.click();
  await expect.poll(() => page.evaluate(() => window.guidePlayback.ended.length)).toBe(1);
  expect(await page.evaluate(() => window.guidePlayback.deviceCalls)).toBe(0);
  await expect(word).toBeEnabled();
  expect(await page.locator('.guide-intro .guide-button').getAttribute('href')).toBe('/practice?language=fr&contrast=fr-u-y');
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(canonical).toMatch(/^https:\/\/minimalpairs\.(co|web\.app)\/learn\/fr-u-y$/);
  const schema = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  expect(schema['@type']).toBe('LearningResource'); expect(schema.url).toBe(canonical);
  await fits(page); expect(errors).toEqual([]);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('french-guide.png'), fullPage: true });
});

test('cached media failure offers a retry without device substitution', async ({ page }) => {
  await page.route('**/audio/clips/**', route => route.abort());
  await page.goto('/learn/fr-u-y');
  const consent = page.getByRole('button', { name: 'Keep analytics off', exact: true });
  if (await consent.isVisible()) await consent.click();
  const word = page.getByRole('button', { name: 'Play tout', exact: true });
  await expect(word).toBeEnabled(); await word.click();
  await expect(page.getByRole('status')).toContainText('This recording could not play. Tap to retry.');
  expect(await page.evaluate(() => window.guidePlayback.deviceCalls)).toBe(0);
  await page.unroute('**/audio/clips/**'); await word.click();
  await expect.poll(() => page.evaluate(() => window.guidePlayback.ended.length)).toBe(1);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('device-only guide does not present missing recordings as playable', async ({ page }, testInfo) => {
  await page.goto('/learn/en-zh-j');
  const consent = page.getByRole('button', { name: 'Keep analytics off', exact: true });
  if (await consent.isVisible()) await consent.click();
  await expect(page.locator('.guide-audio-label')).toContainText('Device voice preview only');
  await expect(page.locator('.guide-device-note')).toContainText('Cached recordings are not ready');
  await expect(page.getByRole('button', { name: 'Recording unavailable for lesion', exact: true })).toBeDisabled();
  await expect(page.locator('.guide-intro .guide-button')).toHaveText('Check device practice');
  expect(await page.evaluate(() => window.guidePlayback.deviceCalls)).toBe(0);
  await fits(page); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await page.screenshot({ path: testInfo.outputPath('device-only-guide.png'), fullPage: true });
});

test('tone guide retains reading aids and compact mobile navigation', async ({ page }, testInfo) => {
  await page.goto('/learn/zh-tone-2-3');
  const consent = page.getByRole('button', { name: 'Keep analytics off', exact: true });
  if (await consent.isVisible()) await consent.click();
  await expect(page.locator('.guide-card-category')).toHaveCount(2);
  await expect(page.locator('.guide-word .guide-reading')).toHaveCount(6);
  await expect(page.locator('.guide-trap')).toContainText('Third tone does not always finish with a rise');
  if (testInfo.project.name === 'mobile') {
    await expect(page.locator('.guide-mobile-contrasts')).toBeVisible();
    await page.locator('.guide-mobile-contrasts summary').click();
    await expect(page.locator('.guide-mobile-contrasts nav a')).toHaveCount(3);
  }
  await fits(page); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await page.screenshot({ path: testInfo.outputPath('tone-guide.png'), fullPage: true });
});

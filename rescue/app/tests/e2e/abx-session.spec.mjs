import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';

// These tests use a fresh browser context and the real audio implementation.
// They never dispatch ended events, alter playback speed, edit storage/React state,
// inject credentials, or mock an audio response.
test('real 12-round ABX completion, audio gates, hint tracking and persisted guest history', async ({ page, context }, testInfo) => {
  const hinted = testInfo.project.name === 'mobile';
  const errors = [];
  const audioRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/audio/clips/')) audioRequests.push(request.url()); });

  await page.goto('/');
  await keepAnalyticsOff(page);
  await expect(page.getByRole('heading', { name: /You can read it/  })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const actualWidth = await page.evaluate(() => window.innerWidth);
  expect(actualWidth).toBe(hinted ? 390 : 1440);
  await expect(page.locator('.rd-language-card')).toHaveCount(8);
  await expect(page.locator('.demo-word-hint, .demo-options .word-ipa')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('home-full.png'), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath('home-viewport.png') });

  await page.locator('.rd-language-card[href="/french-minimal-pairs"]').click();
  await page.locator('a[href="/practice?language=fr&contrast=fr-u-y"]').first().click();
  await expect(page.getByRole('heading', { name: 'Train your ear.' })).toBeVisible();
  await expect(page.getByLabel('I’m learning')).toHaveValue('fr');
  await expect(page.locator('.trainer-card h2')).toHaveText('Exercise 01');
  const hints = page.getByRole('checkbox', { name: 'Show text hints' });
  await expect(hints).not.toBeChecked();
  await expect(page.getByText('Tout or tu?', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('practice-ready.png'), fullPage: true });

  let expectedCorrect = 0;
  const answerA = page.locator('.abx-answer-options .answer-card').nth(0);
  const answerB = page.locator('.abx-answer-options .answer-card').nth(1);
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  for (let round = 1; round <= 12; round++) {
    await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
    await expect(answerA).toBeDisabled();
    await expect(answerB).toBeDisabled();
    await expect(answerA).toBeEnabled();
    await expect(answerB).toBeEnabled();
    await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
    await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    await expect(page.locator('.trainer-card h2')).toHaveText('Exercise 01');
    if (round === 1) {
      if (hinted) {
        await page.locator('.site-header').scrollIntoViewIfNeeded();
        const box = await answerB.boundingBox();
        expect(box.y + box.height).toBeLessThanOrEqual(844);
      }
      await page.screenshot({ path: testInfo.outputPath('practice-active.png'), fullPage: true });
      await page.screenshot({ path: testInfo.outputPath('practice-viewport.png') });
    }
    if (round === 3 && hinted) {
      await page.locator('.toggle-label').click();
      await expect(hints).toBeChecked();
      await expect(page.locator('.abx-word-hint')).toHaveCount(3);
      await expect(page.getByText('Tout or tu?', { exact: true })).not.toHaveCount(0);
      await page.locator('.toggle-label').click();
      await expect(hints).not.toBeChecked();
      await expect(page.locator('.abx-word-hint')).toHaveCount(0);
      await expect(page.locator('.trainer-card h2')).toHaveText('Exercise 01');
    }
    // Count the actual displayed feedback. Independent answer draws have no fixed
    // session total; this test never reads or alters the generator's state.
    await answerA.click();
    await expect(page.locator('.answer-feedback')).toBeVisible();
    if ((await page.locator('.answer-feedback strong').textContent()) === 'You heard the shared sound.') expectedCorrect += 1;
    await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    await expect(answerA).toBeDisabled();
    await expect(answerB).toBeDisabled();
    await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
  }

  await expect(page.getByRole('heading', { name: 'You made time to listen.' })).toBeVisible();
  await expect(page.locator('.session-results')).toContainText(`${expectedCorrect}/12`);
  await expect(page.locator('.save-note')).toHaveText('Session saved on this device.');
  const nextListen = page.getByRole('region', { name: 'Your next listening suggestion' });
  await expect(nextListen).toContainText('French · Sound contrast 02');
  await expect(nextListen.getByRole('link')).toHaveAttribute('href', '/practice?language=fr&contrast=fr-an-on');
  await expect(page.locator('.cloud-save-note')).toContainText('Choose account saving.');
  await expect(page.locator('.score-note')).toContainText(hinted ? 'Words were shown' : 'sound alone');
  await page.screenshot({ path: testInfo.outputPath('session-complete.png'), fullPage: true });
  // The browser reuses cached clips; network request count is not playback count.
  // Every round above independently required all three real playback-ended marks.
  expect(audioRequests.length).toBeGreaterThan(0);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')));
  expect(saved.sessions).toHaveLength(1);
  expect(saved.sessions[0]).toMatchObject({ mode: 'abx-cross-word', schemaVersion: 2, audioCollectionId: 'qwen-starter-v1', textHintsUsed: hinted, languageId: 'fr', contrastId: 'fr-u-y', correct: expectedCorrect, total: 12 });
  expect(saved.sessions[0].mistakes).toHaveLength(12 - expectedCorrect);
  await testInfo.attach('verified-session', { body: JSON.stringify({ viewportWidth: actualWidth, audioRequests: audioRequests.length, session: saved.sessions[0] }, null, 2), contentType: 'application/json' });

  await page.getByRole('link', { name: 'View your history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your recent listening practice' })).toBeVisible();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-row')).toContainText(hinted ? 'Text hints used' : 'Audio-only');
  await expect(page.locator('.progress-stats > div').nth(1).locator('strong')).toHaveText(hinted ? '—' : `${Math.round(expectedCorrect / 12 * 100)}%`);
  await expect(nextListen).toContainText('French · Sound contrast 02');
  await page.getByLabel('Your next practice in').selectOption('es');
  await expect(nextListen).toContainText('Spanish · Sound contrast 01');
  await expect(nextListen.getByRole('link')).toHaveAttribute('href', '/practice?language=es&contrast=es-tap-trill');
  await page.getByLabel('Your next practice in').selectOption('fr');
  await page.reload();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-row')).toContainText(`${expectedCorrect}/12`);
  await page.screenshot({ path: testInfo.outputPath('account-history.png'), fullPage: true });

  // A new tab in the same isolated browser context independently reads persistence.
  const anotherTab = await context.newPage();
  await anotherTab.goto('/account');
  await expect(anotherTab.locator('.history-row')).toHaveCount(1);
  await expect(anotherTab.locator('.history-row')).toContainText(hinted ? 'Text hints used' : 'Audio-only');
  await anotherTab.close();
  await page.locator('.history-description a').click();
  await expect(page).toHaveURL(/language=fr&contrast=fr-u-y/);
  await expect(page.locator('.trainer-card h2')).toHaveText('Exercise 01');
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
  await expect(hints).not.toBeChecked();
  expect(errors).toEqual([]);
});

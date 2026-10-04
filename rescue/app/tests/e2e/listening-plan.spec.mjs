import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';

test('optional device plan persists, counts three real sessions in order, and starts a new week without changing ordinary preferences', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const errors = [];
  page.on('pageerror', issue => errors.push(issue.message));
  await page.goto('/account');
  await keepAnalyticsOff(page);
  const plan = page.getByRole('region', { name: 'Your listening week.' });
  await expect(plan.getByRole('button', { name: 'Save my free plan' })).toBeDisabled();
  await expect(plan.getByLabel('Plan language').locator('option:not([disabled])')).toHaveCount(8);
  expect(await page.evaluate(() => localStorage.getItem('minimalpairs.listening-plan.v1'))).toBeNull();
  await plan.getByLabel('Plan language').selectOption('fr');
  await plan.getByLabel('Starting sound').selectOption('fr-u-y');
  await plan.getByRole('button', { name: 'Save my free plan' }).click();
  await expect(plan).toContainText('0 of 3 sessions completed');
  await expect(plan.getByRole('link', { name: 'Open session 1' })).toHaveAttribute('href', '/practice?language=fr&contrast=fr-u-y');
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.listening-plan.v1')));
  await page.reload();
  await expect(plan).toContainText('0 of 3 sessions completed');
  await plan.screenshot({ path: testInfo.outputPath('listening-week-start.png') });

  for (let session = 1; session <= 3; session++) {
    await expect(plan.getByRole('button', { name: 'Plan another week', exact: true })).toHaveCount(0);
    await plan.getByRole('link', { name: `Open session ${session}` }).click();
    await expect(page.getByLabel('I’m learning')).toHaveValue('fr');
    await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Start with A, B & X' }).click();
    const answerA = page.locator('.abx-answer-options .answer-card').nth(0);
    for (let round = 1; round <= 12; round++) {
      await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
      await expect(answerA).toBeEnabled();
      await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
      await expect(page.locator('.abx-word-hint')).toHaveCount(0);
      if (session === 2 && round === 2) {
        await page.locator('.toggle-label').click();
        await expect(page.getByRole('checkbox', { name: 'Show text hints' })).toBeChecked();
        await page.locator('.toggle-label').click();
        await expect(page.getByRole('checkbox', { name: 'Show text hints' })).not.toBeChecked();
      }
      // Let all three real recordings finish. No media mocks, synthetic ended
      // events, storage fixtures, clock shifts or React state modifications.
      await answerA.click();
      await expect(page.locator('.answer-feedback')).toBeVisible();
      await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
    }
    await expect(page.locator('.save-note')).toHaveText('Session saved on this device.');
    await page.getByRole('link', { name: 'My progress', exact: true }).click();
    await expect(plan).toContainText(`${session} of 3 sessions completed`);
    await expect(plan.locator('.plan-slots li.is-complete')).toHaveCount(session);
    await expect(page.locator('.history-row')).toHaveCount(session);
    if (session === 1) {
      await expect(plan.getByRole('link', { name: 'Open session 2' })).toHaveAttribute('href', '/practice?language=fr&contrast=fr-u-y');
      await plan.screenshot({ path: testInfo.outputPath('listening-week-in-progress.png') });
    }
    if (session === 2) {
      await expect(plan.locator('.plan-slots li').nth(1)).toContainText('Text hints used');
      await expect(plan.locator('.plan-slots li').nth(1)).toContainText(/Same day|less than 24 hours/);
      await expect(plan.getByRole('link', { name: 'Open session 3' })).toHaveAttribute('href', '/practice?language=fr&contrast=fr-an-on');
    }
    await page.reload();
    await expect(plan).toContainText(`${session} of 3 sessions completed`);
  }
  await expect(plan).toContainText('You completed your three sessions.');
  await expect(plan).toContainText('2 audio-only · 1 with text hints');
  await expect(plan.getByRole('link', { name: /Open session/ })).toHaveCount(0);
  await plan.getByText('How this plan works', { exact: true }).click();
  await expect(plan).toContainText('not a proven learning dose');
  await expect(plan).toContainText('not synced to your account');
  await plan.getByText('How this plan works', { exact: true }).click();
  await plan.screenshot({ path: testInfo.outputPath('listening-week-complete.png') });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')));
  expect(before.sessions).toHaveLength(3);
  expect(new Set(before.sessions.map(item => item.id)).size).toBe(3);
  await plan.getByRole('button', { name: 'Plan another week', exact: true }).click();
  await plan.getByLabel('Plan language').selectOption('de');
  await plan.getByRole('button', { name: 'Keep this plan', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.listening-plan.v1')).id)).toBe(original.id);
  await plan.getByRole('button', { name: 'Plan another week', exact: true }).click();
  await plan.getByLabel('Plan language').selectOption('de');
  await plan.getByRole('button', { name: 'Save new plan' }).click();
  await expect(plan).toContainText('German');
  await expect(plan).toContainText('0 of 3 sessions completed');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')));
  expect(after).toEqual(before);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.listening-plan.v1')));
  expect(saved.id).not.toBe(original.id);
  expect(saved.audioCollectionId).toBe('qwen-starter-v1');
  await testInfo.attach('listening-week-lifecycle', { body: JSON.stringify({ original, replacement: saved, completedSessionIds: before.sessions.map(item => item.id), retainedOrdinaryLanguage: after.preferredLanguage }, null, 2), contentType: 'application/json' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

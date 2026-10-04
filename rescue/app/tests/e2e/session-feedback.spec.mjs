import { test, expect } from '@playwright/test';

// Real app, real 12-round audio playback, real consent UI. Google's tag is
// replaced at its network boundary so no real analytics is transmitted.
const google = url => /(^|\.)(googletagmanager\.com|google-analytics\.com)$/.test(new URL(url).hostname);
const feedbackRows = page => page.evaluate(() => (window.dataLayer || []).map(value => Array.from(value)).filter(row => row[0] === 'event' && row[1] === 'practice_feedback').map(row => row[2]));

test('completion feedback is explicit, consent gated, private and deduplicated', async ({ page }, testInfo) => {
  const intercepted = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(url => google(url.href), route => {
    intercepted.push(new URL(route.request().url()).pathname);
    return new URL(route.request().url()).pathname === '/gtag/js'
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* Analytics delivery intentionally intercepted by local UI test. */' })
      : route.abort();
  });
  await page.route(/identitytoolkit\.googleapis\.com\/.*accounts:(sendOobCode|signUp|resetPassword|update)/, route => route.abort());
  await page.goto('/practice?language=fr&contrast=fr-u-y&private_probe=not-feedback#not-feedback');
  test.skip(!(await page.locator('html').getAttribute('data-measurement-id')), 'Run against a preview configured for optional analytics.');
  await page.getByRole('button', { name: 'Keep analytics off', exact: true }).click();
  await expect(page.locator('.session-feedback')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  const answer = page.locator('.abx-answer-options .answer-card').first();
  for (let round = 1; round <= 12; round++) {
    await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
    await expect(answer).toBeEnabled();
    await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
    await expect(page.locator('.abx-word-hint')).toHaveCount(0);
    await expect(page.locator('.session-feedback')).toHaveCount(0);
    await answer.click();
    await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
  }
  await expect(page.getByRole('heading', { name: 'You made time to listen.' })).toBeVisible();
  const card = page.locator('.session-feedback');
  await expect(card).not.toHaveAttribute('open');
  await page.screenshot({ path: testInfo.outputPath('session-feedback-completion.png'), fullPage: true });
  await card.getByText('How was this session?', { exact: false }).click();
  await expect(card).toContainText('Nothing is shared');
  await expect(card.getByRole('button', { name: 'Share feedback' })).toBeDisabled();
  await expect(card.getByRole('radio')).toHaveCount(5);
  for (const radio of await card.getByRole('radio').all()) await expect(radio).toBeDisabled();
  await expect(card.locator('textarea,input:not([type="radio"])')).toHaveCount(0);
  expect(intercepted).toEqual([]); expect(await feedbackRows(page)).toEqual([]);
  await card.screenshot({ path: testInfo.outputPath('session-feedback-off.png') });

  await page.getByRole('button', { name: 'Analytics choices', exact: true }).click();
  await page.getByRole('button', { name: 'Allow usage analytics', exact: true }).click();
  await card.getByRole('radio', { name: 'Audio sounded unclear' }).check();
  expect(await feedbackRows(page)).toEqual([]); // Selecting is not submitting.
  await page.getByRole('button', { name: 'Analytics choices', exact: true }).click();
  await page.getByRole('button', { name: 'Keep analytics off', exact: true }).click();
  await expect(card.getByRole('radio', { name: 'Audio sounded unclear' })).not.toBeChecked();
  await expect(card.getByRole('button', { name: 'Share feedback' })).toBeDisabled();
  await page.getByRole('button', { name: 'Analytics choices', exact: true }).click();
  await page.getByRole('button', { name: 'Allow usage analytics', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Share feedback' })).toBeDisabled();
  expect(await feedbackRows(page)).toEqual([]); // Re-consent never sends old choices.
  await card.getByRole('radio', { name: 'Audio sounded unclear' }).check();
  await card.screenshot({ path: testInfo.outputPath('session-feedback-choice.png') });
  await card.getByRole('button', { name: 'Share feedback' }).dblclick();
  await expect(card.getByRole('status')).toContainText('Delivery isn’t confirmed');
  await expect(card.getByRole('radio')).toHaveCount(0);
  const rows = await feedbackRows(page); expect(rows).toHaveLength(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimalpairs.progress.v1')).sessions.at(-1));
  expect(rows[0]).toMatchObject({ attempt_id: saved.id, language_id: 'fr', contrast_id: 'fr-u-y', audio_collection: saved.audioCollectionId, feedback_category: 'audio_unclear', environment: 'preview' });
  for (const field of ['correct','total','text_hints_used','recommendation_id','email','uid','comment','word','answer']) expect(rows[0]).not.toHaveProperty(field);
  expect(JSON.stringify(rows)).not.toMatch(/private_probe|not-feedback|@/);
  expect(intercepted.every(path => path === '/gtag/js')).toBe(true);
  await card.getByText('How was this session?', { exact: false }).click();
  await card.getByText('How was this session?', { exact: false }).click();
  expect(await feedbackRows(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Analytics choices', exact: true }).click();
  await page.getByRole('button', { name: 'Keep analytics off', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('Delivery isn’t confirmed');
  await expect(card).not.toContainText('Nothing is shared'); // Withdrawal cannot undo an already queued response.
  expect(await feedbackRows(page)).toHaveLength(1);
  await card.screenshot({ path: testInfo.outputPath('session-feedback-queued.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Another mix of this contrast' }).click();
  await expect(answer).toBeEnabled();
  await expect(page.locator('.session-feedback')).toHaveCount(0);
  expect(errors).toEqual([]);
  await testInfo.attach('intercepted-session-feedback', { body: JSON.stringify({ rows, realCompletedSessionId: saved.id, noCollectionBeforeConsent: true, consentWithdrawalClearsSelection: true, repeatedSubmitDeduplicated: true, analyticsDeliveryIntercepted: true, noDeliveryClaim: true }, null, 2), contentType: 'application/json' });
});

import { test, expect } from '@playwright/test';

const enabled = process.env.MINIMALPAIRS_TEST_ANALYTICS_ENABLED === 'true';
const isGoogleAnalytics = url => /(^|\.)(googletagmanager\.com|google-analytics\.com)$/.test(new URL(url).hostname);
const isCollection = url => isGoogleAnalytics(url) && new URL(url).pathname.endsWith('/collect');
function eventRows(request) {
  const base = Object.fromEntries(new URL(request.url()).searchParams);
  const body = request.postData();
  return body ? body.split(/\r?\n/).filter(Boolean).map(line => ({ ...base, ...Object.fromEntries(new URLSearchParams(line)) })) : [base];
}

test('explicit analytics choice gates real collection and a completed ABX funnel', async ({ page }, testInfo) => {
  test.skip(!enabled, 'Run against a preview explicitly built with analytics enabled.');
  const requests = [], rows = [], received = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (isGoogleAnalytics(request.url())) requests.push(request.url());
    if (isCollection(request.url())) rows.push(...eventRows(request));
  });
  page.on('response', response => { if (isCollection(response.url())) received.push(response.status()); });
  // A regression cannot send a real account email during this isolated test.
  await page.route(/identitytoolkit\.googleapis\.com\/.*accounts:(sendOobCode|signUp|resetPassword|update)/, route => route.abort());
  await page.goto('/practice?language=fr&contrast=fr-u-y&private_probe=must-not-collect#hidden-probe');
  const choice = page.getByRole('region', { name: 'Usage analytics choices' });
  await expect(choice).toBeVisible();
  const choiceBounds = await choice.boundingBox();
  expect(choiceBounds.x).toBeGreaterThanOrEqual(0);
  expect(choiceBounds.x + choiceBounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.screenshot({ path: testInfo.outputPath('analytics-choice.png'), fullPage: true });
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Keep analytics off', exact: true }).click();
  await expect(choice).toHaveCount(0);
  const answerA = page.locator('.abx-answer-options .answer-card').nth(0);
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  await expect(answerA).toBeEnabled();
  await answerA.click();
  await expect(page.locator('.answer-feedback')).toBeVisible();
  expect(requests).toEqual([]);

  await page.getByRole('button', { name: 'Analytics choices', exact: true }).click();
  await page.getByRole('button', { name: 'Allow usage analytics', exact: true }).click();
  await expect.poll(() => rows.filter(row => row.en === 'page_view').length).toBe(1);
  expect(rows.some(row => row.en === 'practice_start')).toBe(false);
  expect(rows.some(row => row.en === 'practice_first_answer')).toBe(false);
  // A reload starts a fresh, fully observed attempt; the pre-consent attempt is
  // deliberately absent rather than being inserted into the funnel afterward.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  for (let round = 1; round <= 12; round++) {
    await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
    await expect(answerA).toBeEnabled();
    await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
    await answerA.click();
    await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
  }
  await expect(page.getByRole('heading', { name: 'You made time to listen.' })).toBeVisible();
  const suggestion = page.getByRole('region', { name: 'Your next listening suggestion' });
  await suggestion.scrollIntoViewIfNeeded();
  await expect.poll(() => rows.filter(row => row.en === 'practice_complete').length).toBe(1);
  await expect.poll(() => rows.some(row => row.en === 'review_shown')).toBe(true);
  for (const name of ['practice_start', 'practice_first_answer', 'practice_complete']) {
    expect(rows.filter(row => row.en === name)).toHaveLength(1);
  }
  const practice = rows.filter(row => row.en?.startsWith('practice_'));
  expect(new Set(practice.map(row => row['ep.attempt_id'])).size).toBe(1);
  expect(practice.every(row => row['ep.language_id'] === 'fr' && row['ep.contrast_id'] === 'fr-u-y')).toBe(true);
  expect(practice.every(row => row['ep.environment'] === 'preview')).toBe(true);
  expect(practice.every(row => row['ep.debug_mode'] === 'true' || row._dbg === '1')).toBe(true);
  expect(rows.every(row => !String(row.dl || '').includes('?') && !String(row.dl || '').includes('#'))).toBe(true);
  expect(JSON.stringify(rows)).not.toMatch(/must-not-collect|hidden-probe|private_probe/);
  expect(rows.every(row => !row.dr)).toBe(true);
  expect(rows.some(row => row.en === 'form_start' || row.en === 'form_submit')).toBe(false);
  await expect.poll(() => received.length).toBeGreaterThan(0);
  expect(received.every(status => status === 204 || status === 200)).toBe(true);

  // Follow the visible suggestion and complete its actual target. Attribution
  // comes from this consented same-tab click, never URL tracking or seeded data.
  await expect(suggestion.getByRole('link')).toHaveAttribute('href', '/practice?language=fr&contrast=fr-an-on');
  await suggestion.getByRole('link').click();
  await expect(page).toHaveURL(/\/practice\/?\?language=fr&contrast=fr-an-on$/);
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  for (let round = 1; round <= 12; round++) {
    await expect(page.locator('.round-counter')).toHaveText(`${round} / 12`);
    await expect(answerA).toBeEnabled();
    await expect(page.locator('.abx-heard-mark')).toHaveCount(3);
    await answerA.click();
    await page.getByRole('button', { name: round === 12 ? 'See your session' : 'Next round' }).click();
  }
  await expect(page.getByRole('heading', { name: 'You made time to listen.' })).toBeVisible();
  await expect.poll(() => rows.filter(row => row.en === 'review_practice_complete').length).toBe(1);
  const followed = rows.filter(row => ['review_open', 'review_practice_start', 'review_practice_complete'].includes(row.en));
  expect(followed.map(row => row.en).sort()).toEqual(['review_open', 'review_practice_complete', 'review_practice_start']);
  expect(new Set(followed.map(row => row['ep.recommendation_id'])).size).toBe(1);
  expect(followed.every(row => row['ep.contrast_id'] === 'fr-an-on' && row['ep.language_id'] === 'fr' && row['ep.recommendation_surface'] === 'completion' && row['ep.recommendation_kind'] === 'explore')).toBe(true);
  const attributed = rows.filter(row => row.en?.startsWith('practice_') && row['ep.recommendation_id'] === followed[0]['ep.recommendation_id']);
  expect(attributed.map(row => row.en).sort()).toEqual(['practice_complete', 'practice_first_answer', 'practice_start']);
  expect(new Set(attributed.map(row => row['ep.attempt_id'])).size).toBe(1);
  expect(attributed[0]['ep.attempt_id']).not.toBe(practice[0]['ep.attempt_id']);
  expect(rows.some(row => row.en === 'review_shown' && row['ep.recommendation_id'] === followed[0]['ep.recommendation_id'])).toBe(true);

  await page.getByRole('button', { name: 'Analytics choices', exact: true }).click();
  await page.getByRole('button', { name: 'Keep analytics off', exact: true }).click();
  const beforeWithdrawal = rows.length;
  await page.reload();
  await page.getByRole('button', { name: 'Start with A, B & X' }).click();
  await expect(answerA).toBeEnabled();
  await answerA.click();
  expect(rows).toHaveLength(beforeWithdrawal);
  expect(await page.context().cookies()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: '_ga' })]));
  expect(errors).toEqual([]);
  await testInfo.attach('real-analytics-network-check', { body: JSON.stringify({ events: rows.map(row => ({ event: row.en, page: row.dl, environment: row['ep.environment'], debug: row['ep.debug_mode'] || row._dbg, contrast: row['ep.contrast_id'], recommendation: row['ep.recommendation_id'], attempt: row['ep.attempt_id'] })), responseStatuses: received, noCollectionBeforeConsent: true, noCollectionAfterWithdrawal: true, realSuggestedTargetCompleted: true }, null, 2), contentType: 'application/json' });
});

test('a blocked analytics tag cannot hold a suggested lesson navigation', async ({ page }) => {
  test.skip(!enabled, 'Run against a preview explicitly built with analytics enabled.');
  await page.route('https://www.googletagmanager.com/gtag/js**', route => route.abort());
  await page.goto('/account');
  await page.getByRole('button', { name: 'Allow usage analytics', exact: true }).click();
  const link = page.getByRole('region', { name: 'Your next listening suggestion' }).getByRole('link');
  await expect(link).toBeVisible();
  const target = await link.getAttribute('href');
  await link.click();
  await expect.poll(() => { const current = new URL(page.url()), expected = new URL(target, page.url()); return current.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '') && current.search === expected.search; }, { timeout: 3000 }).toBe(true);
  await expect(page.getByRole('button', { name: 'Start with A, B & X' })).toBeEnabled();
});

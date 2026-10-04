import { test, expect } from '@playwright/test';
import { keepAnalyticsOff } from './analytics-choice.mjs';

test('free preview exposes no checkout or portal and makes no billing requests', async ({ page }) => {
  test.skip(process.env.MINIMALPAIRS_TEST_BILLING_ENABLED === 'true', 'This regression checks the deliberately disabled release.');
  const calls = [];
  await page.route(url => /^\/billing\/(checkout|portal)$/.test(url.pathname), route => { calls.push(route.request().url()); return route.abort(); });
  for (const path of ['/pricing', '/account?billing=return', '/pricing?billing=cancel']) {
    await page.goto(path);
    if (path === '/pricing') await keepAnalyticsOff(page);
    await expect(page.locator('#membership')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Choose monthly|Choose annual|Resume .* checkout|Manage existing billing/ })).toHaveCount(0);
  }
  await expect(page.getByText('Paid plans are not on sale in this preview.', { exact: false })).toBeVisible();
  expect(calls).toEqual([]);
});

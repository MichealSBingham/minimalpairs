import { test, expect } from '@playwright/test';
import { startMembershipFixture } from './membership-fixture-server.mjs';
let fixture;
test.beforeAll(async () => { fixture = await startMembershipFixture(); });
test.afterAll(async () => { await fixture?.close(); });
async function open(page, search = '', disabled = false) {
  const calls = [];
  await page.route('https://billing.example.invalid/**', route => { calls.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() }); return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'billing_not_enabled' }) }); });
  await page.goto(`${fixture.origin}/${disabled ? 'disabled' : 'enabled'}${search}`);
  await page.waitForFunction(() => Boolean(window.billingFixture));
  return calls;
}
test('disabled membership leaves no controls or automatic auth/billing requests', async ({ page }) => {
  const calls = await open(page, '?billing=return', true);
  await expect(page.locator('#membership')).toHaveCount(0);
  expect(await page.evaluate(() => window.billingFixture.calls)).toEqual([]); expect(calls).toEqual([]);
});
test('guest and unverified accounts cannot begin checkout or portal', async ({ page }) => {
  for (const user of ['guest', 'unverified']) {
    const calls = await open(page, `?user=${user}`);
    await expect(page.getByRole('link', { name: user === 'guest' ? 'Go to sign-in' : 'Check your email verification →' })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0); expect(calls).toEqual([]);
  }
});
test('lifetime buyer has confirmed access and no subscription offer or billing upsell', async ({ page }) => {
  const calls = await open(page, '?access=lifetime&billing=return');
  await expect(page.getByRole('heading', { name: 'Your lifetime access is connected.' })).toBeVisible();
  await expect(page.getByText(/You don’t need a subscription/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose|Resume|Manage/ })).toHaveCount(0);
  expect(calls).toEqual([]);
});
test('lost response and reload preserve request identity without a second plan or automatic POST', async ({ page }) => {
  const calls = await open(page);
  await expect(page.getByRole('button', { name: 'Choose monthly' })).toBeEnabled();
  expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Choose monthly' }).dblclick();
  await expect(page.getByRole('alert')).toContainText('could not confirm');
  expect(calls).toHaveLength(1);
  const requestId = calls[0].body.requestId;
  expect(calls[0].body.plan).toBe('monthly');
  await expect(page.getByRole('button', { name: 'Choose annual' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume monthly checkout' })).toBeEnabled();
  expect(calls).toHaveLength(1);
  await page.getByRole('button', { name: 'Resume monthly checkout' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1].body.requestId).toBe(requestId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('server-confirmed absent or expired checkout releases the saved plan only after an explicit check', async ({ page }) => {
  const calls = await open(page);
  await page.getByRole('button', { name: 'Choose monthly' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const originalId = calls[0].body.requestId;
  let inspections = 0;
  await page.route('https://billing.example.invalid/billing/checkout-status', route => { inspections++; expect(route.request().postDataJSON()).toEqual({}); return route.fulfill({ contentType: 'application/json', body: '{"state":"none"}' }); });
  await page.reload(); await expect(page.getByRole('button', { name: 'Resume monthly checkout' })).toBeVisible();
  expect(inspections).toBe(0);
  await page.getByRole('button', { name: 'Check checkout status' }).click();
  await expect(page.getByText(/No unfinished checkout remains/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose annual' })).toBeEnabled();
  expect(inspections).toBe(1); expect(calls).toHaveLength(1);
  await page.getByRole('button', { name: 'Choose annual' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1].body.plan).toBe('annual'); expect(calls[1].body.requestId).not.toBe(originalId);
});

test('a checkout started on another device can be resumed with the same server request identity', async ({ page }) => {
  const calls = await open(page);
  const canonical = '33333333-3333-4333-8333-333333333333';
  await page.route('https://billing.example.invalid/billing/checkout-status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'open', plan: 'annual', requestId: canonical, createdAt: Math.floor(Date.now() / 1000) }) }));
  await page.getByRole('button', { name: 'Check checkout status' }).click();
  await expect(page.getByRole('button', { name: 'Resume annual checkout' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Choose monthly' })).toHaveCount(0);
  expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Resume annual checkout' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(calls).toEqual([{ path: '/billing/checkout', body: { plan: 'annual', requestId: canonical } }]);
});

test('pending and malformed status responses preserve a saved checkout and never claim paid access', async ({ page }) => {
  const calls = await open(page);
  await page.getByRole('button', { name: 'Choose monthly' }).click(); await expect(page.getByRole('alert')).toBeVisible();
  const requestId = calls[0].body.requestId;
  let result = { state: 'pending', plan: 'monthly', requestId, createdAt: Math.floor(Date.now() / 1000) };
  await page.route('https://billing.example.invalid/billing/checkout-status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) }));
  await page.getByRole('button', { name: 'Check checkout status' }).click();
  await expect(page.getByText(/No new payment was started/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume monthly checkout' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Your membership is active.' })).toHaveCount(0);
  result = { state: 'expired' };
  await page.getByRole('button', { name: 'Check checkout status' }).click(); await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume monthly checkout' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Choose annual' })).toHaveCount(0);
  expect(calls).toHaveLength(1);
});

test('fresh canonical checkout replaces earlier portal guidance and confirmed access clears pending guidance', async ({ page }) => {
  const calls = await open(page);
  let result = { state: 'existing_subscription' };
  await page.route('https://billing.example.invalid/billing/checkout-status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) }));
  await page.getByRole('button', { name: 'Check checkout status' }).click();
  await expect(page.getByText(/A subscription is already connected/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose monthly' })).toHaveCount(0);
  result = { state: 'open', plan: 'annual', requestId: '33333333-3333-4333-8333-333333333333', createdAt: Math.floor(Date.now() / 1000) };
  await page.getByRole('button', { name: 'Check checkout status' }).click();
  await expect(page.getByRole('button', { name: 'Resume annual checkout' })).toBeEnabled();
  await expect(page.getByText(/A subscription is already connected/)).toHaveCount(0);
  result = { ...result, state: 'pending' };
  await page.getByRole('button', { name: 'Check checkout status' }).click();
  await expect(page.getByText(/Your previous checkout is still being checked/)).toBeVisible();
  await page.evaluate(() => window.billingFixture.setAccess({ active: true, plan: 'annual', source: 'subscription' }));
  await page.getByRole('button', { name: 'Check access again' }).click();
  await expect(page.getByRole('heading', { name: 'Your membership is active.' })).toBeVisible();
  await expect(page.getByText(/Your previous checkout is still being checked/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume annual checkout' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('minimalpairs.checkout.v1:fixture-buyer'))).toBeNull();
  expect(calls).toEqual([]);
});

test('an account switch while checking expiration cannot clear the original account saved checkout', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Choose monthly' }).click(); await expect(page.getByRole('alert')).toBeVisible();
  let release; const gate = new Promise(resolve => { release = resolve; });
  let started; const seen = new Promise(resolve => { started = resolve; });
  await page.route('https://billing.example.invalid/billing/checkout-status', async route => { started(); await gate; await route.fulfill({ contentType: 'application/json', body: '{"state":"none"}' }); });
  await page.getByRole('button', { name: 'Check checkout status' }).click(); await seen;
  await page.evaluate(() => window.billingFixture.switchAccount('other-fixture-buyer'));
  release();
  await expect(page.getByRole('button', { name: 'Choose annual' })).toBeEnabled();
  await page.evaluate(() => window.billingFixture.switchAccount('fixture-buyer'));
  await expect(page.getByRole('button', { name: 'Resume monthly checkout' })).toBeEnabled();
});
test('return and cancellation markers never grant access; only fresh confirmed read does', async ({ page }) => {
  const calls = await open(page, '?billing=return');
  await expect(page.getByText(/This does not confirm or cancel a payment/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your membership is active.' })).toHaveCount(0);
  await page.evaluate(() => window.billingFixture.setAccess({ active: true, plan: 'annual', source: 'subscription' }));
  await page.getByRole('button', { name: 'Check access again' }).click();
  await expect(page.getByRole('heading', { name: 'Your membership is active.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose annual' })).toHaveCount(0); expect(calls).toEqual([]);
  await page.goto(`${fixture.origin}/enabled?billing=cancel`);
  await expect(page.getByText(/Access is not confirmed yet/)).toBeVisible();
});
test('server read failure hides checkout and never pretends a missing subscription', async ({ page }) => {
  const calls = await open(page);
  await expect(page.getByRole('button', { name: 'Choose monthly' })).toBeVisible();
  await page.evaluate(() => { window.billingFixture.failRead = true; });
  await page.getByRole('button', { name: 'Check access again' }).click();
  await expect(page.getByRole('alert')).toContainText('server is unavailable');
  await expect(page.getByRole('button', { name: 'Choose monthly' })).toHaveCount(0); expect(calls).toEqual([]);
});
test('account switch during an in-flight checkout suppresses stale navigation and isolates pending state', async ({ page }) => {
  await open(page);
  let release; const gate = new Promise(resolve => { release = resolve; });
  let started; const seen = new Promise(resolve => { started = resolve; });
  await page.route('https://billing.example.invalid/billing/checkout', async route => { started(); await gate; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://checkout.stripe.com/synthetic-fixture' }) }); });
  await page.getByRole('button', { name: 'Choose monthly' }).click(); await seen;
  await page.evaluate(() => window.billingFixture.switchAccount('other-fixture-buyer'));
  release();
  await expect(page.getByRole('button', { name: 'Choose annual' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Resume monthly checkout' })).toHaveCount(0);
  expect(new URL(page.url()).origin).toBe(fixture.origin);
  await page.evaluate(() => window.billingFixture.switchAccount('fixture-buyer'));
  await expect(page.getByRole('button', { name: 'Resume monthly checkout' })).toBeEnabled();
});
test('existing membership opens only a user-requested portal with empty body', async ({ page }) => {
  const calls = await open(page, '?access=monthly');
  await expect(page.getByRole('button', { name: 'Choose monthly' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage existing billing' })).toBeEnabled(); expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Manage existing billing' }).click();
  await expect(page.getByRole('alert')).toBeVisible(); expect(calls).toEqual([{ path: '/billing/portal', body: {} }]);
});
test('another tab cannot open a simultaneous checkout or create a second request identity', async ({ page, context }) => {
  await open(page);
  let release; const gate = new Promise(resolve => { release = resolve; });
  let started; const seen = new Promise(resolve => { started = resolve; });
  await page.route('https://billing.example.invalid/billing/checkout', async route => { started(); await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"billing_not_enabled"}' }); });
  await page.getByRole('button', { name: 'Choose monthly' }).click(); await seen;
  const other = await context.newPage(); const calls = await open(other);
  await other.getByRole('button', { name: 'Resume monthly checkout' }).click();
  await expect(other.getByRole('alert')).toContainText('another tab'); expect(calls).toEqual([]);
  release(); await expect(page.getByRole('alert')).toBeVisible(); await other.close();
});
test('hosted checkout navigation is explicit; return confirmation retires only the confirmed account request', async ({ page }) => {
  await open(page);
  await page.route('https://billing.example.invalid/billing/checkout', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"url":"https://checkout.stripe.com/synthetic-fixture"}' }));
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Synthetic hosted checkout</h1>' }));
  await page.getByRole('button', { name: 'Choose annual' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic hosted checkout' })).toBeVisible();
  await page.goto(`${fixture.origin}/enabled?billing=return&access=monthly`);
  await expect(page.getByRole('heading', { name: 'Your membership is active.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('minimalpairs.checkout.v1:fixture-buyer'))).toBeNull();
});
test('configured offer shows recurring USD totals and remains readable at the tested viewport', async ({ page }, testInfo) => {
  await open(page);
  await expect(page.getByRole('button', { name: 'Choose monthly' })).toBeVisible();
  await expect(page.locator('#membership')).toContainText('$9 USD / month');
  await expect(page.locator('#membership')).toContainText('$79 USD / year');
  await expect(page.locator('#membership')).toContainText('current preview exercises and practice tools remain free');
  await expect(page.locator('#membership')).toContainText('Cancellation does not itself issue a refund');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#membership').screenshot({ path: testInfo.outputPath('membership-configured-fixture.png') });
  await page.goto(`${fixture.origin}/enabled?sidebar=1`);
  await expect(page.getByRole('button', { name: 'Choose annual' })).toBeVisible();
  expect(await page.evaluate(() => {
    const panel = document.querySelector('#membership');
    return panel.scrollWidth <= panel.clientWidth && document.documentElement.scrollWidth <= innerWidth;
  })).toBe(true);
  await page.locator('#membership').screenshot({ path: testInfo.outputPath('membership-account-sidebar-fixture.png') });
});

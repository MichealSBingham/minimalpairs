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
  const help = page.locator('.membership-help');
  if (await help.count()) await help.evaluate(node => { node.open = true; });
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
    await expect(page.getByRole('link', { name: user === 'guest' ? 'Sign in with Google' : 'Your account →' })).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0); expect(calls).toEqual([]);
  }
});
test('lifetime buyer has confirmed access and no subscription offer or billing upsell', async ({ page }) => {
  const calls = await open(page, '?access=lifetime&billing=return');
  await expect(page.getByRole('heading', { name: 'Your lifetime access is connected.' })).toBeVisible();
  await expect(page.getByText(/No subscription is needed/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose|Resume|Manage/ })).toHaveCount(0);
  expect(calls).toEqual([]);
});
test('lost response and reload preserve request identity without a second plan or automatic POST', async ({ page }) => {
  const calls = await open(page);
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeEnabled();
  expect(calls).toEqual([]);
  await page.locator('.plan-monthly').getByRole('button').dblclick();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(calls).toHaveLength(1);
  const requestId = calls[0].body.requestId;
  expect(calls[0].body.plan).toBe('monthly');
  await expect(page.getByRole('button', { name: 'Choose lifetime' })).toBeEnabled();
  await page.reload(); await page.locator('.membership-help').evaluate(node => { node.open = true; });
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeEnabled();
  expect(calls).toHaveLength(1);
  await page.route('https://billing.example.invalid/billing/checkout-status', route => route.fulfill({contentType:'application/json',body:JSON.stringify({state:'pending',plan:'monthly',requestId,createdAt:Math.floor(Date.now()/1000)})}));
  await page.locator('.plan-monthly').getByRole('button').click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1].body.requestId).toBe(requestId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('server-confirmed absent or expired checkout releases the saved plan only after an explicit check', async ({ page }) => {
  const calls = await open(page);
  await page.locator('.plan-monthly').getByRole('button').click();
  await expect(page.getByRole('alert')).toBeVisible();
  const originalId = calls[0].body.requestId;
  let inspections = 0;
  await page.route('https://billing.example.invalid/billing/checkout-status', route => { inspections++; expect(route.request().postDataJSON()).toEqual({}); return route.fulfill({ contentType: 'application/json', body: '{"state":"none"}' }); });
  await page.reload(); await page.locator('.membership-help').evaluate(node => { node.open = true; }); await expect(page.locator('.plan-monthly').getByRole('button')).toBeVisible();
  expect(inspections).toBe(0);
  await page.getByRole('button', { name: 'Check checkout status' }).click();
  await expect(page.getByText(/No unfinished checkout remains/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose lifetime' })).toBeEnabled();
  expect(inspections).toBe(1); expect(calls).toHaveLength(1);
  await page.getByRole('button', { name: 'Choose lifetime' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(calls).toHaveLength(2); expect(calls[1].body.plan).toBe('lifetime'); expect(calls[1].body.requestId).not.toBe(originalId);
});

test('legacy annual checkout is retained without exposing a new annual offer', async ({page}) => {
 const calls = await open(page); const requestId = '33333333-3333-4333-8333-333333333333';
 await page.route('https://billing.example.invalid/billing/checkout-status', route => route.fulfill({contentType:'application/json',body:JSON.stringify({state:'open',plan:'annual',requestId,createdAt:Math.floor(Date.now()/1000)})}));
 await page.getByRole('button',{name:'Check checkout status'}).click();
 await expect(page.getByText('Your checkout is still open. Choose the same plan to resume it.')).toBeVisible();
 expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('minimalpairs.checkout.v1:fixture-buyer'))).requestId).toBe(requestId);
 await expect(page.getByRole('button',{name:/annual/i})).toHaveCount(0);
 await page.getByRole('button',{name:'Choose lifetime'}).click();
 await expect(page.getByRole('alert')).toBeVisible(); expect(calls).toEqual([]);
});

test('pending and malformed status responses preserve a saved checkout and never claim paid access', async ({ page }) => {
  const calls = await open(page);
  await page.locator('.plan-monthly').getByRole('button').click(); await expect(page.getByRole('alert')).toBeVisible();
  const requestId = calls[0].body.requestId;
  let result = { state: 'pending', plan: 'monthly', requestId, createdAt: Math.floor(Date.now() / 1000) };
  await page.route('https://billing.example.invalid/billing/checkout-status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) }));
  await page.getByRole('button', { name: 'Check checkout status' }).click();
  await expect(page.getByText(/Payment status is being checked/)).toBeVisible();
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Your membership is active.' })).toHaveCount(0);
  result = { state: 'expired' };
  await page.getByRole('button', { name: 'Check checkout status' }).click(); await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Choose lifetime' })).toBeEnabled();
  expect(calls).toHaveLength(1);
});

test('canonical checkout is preserved until fresh access confirms a purchase', async ({page}) => {
 const calls=await open(page); const requestId='33333333-3333-4333-8333-333333333333';
 await page.route('https://billing.example.invalid/billing/checkout-status',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({state:'pending',plan:'lifetime',requestId,createdAt:Math.floor(Date.now()/1000)})}));
 await page.getByRole('button',{name:'Check checkout status'}).click();
 await expect(page.getByText(/Payment status is being checked/)).toBeVisible();
 await page.evaluate(()=>window.billingFixture.setAccess({active:true,plan:'lifetime',source:'one-time-purchase'}));
 await page.getByRole('button',{name:'Check again',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your lifetime access is connected.'})).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('minimalpairs.checkout.v1:fixture-buyer'))).toBeNull();expect(calls).toEqual([]);
});

test('an account switch while checking expiration cannot clear the original account saved checkout', async ({ page }) => {
  await open(page);
  await page.locator('.plan-monthly').getByRole('button').click(); await expect(page.getByRole('alert')).toBeVisible();
  let release; const gate = new Promise(resolve => { release = resolve; });
  let started; const seen = new Promise(resolve => { started = resolve; });
  await page.route('https://billing.example.invalid/billing/checkout-status', async route => { started(); await gate; await route.fulfill({ contentType: 'application/json', body: '{"state":"none"}' }); });
  await page.getByRole('button', { name: 'Check checkout status' }).click(); await seen;
  await page.evaluate(() => window.billingFixture.switchAccount('other-fixture-buyer'));
  release();
  await expect(page.getByRole('button', { name: 'Choose lifetime' })).toBeEnabled();
  await page.evaluate(() => window.billingFixture.switchAccount('fixture-buyer'));
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeEnabled();
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('minimalpairs.checkout.v1:fixture-buyer'))).plan).toBe('monthly');
});
test('return and cancellation markers never grant access; only fresh confirmed read does', async ({ page }) => {
  const calls = await open(page, '?billing=return');
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Your membership is active.' })).toHaveCount(0);
  await page.evaluate(() => window.billingFixture.setAccess({ active: true, plan: 'annual', source: 'subscription' }));
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('heading', { name: 'Your membership is active.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose lifetime' })).toHaveCount(0); expect(calls).toEqual([]);
  await page.goto(`${fixture.origin}/enabled?billing=cancel`);
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Your membership is active.' })).toHaveCount(0);
});
test('server read failure hides checkout and never pretends a missing subscription', async ({ page }) => {
  const calls = await open(page);
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeVisible();
  await page.evaluate(() => { window.billingFixture.failRead = true; });
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.plan-monthly').getByRole('button')).toHaveCount(0); expect(calls).toEqual([]);
});
test('account switch during an in-flight checkout suppresses stale navigation and isolates pending state', async ({ page }) => {
  await open(page);
  let release; const gate = new Promise(resolve => { release = resolve; });
  let started; const seen = new Promise(resolve => { started = resolve; });
  await page.route('https://billing.example.invalid/billing/checkout', async route => { started(); await gate; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://checkout.stripe.com/synthetic-fixture' }) }); });
  await page.locator('.plan-monthly').getByRole('button').click(); await seen;
  await page.evaluate(() => window.billingFixture.switchAccount('other-fixture-buyer'));
  release();
  await expect(page.getByRole('button', { name: 'Choose lifetime' })).toBeEnabled();
  expect(await page.evaluate(()=>localStorage.getItem('minimalpairs.checkout.v1:other-fixture-buyer'))).toBeNull();
  expect(new URL(page.url()).origin).toBe(fixture.origin);
  await page.evaluate(() => window.billingFixture.switchAccount('fixture-buyer'));
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeEnabled();
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('minimalpairs.checkout.v1:fixture-buyer'))).plan).toBe('monthly');
});
test('existing membership opens only a user-requested portal with empty body', async ({ page }) => {
  const calls = await open(page, '?access=monthly');
  await expect(page.locator('.plan-monthly').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage subscription' }).first()).toBeEnabled(); expect(calls).toEqual([]);
  await page.getByRole('button', { name: 'Manage subscription' }).first().click();
  await expect(page.getByRole('alert')).toBeVisible(); expect(calls).toEqual([{ path: '/billing/portal', body: {} }]);
});
test('another tab cannot open a simultaneous checkout or create a second request identity', async ({ page, context }) => {
  await open(page);
  let release; const gate = new Promise(resolve => { release = resolve; });
  let started; const seen = new Promise(resolve => { started = resolve; });
  await page.route('https://billing.example.invalid/billing/checkout', async route => { started(); await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"billing_not_enabled"}' }); });
  await page.locator('.plan-monthly').getByRole('button').click(); await seen;
  const other = await context.newPage(); const calls = await open(other);
  await other.locator('.plan-monthly').getByRole('button').click();
  await expect(other.getByRole('alert')).toBeVisible(); expect(calls).toEqual([]);
  release(); await expect(page.getByRole('alert')).toBeVisible(); await other.close();
});
test('hosted checkout navigation is explicit; return confirmation retires only the confirmed account request', async ({ page }) => {
  await open(page);
  await page.route('https://billing.example.invalid/billing/checkout', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"url":"https://checkout.stripe.com/synthetic-fixture"}' }));
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Synthetic hosted checkout</h1>' }));
  await page.getByRole('button', { name: 'Choose lifetime' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic hosted checkout' })).toBeVisible();
  await page.goto(`${fixture.origin}/enabled?billing=return&access=lifetime`);
  await expect(page.getByRole('heading', { name: 'Your lifetime access is connected.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('minimalpairs.checkout.v1:fixture-buyer'))).toBeNull();
});
test('configured offer shows monthly and one-time USD totals and remains readable at the tested viewport', async ({ page }, testInfo) => {
  await open(page);
  await expect(page.locator('.plan-monthly').getByRole('button')).toBeVisible();
  await expect(page.locator('#membership')).toContainText('$7 USD / month');
  await expect(page.locator('#membership')).toContainText('$29 USD one time');
  await expect(page.locator('#membership')).toContainText('All current courses and improvements to them');
  await expect(page.locator('#membership')).toContainText('No recurring payments');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#membership').screenshot({ path: testInfo.outputPath('membership-configured-fixture.png') });
  await page.goto(`${fixture.origin}/enabled?sidebar=1`);
  await expect(page.getByRole('button', { name: 'Choose lifetime' })).toBeVisible();
  expect(await page.evaluate(() => {
    const panel = document.querySelector('#membership');
    return panel.scrollWidth <= panel.clientWidth && document.documentElement.scrollWidth <= innerWidth;
  })).toBe(true);
  await page.locator('#membership').screenshot({ path: testInfo.outputPath('membership-account-sidebar-fixture.png') });
});

test('selected plan survives account handoff without automatic checkout',async({page})=>{
 const calls=await open(page,'?plan=lifetime');
 await expect(page.locator('.plan-lifetime')).toHaveClass(/plan-selected/);
 await expect(page.locator('.plan-selected').getByRole('button',{name:'Choose lifetime'})).toBeEnabled();
 expect(calls).toEqual([]);
 await page.locator('.plan-selected').getByRole('button',{name:'Choose lifetime'}).click();
 await expect(page.getByRole('alert')).toBeVisible();expect(calls[0].body.plan).toBe('lifetime');
});

test('guest plan links preserve monthly and lifetime choices',async({page})=>{
 const calls=await open(page,'?user=guest&storefront=1');
 for(const plan of ['monthly','lifetime'])await expect(page.locator('.plan-'+plan+' a.button')).toHaveAttribute('href','/account?plan='+plan+'#account-sign-in');
 expect(calls).toEqual([]);
});

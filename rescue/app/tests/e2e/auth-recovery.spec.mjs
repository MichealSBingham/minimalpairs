import { test, expect } from '@playwright/test';

// Match the release being checked. Omitted flags retain the disabled regression.
const providerEnabled = process.env.MINIMALPAIRS_TEST_EMAIL_PASSWORD_ENABLED === 'true';
const deliveryEnabled = process.env.MINIMALPAIRS_TEST_AUTH_EMAILS_ENABLED === 'true';
const mutationPattern = /accounts:(sendOobCode|signUp|resetPassword|update|signInWithPassword)/;
async function guardAccountMutations(page) {
  const mutations = [];
  await page.route(url => url.hostname === 'identitytoolkit.googleapis.com', async route => {
    if (mutationPattern.test(route.request().url())) {
      mutations.push(new URL(route.request().url()).pathname);
      await route.abort(); // A UI regression must never deliver email or create an account.
    } else await route.continue();
  });
  return mutations;
}
async function expectAvailability(locator, enabled) {
  if (enabled) await expect(locator).toBeEnabled();
  else await expect(locator).toBeDisabled();
}

test(`email recovery forms reflect provider=${providerEnabled}, delivery=${deliveryEnabled} without automatic messages`, async ({ page }) => {
  const mutations = await guardAccountMutations(page);
  await page.goto('/account');
  await page.getByText('Use email and password', { exact: true }).click();
  const unavailable = page.getByText('Email and password sign-in is being prepared.', { exact: false });
  if (providerEnabled) await expect(unavailable).toHaveCount(0);
  else await expect(unavailable).toBeVisible();
  await expectAvailability(page.getByRole('button', { name: 'Sign in with email', exact: true }), providerEnabled);
  await expectAvailability(page.getByLabel('Email address', { exact: true }), providerEnabled);
  await expectAvailability(page.getByLabel('Password', { exact: true }), providerEnabled);
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expectAvailability(page.getByRole('button', { name: 'Send password reset email', exact: true }), providerEnabled && deliveryEnabled);
  const deliveryUnavailable = page.getByText('Verification and reset emails are not available yet.', { exact: false });
  if (deliveryEnabled) await expect(deliveryUnavailable).toHaveCount(0);
  else await expect(deliveryUnavailable).toBeVisible();
  await expect(page.locator('.email-auth input[type="password"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create account', exact: true }).first().click();
  await expectAvailability(page.locator('.email-auth form').getByRole('button', { name: 'Create account', exact: true }), providerEnabled && deliveryEnabled);
  await expectAvailability(page.getByLabel('Confirm new password', { exact: true }), providerEnabled);
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('minlength', '12');
  await expect(page.locator('.email-auth')).toContainText('You’ll request verification separately after creating your account.');
  await expect(page.locator('.email-auth')).toContainText('If you previously signed in with Google, use Google to keep the same account.');
  // No credentials are entered, and no form is submitted in either flag state.
  expect(mutations).toEqual([]);
});

test('invalid account action removes query tokens and has no analytics or automatic action', async ({ page }) => {
  const mutations = await guardAccountMutations(page);
  await page.goto('/auth/action?mode=verifyEmail&oobCode=example-invalid-code&apiKey=wrong-project&continueUrl=https%3A%2F%2Fexample.invalid');
  await expect(page.getByRole('alert')).toContainText('This link is invalid');
  await expect(page).toHaveURL(/\/auth\/action$/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  await expect(page.locator('script[src*="googletagmanager"],script[src*="google-analytics"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verify this email', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Return to your account', exact: false })).toHaveAttribute('href', '/account');
  expect(mutations).toEqual([]);
});

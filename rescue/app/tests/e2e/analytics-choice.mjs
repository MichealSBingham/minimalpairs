import { expect } from '@playwright/test';

// Exercise the visible choice instead of preloading consent into browser storage.
export async function keepAnalyticsOff(page) {
  if (await page.locator('html').getAttribute('data-measurement-id')) {
    const decline = page.getByRole('button', { name: 'Keep analytics off', exact: true });
    await expect(decline).toBeVisible();
    await decline.click();
  }
}

import { expect, test } from '@playwright/test';

test('opens the local searchable OCR workspace and explains its limits', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');

  await page.getByRole('button', { name: 'Open searchable OCR tool' }).click();

  await expect(page.getByRole('heading', { name: 'Searchable OCR' })).toBeVisible();
  await expect(page.getByText('English OCR only in this first version')).toBeVisible();
  await expect(page.getByText('Limit: 150 MB and 100 pages.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make searchable' })).toBeDisabled();
});

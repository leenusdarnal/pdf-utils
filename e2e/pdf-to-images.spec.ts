import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function createTwoPagePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const label of ['First image export page', 'Second image export page']) {
    const page = document.addPage([612, 792]);
    page.drawText(label, { x: 72, y: 700, size: 24, font });
  }
  return Buffer.from(await document.save());
}

test('exports selected PDF pages as images and creates a ZIP download', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open PDF to images tool' }).click();

  await page.locator('#images-file-input').setInputFiles({
    name: 'pdf-utils-images.pdf',
    mimeType: 'application/pdf',
    buffer: await createTwoPagePdf()
  });

  await expect(page.getByRole('status')).toContainText('2 pages ready to export.');
  await page.getByLabel('Pages to export').fill('2');
  await page.getByRole('button', { name: 'Convert pages' }).click();

  await expect(page.locator('[data-image-output="2"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-image-output="2"]')).toContainText('pdf-utils-images-page-2.png');

  const [imageDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download page 2' }).click()
  ]);
  expect(imageDownload.suggestedFilename()).toBe('pdf-utils-images-page-2.png');

  const [zipDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download all as ZIP' }).click()
  ]);
  expect(zipDownload.suggestedFilename()).toBe('pdf-utils-images-images.zip');
});

test('persists the selected dark theme after reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('pdf-utils-theme')) {
      localStorage.setItem('pdf-utils-theme', 'light');
    }
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
});

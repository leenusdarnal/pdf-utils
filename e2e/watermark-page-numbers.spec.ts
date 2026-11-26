import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function createTwoPagePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  document.addPage([420, 300]);
  return Buffer.from(await document.save());
}

test('adds watermark and page numbers to selected pages and downloads a new PDF', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open watermark and page numbers tool' }).click();

  await page.locator('#watermark-file-input').setInputFiles({
    name: 'watermark-regression.pdf',
    mimeType: 'application/pdf',
    buffer: await createTwoPagePdf()
  });
  await expect(page.getByLabel('Pages to update')).toHaveValue('1-2');
  await page.getByLabel('Pages to update').fill('2');
  await page.getByLabel('Watermark text').fill('CONFIDENTIAL');
  await expect(page.getByText('Live preview')).toBeVisible();
  await page.getByRole('button', { name: 'Apply overlays' }).click();
  await expect(page.getByRole('heading', { name: 'Your updated PDF is ready' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('watermark-regression-watermarked.pdf');
});

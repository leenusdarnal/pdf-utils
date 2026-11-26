import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function createScannedPdf(page: Page): Promise<Buffer> {
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable in this browser.');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    context.font = 'bold 76px Arial';
    context.fillText('SEARCHABLE DOCUMENT', 80, 520);
    context.fillText('PAGE NUMBER 42', 80, 720);
    context.font = '42px Arial';
    context.fillText('OCR BROWSER REGRESSION FIXTURE', 80, 900);

    return canvas.toDataURL('image/png').split(',')[1];
  });

  const document = await PDFDocument.create();
  const image = await document.embedPng(Buffer.from(pngBase64, 'base64'));
  const pdfPage = document.addPage([612, 792]);
  pdfPage.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });

  return Buffer.from(await document.save());
}

test('opens the local searchable OCR workspace and explains its limits', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');

  await page.getByRole('button', { name: 'Open searchable OCR tool' }).click();

  await expect(page.getByRole('heading', { name: 'Searchable OCR' })).toBeVisible();
  await expect(page.getByText('English OCR only in this first version')).toBeVisible();
  await expect(page.getByText('Limit: 150 MB and 100 pages.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make searchable' })).toBeDisabled();
});

test('runs the self-hosted English OCR engine and downloads a searchable PDF copy', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open searchable OCR tool' }).click();

  await page.locator('#ocr-file-input').setInputFiles({
    name: 'scanned-ocr-regression.pdf',
    mimeType: 'application/pdf',
    buffer: await createScannedPdf(page)
  });

  await expect(page.getByRole('button', { name: 'Make searchable' })).toBeEnabled();
  await page.getByRole('button', { name: 'Make searchable' }).click();

  await expect(page.getByRole('heading', { name: 'Your searchable PDF is ready' })).toBeVisible({
    timeout: 100_000
  });
  await expect(page.getByText(/words added\./)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('scanned-ocr-regression-searchable.pdf');
});

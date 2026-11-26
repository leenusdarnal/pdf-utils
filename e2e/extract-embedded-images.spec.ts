import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

test('extracts an embedded image resource rather than a rendered page screenshot', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open extract embedded images tool' }).click();

  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available in this browser.');
    context.fillStyle = '#1d5fa7';
    context.fillRect(0, 0, 80, 120);
    context.fillStyle = '#e8a44f';
    context.fillRect(80, 0, 80, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  });

  const document = await PDFDocument.create();
  const embeddedImage = await document.embedPng(Buffer.from(pngBase64, 'base64'));
  const pdfPage = document.addPage([612, 792]);
  pdfPage.drawImage(embeddedImage, { x: 100, y: 220, width: 320, height: 240 });
  const originalPdf = await document.save();

  await page.locator('#extract-images-pdf-input').setInputFiles({
    name: 'embedded-photo.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(originalPdf)
  });
  await expect(page.getByTitle('embedded-photo.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Extract images' }).click();

  await expect(page.getByRole('heading', { name: '1 extracted image' })).toBeVisible({
    timeout: 60_000
  });
  await expect(page.getByText('Page 1 · 160 × 120')).toBeVisible();
  await expect(page.getByText('Image XObject · PNG export')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PNG' }).click()
  ]);
  expect(download.suggestedFilename()).toMatch(/embedded-photo-image-001-page-1\.png$/);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('The browser did not provide an extracted PNG path.');

  const imageBytes = await readFile(downloadPath);
  const dimensions = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  }, imageBytes.toString('base64'));
  expect(dimensions).toEqual({ width: 160, height: 120 });
});

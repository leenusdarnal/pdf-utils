import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

test('previews and compresses an image-heavy PDF without overwriting the original', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open compress PDF tool' }).click();

  const pngBase64 = await page.evaluate(() => {
    const width = 1200;
    const height = 1600;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available in this browser.');

    const pixels = context.createImageData(width, height);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const seed = (pixel * 9301 + 49297) % 233280;
      const value = Math.floor((seed / 233280) * 256);
      const offset = pixel * 4;
      pixels.data[offset] = value;
      pixels.data[offset + 1] = (value * 3 + 41) % 256;
      pixels.data[offset + 2] = (value * 7 + 89) % 256;
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });

  const sourceDocument = await PDFDocument.create();
  const image = await sourceDocument.embedPng(Buffer.from(pngBase64, 'base64'));
  for (let index = 0; index < 3; index += 1) {
    const sourcePage = sourceDocument.addPage([612, 792]);
    sourcePage.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  }
  const originalBytes = await sourceDocument.save();
  expect(originalBytes.length).toBeGreaterThan(100 * 1024);

  await page.locator('#compress-pdf-input').setInputFiles({
    name: 'large-scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(originalBytes)
  });
  await expect(page.getByText('large-scan.pdf', { exact: true })).toBeVisible();
  await page.getByLabel('Compression preset').selectOption('screen');

  await page.getByRole('button', { name: 'Preview first page' }).click();
  await expect(page.locator('img[alt^="First page preview"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compress PDF' })).toBeDisabled();

  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Compress PDF' }).click();
  await expect(page.getByRole('heading', { name: 'Compression result' })).toBeVisible({
    timeout: 120_000
  });
  await expect(page.getByText(/Saved .* smaller\./)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download compressed copy' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('large-scan-compressed.pdf');
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('The browser did not provide the compressed PDF path.');

  const compressedBytes = await readFile(downloadPath);
  expect(compressedBytes.length).toBeLessThan(originalBytes.length);
  const compressedDocument = await PDFDocument.load(compressedBytes);
  expect(compressedDocument.getPageCount()).toBe(3);
  expect(originalBytes.length).toBeGreaterThan(compressedBytes.length);
});

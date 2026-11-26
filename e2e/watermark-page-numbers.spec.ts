import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { degrees, PDFDocument } from 'pdf-lib';

async function createSourcePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([300, 400]);
  const rotatedPage = document.addPage([420, 300]);
  rotatedPage.setRotation(degrees(90));
  document.addPage([500, 700]);
  return Buffer.from(await document.save());
}

async function openWatermarkTool(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open watermark and page numbers tool' }).click();
  await expect(page.getByRole('heading', { name: 'Watermark & Page Numbers' })).toBeVisible();
}

test('adds a text watermark and custom page numbers to selected pages', async ({ page }) => {
  await openWatermarkTool(page);
  const source = await createSourcePdf();
  await page.locator('input[aria-label="Choose source PDF"]').setInputFiles({
    name: 'watermark-source.pdf',
    mimeType: 'application/pdf',
    buffer: source
  });

  await expect(page.getByText(/3 pages ·/)).toBeVisible();
  await page.getByLabel('Page range').fill('2-3');
  await page.getByLabel('Watermark text').fill('CONFIDENTIAL');
  await page.getByLabel('Number format').selectOption('slash-total');
  await page.getByLabel('Start numbering at').fill('5');
  await page.getByLabel('Placement', { exact: false }).first().selectOption('center');

  const preview = page.locator('aside[aria-label="Overlay placement preview"]');
  await expect(preview).toContainText('CONFIDENTIAL');
  await expect(preview).toContainText('5 / 7');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Apply overlays & download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('watermark-source-watermarked.pdf');
  const outputPath = await download.path();
  expect(outputPath).not.toBeNull();

  const output = await PDFDocument.load(await readFile(outputPath!));
  expect(output.getPageCount()).toBe(3);
  expect(output.getPage(1).getRotation().angle).toBe(90);
  expect(output.getPage(0).getSize()).toEqual([300, 400]);
  expect(new Uint8Array(await readFile(outputPath!)).byteLength).toBeGreaterThan(source.byteLength);

  await page.getByLabel('Page range').fill('1-4');
  await page.getByRole('button', { name: 'Apply overlays & download PDF' }).click();
  await expect(page.getByRole('alert')).toContainText('between 1 and 3');
});

test('embeds a PNG logo watermark while retaining page numbering', async ({ page }) => {
  await openWatermarkTool(page);
  const source = await createSourcePdf();
  await page.locator('input[aria-label="Choose source PDF"]').setInputFiles({
    name: 'logo-source.pdf',
    mimeType: 'application/pdf',
    buffer: source
  });
  await expect(page.getByText(/3 pages ·/)).toBeVisible();

  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const png = Buffer.from(pngBase64, 'base64');
  await page.locator('input[aria-label="Choose watermark image"]').setInputFiles({
    name: 'department-logo.png',
    mimeType: 'image/png',
    buffer: png
  });
  await expect(page.getByAltText('Selected watermark preview')).toBeVisible();
  await expect(page.locator('aside[aria-label="Overlay placement preview"]')).toContainText('Page 1 of 3');

  // Turn off the text watermark so this test specifically exercises the image path.
  await page.locator('section[aria-label="Text watermark settings"] input[type="checkbox"]').uncheck();
  await page.getByLabel('Page range').fill('1');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Apply overlays & download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('logo-source-watermarked.pdf');
  const outputPath = await download.path();
  expect(outputPath).not.toBeNull();
  const output = await PDFDocument.load(await readFile(outputPath!));
  expect(output.getPageCount()).toBe(3);
});

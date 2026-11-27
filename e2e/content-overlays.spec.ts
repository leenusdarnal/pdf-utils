import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function createSourcePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Original PDF text remains present', {
    x: 48,
    y: 720,
    size: 18,
    font
  });
  return Buffer.from(await document.save());
}

async function createRedPng(page: import('@playwright/test').Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available.');
    context.fillStyle = '#e51f3d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

async function openOverlayTool(page: import('@playwright/test').Page, source: Buffer) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open text and image overlay tool' }).click();
  await page.locator('#content-overlay-file-input').setInputFiles({
    name: 'content-overlay-source.pdf',
    mimeType: 'application/pdf',
    buffer: source
  });
  await expect(page.getByRole('heading', { name: 'Live page preview' })).toBeVisible({
    timeout: 20_000
  });
  await expect(page.locator('canvas[aria-label="PDF page preview"]')).toBeVisible();
}

async function exportAndReadDownload(page: import('@playwright/test').Page): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export new PDF copy' }).click();
  await expect(page.getByText('New PDF copy ready')).toBeVisible({ timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('content-overlay-source-with-overlay.pdf');
  const path = await download.path();
  if (!path) throw new Error('The downloaded PDF is not available to the test.');
  return readFile(path);
}

async function openExportInViewer(page: import('@playwright/test').Page, bytes: Buffer) {
  await page.getByRole('button', { name: '← Back to tools' }).click();
  await page.locator('#file-input').setInputFiles({
    name: 'content-overlay-export.pdf',
    mimeType: 'application/pdf',
    buffer: bytes
  });
  await expect(page.locator('[aria-label="PDF viewer"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-pdf-continuous-page="1"]')).toBeVisible();
}

test('previews and exports selectable text as a new PDF copy', async ({ page }) => {
  const sourceBytes = await createSourcePdf();
  const originalSnapshot = Buffer.from(sourceBytes);
  await openOverlayTool(page, sourceBytes);

  await page.getByLabel('Text to insert').fill('NEW CONTENT OVERLAY');
  await page.getByLabel('Font size (pt)').fill('28');
  await page.getByLabel('X from left (%)').fill('12');
  await page.getByLabel('Y from bottom (%)').fill('18');
  await expect(page.getByText('NEW CONTENT OVERLAY')).toBeVisible();

  const exportedBytes = await exportAndReadDownload(page);
  expect(sourceBytes).toEqual(originalSnapshot);
  const exportedDocument = await PDFDocument.load(exportedBytes);
  expect(exportedDocument.getPageCount()).toBe(1);

  await openExportInViewer(page, exportedBytes);
  const textLayer = page.locator('[data-pdf-continuous-page="1"] .textLayer');
  await expect(textLayer).toContainText('Original PDF text remains present', { timeout: 20_000 });
  await expect(textLayer).toContainText('NEW CONTENT OVERLAY', { timeout: 20_000 });
});

test('previews and exports an embedded PNG image on a new PDF copy', async ({ page }) => {
  const sourceBytes = await createSourcePdf();
  const originalSnapshot = Buffer.from(sourceBytes);
  await openOverlayTool(page, sourceBytes);

  await page.getByRole('button', { name: 'Image', exact: true }).click();
  const imageBytes = await createRedPng(page);
  await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({
    name: 'red-square.png',
    mimeType: 'image/png',
    buffer: imageBytes
  });
  await expect(page.getByAltText('Image overlay preview')).toBeVisible();
  await page.getByLabel('Image width (% of page)').fill('20');
  await page.getByLabel('X from left (%)').fill('10');
  await page.getByLabel('Y from bottom (%)').fill('10');

  const exportedBytes = await exportAndReadDownload(page);
  expect(sourceBytes).toEqual(originalSnapshot);
  const exportedDocument = await PDFDocument.load(exportedBytes);
  expect(exportedDocument.getPageCount()).toBe(1);

  await openExportInViewer(page, exportedBytes);
  const canvas = page.locator('[data-pdf-continuous-page="1"] canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext('2d');
    if (!context) return false;
    const x = Math.min(target.width - 1, Math.max(0, Math.round(target.width * 0.2)));
    const y = Math.min(target.height - 1, Math.max(0, Math.round(target.height * 0.82)));
    const pixel = context.getImageData(x, y, 1, 1).data;
    return pixel[0] > 180 && pixel[1] < 90 && pixel[2] < 130;
  }), { timeout: 20_000 }).toBe(true);
});

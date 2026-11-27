import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import {
  createImageAndPageBoxesPdf,
  createPasswordProtectedPdf,
  createTruncatedPdf
} from './fixtures/pdf-regression-fixtures';

async function createSolidRedPng(page: import('@playwright/test').Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available in this browser.');
    context.fillStyle = '#e61e3c';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });

  return Buffer.from(base64, 'base64');
}

async function visitHome(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('#file-input')).toHaveCount(1);
}

test('renders selectable text and an embedded image, including rotated crop-box geometry', async ({ page }) => {
  await visitHome(page);
  const fixture = await createImageAndPageBoxesPdf(await createSolidRedPng(page));

  await page.locator('#file-input').setInputFiles({
    name: 'text-image-rotation-page-boxes.pdf',
    mimeType: 'application/pdf',
    buffer: fixture
  });

  await expect(page.locator('[aria-label="PDF viewer"]')).toBeVisible({ timeout: 20_000 });
  const firstPage = page.locator('[data-pdf-continuous-page="1"]');
  const firstCanvas = firstPage.locator('canvas');
  await expect(firstPage.locator('.textLayer')).toContainText(
    'TEXT AND IMAGE REGRESSION FIXTURE',
    { timeout: 20_000 }
  );

  const imagePixel = await firstCanvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Rendered PDF canvas has no 2D context.');
    const x = Math.round(150 * canvas.width / 612);
    const y = Math.round((792 - 450) * canvas.height / 792);
    return Array.from(context.getImageData(x, y, 1, 1).data);
  });
  expect(imagePixel[0]).toBeGreaterThan(180);
  expect(imagePixel[1]).toBeLessThan(100);
  expect(imagePixel[2]).toBeLessThan(120);

  const viewport = page.getByRole('region', { name: 'Document page area' });
  const rotatedPage = page.locator('[data-pdf-continuous-page="2"]');
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect(rotatedPage).toBeInViewport();
  await expect(rotatedPage.locator('.textLayer')).toContainText(
    'ROTATED PAGE WITH CUSTOM CROP BOX',
    { timeout: 20_000 }
  );
  const rotatedDimensions = await rotatedPage.locator('canvas').evaluate((element) => ({
    width: Number.parseFloat((element as HTMLCanvasElement).style.width),
    height: Number.parseFloat((element as HTMLCanvasElement).style.height)
  }));
  expect(rotatedDimensions.width / rotatedDimensions.height).toBeCloseTo(620 / 420, 1);
});

test('rejects a valid password-protected PDF with a clear, safe message', async ({ page }) => {
  await visitHome(page);
  const fixture = createPasswordProtectedPdf();

  await expect(PDFDocument.load(fixture)).rejects.toThrow(/encrypted/i);
  await page.locator('#file-input').setInputFiles({
    name: 'password-protected-regression.pdf',
    mimeType: 'application/pdf',
    buffer: fixture
  });

  await expect(page.getByRole('alert')).toContainText('password-protected', {
    timeout: 20_000
  });
  await expect(page.getByRole('button', { name: 'Return to tools' })).toBeVisible();
});

test('handles a truncated PDF body without leaving the viewer stuck loading', async ({ page }) => {
  await visitHome(page);
  await page.locator('#file-input').setInputFiles({
    name: 'truncated-regression.pdf',
    mimeType: 'application/pdf',
    buffer: createTruncatedPdf()
  });

  await expect(page.getByRole('alert')).toContainText('may be damaged', {
    timeout: 20_000
  });
  await page.getByRole('button', { name: 'Return to tools' }).click();
  await expect(page.getByRole('heading', { name: /Your documents/ })).toBeVisible();
});

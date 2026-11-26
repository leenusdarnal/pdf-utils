import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

async function makeImageFixtures(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const create = (
      name: string,
      width: number,
      height: number,
      mimeType: string,
      color: string
    ) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is not available in this browser.');
      context.fillStyle = color;
      context.fillRect(0, 0, width, height);
      const dataUrl = canvas.toDataURL(mimeType);
      return {
        name,
        mimeType: dataUrl.startsWith('data:image/webp')
          ? 'image/webp'
          : dataUrl.startsWith('data:image/jpeg')
            ? 'image/jpeg'
            : 'image/png',
        base64: dataUrl.split(',')[1]
      };
    };

    return [
      create('portrait.png', 80, 140, 'image/png', '#dce8ff'),
      create('landscape.jpg', 180, 90, 'image/jpeg', '#f5e4d8'),
      create('square.webp', 100, 100, 'image/webp', '#d8f1e6')
    ];
  });
}

test('converts and reorders PNG, JPEG, and WebP images into a multi-page PDF', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open images to PDF tool' }).click();

  const fixtures = await makeImageFixtures(page);
  await page.locator('#images-to-pdf-file-input').setInputFiles(
    fixtures.map((fixture) => ({
      name: fixture.name,
      mimeType: fixture.mimeType,
      buffer: Buffer.from(fixture.base64, 'base64')
    }))
  );

  await expect(page.getByRole('status')).toContainText('3 images are ready.');
  await expect(page.locator('[data-image-name="portrait.png"]')).toBeVisible();
  await expect(page.locator('[data-image-name="landscape.jpg"]')).toBeVisible();
  await expect(page.locator('[data-image-name="square.webp"]')).toBeVisible();

  await page.getByRole('button', { name: 'Move landscape.jpg up' }).click();
  const order = await page.locator('[data-image-name]').evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-image-name'))
  );
  expect(order).toEqual(['landscape.jpg', 'portrait.png', 'square.webp']);

  await page.getByLabel('Page size').selectOption('a4');
  await page.getByLabel('Orientation').selectOption('auto');
  await page.getByLabel('Margins (mm)').fill('10');
  await page.getByLabel('Image fit').selectOption('contain');
  await page.getByLabel('PDF file name').fill('images-export');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Create PDF' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('images-export.pdf');
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('The browser did not provide a downloaded PDF path.');

  const pdf = await PDFDocument.load(await readFile(downloadPath));
  const pages = pdf.getPages();
  expect(pages).toHaveLength(3);

  const firstSize = pages[0].getSize();
  const secondSize = pages[1].getSize();
  const thirdSize = pages[2].getSize();
  expect(firstSize.width).toBeGreaterThan(firstSize.height);
  expect(secondSize.height).toBeGreaterThan(secondSize.width);
  expect(thirdSize.height).toBeGreaterThan(thirdSize.width);
});

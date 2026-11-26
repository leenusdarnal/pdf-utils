import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

async function makePdfFixture(pageCount: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage(index % 2 === 0 ? [595.28, 841.89] : [841.89, 595.28]);
    page.drawText('PDF Utils N-up fixture page ' + (index + 1), {
      x: 36,
      y: 36,
      size: 14
    });
  }
  return Buffer.from(await pdf.save());
}

test('exports five source pages as three landscape two-up print sheets', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open N-up PDF layout tool' }).click();

  await page.locator('#n-up-pdf-file-input').setInputFiles({
    name: 'five-pages.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdfFixture(5)
  });

  await expect(page.getByRole('status')).toContainText('five-pages.pdf is ready.');
  await expect(page.getByText('5 output sheets')).toHaveCount(0);
  await expect(page.getByText('3 output sheets')).toBeVisible();

  await page.getByLabel('Pages per sheet').selectOption('2');
  await page.getByLabel('Paper size').selectOption('a4');
  await page.getByLabel('Sheet orientation').selectOption('auto');
  await page.getByLabel('Pages to include').fill('1-5');
  await page.getByLabel('Outer margins (mm)').fill('10');
  await page.getByLabel('Page spacing (mm)').fill('5');
  await page.getByLabel('Reading order').selectOption('row-major');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Create N-up PDF' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('n-up-layout.pdf');
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('The browser did not provide a downloaded PDF path.');

  const output = await PDFDocument.load(await readFile(downloadPath));
  expect(output.getPageCount()).toBe(3);
  for (const outputPage of output.getPages()) {
    const size = outputPage.getSize();
    expect(size.width).toBeGreaterThan(size.height);
  }
  expect((await readFile(downloadPath)).byteLength).toBeGreaterThan(2_000);
});

test('blocks duplicate page selections and updates the sheet count', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open N-up PDF layout tool' }).click();

  await page.locator('#n-up-pdf-file-input').setInputFiles({
    name: 'three-pages.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdfFixture(3)
  });

  await expect(page.getByRole('status')).toContainText('three-pages.pdf is ready.');
  await page.getByLabel('Pages per sheet').selectOption('4');
  await page.getByLabel('Pages to include').fill('3, 1');
  await expect(page.getByText('1 output sheet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create N-up PDF' })).toBeEnabled();

  await page.getByLabel('Pages to include').fill('1, 1');
  await expect(page.getByRole('alert')).toContainText('Page 1 appears more than once');
  await expect(page.getByRole('button', { name: 'Create N-up PDF' })).toBeDisabled();
});

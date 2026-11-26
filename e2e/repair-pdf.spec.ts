import { expect, test } from '@playwright/test';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';

async function createRepairFixture(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const firstPage = document.addPage([612, 792]);
  firstPage.drawText('ORIGINAL PDF PAGE ONE', { x: 48, y: 720, size: 18, font });

  const secondPage = document.addPage([420, 300]);
  secondPage.setRotation(degrees(90));
  secondPage.drawText('ORIGINAL PDF PAGE TWO', { x: 40, y: 250, size: 16, font });

  return Buffer.from(await document.save());
}

test('rebuilds and verifies a PDF without changing page content', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open PDF repair tool' }).click();

  await expect(page.getByRole('heading', { name: 'Repair PDF' })).toBeVisible();
  const source = await createRepairFixture();
  await page.locator('#repair-pdf-input').setInputFiles({
    name: 'repair-regression.pdf',
    mimeType: 'application/pdf',
    buffer: source
  });
  await expect(page.getByRole('button', { name: 'Repair & verify' })).toBeEnabled();
  await page.getByRole('button', { name: 'Repair & verify' }).click();

  await expect(page.getByRole('heading', { name: 'Rebuilt copy verified' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('2', { exact: true })).toBeVisible();
  await expect(page.getByText('0.000%')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download repaired PDF' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('repair-regression-repaired.pdf');
  const path = await download.path();
  expect(path).toBeTruthy();
  const output = await PDFDocument.load(await (await import('node:fs/promises')).readFile(path!));
  expect(output.getPageCount()).toBe(2);
  expect(output.getPage(0).getWidth()).toBe(612);
  expect(output.getPage(1).getRotation().angle).toBe(90);
});

test('refuses to rewrite a digitally signed PDF', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open PDF repair tool' }).click();

  const unsigned = await createRepairFixture();
  const signedMarker = Buffer.from('\n% /ByteRange [0 120 500 80]\n', 'ascii');
  const signed = Buffer.concat([unsigned, signedMarker]);
  await page.locator('#repair-pdf-input').setInputFiles({
    name: 'signed-document.pdf',
    mimeType: 'application/pdf',
    buffer: signed
  });
  await page.getByRole('button', { name: 'Repair & verify' }).click();

  await expect(page.getByRole('alert')).toContainText('Digitally signed PDFs are not rebuilt');
  await expect(page.getByText('No repaired file was created. Your original PDF remains unchanged.')).toBeVisible();
});

import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function createFivePagePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
    const page = document.addPage([612, 792]);
    page.drawText('Source page ' + pageNumber, { x: 48, y: 720, size: 18, font });
  }
  return Buffer.from(await document.save());
}

test('creates a vector N-up PDF with a final partially filled sheet', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open N-up layout tool' }).click();

  await page.locator('#nup-file-input').setInputFiles({
    name: 'nup-regression.pdf',
    mimeType: 'application/pdf',
    buffer: await createFivePagePdf()
  });
  await expect(page.getByLabel('Pages to arrange')).toHaveValue('1-5');
  await page.getByLabel('Pages per sheet').selectOption('2-up');
  await page.getByLabel('Sheet orientation').selectOption('landscape');
  await page.getByLabel('Pages to arrange').fill('1-5');
  await expect(page.getByText('2 columns × 1 rows · landscape')).toBeVisible();

  const workspace = page.locator('section[aria-label="N-up PDF layout workspace"]');
  await expect(workspace).toBeVisible();
  const exportButton = workspace.getByRole('button', { name: 'Create N-up PDF' });
  const status = workspace.getByRole('status');
  await exportButton.click();
  await expect(status).toHaveText('5 source pages arranged across 3 sheets.', { timeout: 15000 });
  expect(await workspace.count(), 'N-up workspace should remain mounted after export').toBe(1);
  expect(pageErrors, 'No browser runtime errors should occur').toEqual([]);
  await expect(page.getByRole('heading', { name: 'Your N-up PDF is ready' })).toBeVisible();
  await expect(workspace.getByText(/^3 sheets ·/)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('nup-regression-n-up.pdf');
  const path = await download.path();
  expect(path).toBeTruthy();
  const output = await PDFDocument.load(await readFile(path!));
  expect(output.getPageCount()).toBe(3);
  expect(output.getPage(0).getWidth()).toBeGreaterThan(output.getPage(0).getHeight());
});

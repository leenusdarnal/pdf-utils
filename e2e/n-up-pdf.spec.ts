import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function createFivePagePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
    document.addPage([612, 792]);
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
  await expect(status).toContainText(/arranged across 3 sheets|N-up export failed/, { timeout: 15000 });
  expect(await workspace.count(), 'N-up workspace should remain mounted after export').toBe(1);
  expect(pageErrors, 'No browser runtime errors should occur').toEqual([]);
  const statusText = await status.textContent();
  const exportError = await page.getByRole('alert').textContent().catch(() => null);
  expect(statusText, 'N-up export should finish' + (statusText ? ': ' + statusText : '')).toMatch(/arranged across 3 sheets/);
  expect(exportError, 'N-up export should succeed' + (exportError ? ': ' + exportError : '')).toBeNull();
  const workspaceText = await workspace.innerText();
  if (!workspaceText.includes('Your N-up PDF is ready')) {
    throw new Error('N-up success panel missing after successful status. Workspace text: ' + workspaceText.slice(-2500));
  }
  await expect(workspace.getByText('Your N-up PDF is ready')).toBeVisible();
  await expect(workspace.getByText(/3 sheets/)).toBeVisible();

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

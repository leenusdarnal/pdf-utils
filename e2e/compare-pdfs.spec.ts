import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function createComparisonPdfs(): Promise<{ baseline: Buffer; updated: Buffer }> {
  const createDocument = async (version: 'baseline' | 'updated') => {
    const document = await PDFDocument.create();
    const embeddedFont = await document.embedFont(StandardFonts.Helvetica);
    const sharedPage = document.addPage([612, 792]);
    sharedPage.drawText('SHARED CONTENT', { x: 54, y: 720, size: 18, font: embeddedFont });

    const changedPage = document.addPage([612, 792]);
    changedPage.drawText(version === 'baseline' ? 'OLD CONTRACT TEXT' : 'UPDATED CONTRACT TEXT', {
      x: 54,
      y: 720,
      size: 18,
      font: embeddedFont
    });

    if (version === 'updated') {
      const addedPage = document.addPage([612, 792]);
      addedPage.drawText('NEW APPENDIX PAGE', { x: 54, y: 720, size: 18, font: embeddedFont });
    }
    return Buffer.from(await document.save());
  };

  const [baseline, updated] = await Promise.all([
    createDocument('baseline'),
    createDocument('updated')
  ]);
  return { baseline, updated };
}

test('compares local PDF text, rendered appearance, and added pages', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toHaveAttribute('data-app-ready', 'true');
  await page.getByRole('button', { name: 'Open PDF comparison tool' }).click();

  await expect(page.getByRole('heading', { name: 'Compare PDFs' })).toBeVisible();
  const compareButton = page.getByRole('button', { name: 'Compare PDFs' });
  await expect(compareButton).toBeDisabled();

  const documents = await createComparisonPdfs();
  await page.locator('#compare-baseline-input').setInputFiles({
    name: 'baseline.pdf',
    mimeType: 'application/pdf',
    buffer: documents.baseline
  });
  await page.locator('#compare-updated-input').setInputFiles({
    name: 'updated.pdf',
    mimeType: 'application/pdf',
    buffer: documents.updated
  });
  await expect(compareButton).toBeEnabled();
  await compareButton.click();

  await expect(page.getByRole('status')).toContainText('Comparison complete.', { timeout: 20000 });
  const results = page.locator('[aria-label="PDF comparison results"]');
  await expect(results.getByRole('heading', { name: 'Page-by-page results' })).toBeVisible();
  await expect(results.getByText('Changed pages', { exact: true })).toBeVisible();
  await expect(results.getByText('No detected change')).toBeVisible();
  await expect(results.getByText('Changed', { exact: true })).toBeVisible();
  await expect(results.getByText('Added in updated PDF')).toBeVisible();
  await results.getByText('Show text excerpts').click();
  await expect(results.getByText('OLD CONTRACT TEXT')).toBeVisible();
  await expect(results.getByText('UPDATED CONTRACT TEXT')).toBeVisible();
  await expect(results.getByText('2 baseline pages · 3 updated pages')).toBeVisible();
});

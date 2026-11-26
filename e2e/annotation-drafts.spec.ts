import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const FIXED_LAST_MODIFIED = 1_700_000_000_000;
const FILE_NAME = 'annotation-draft-regression.pdf';

async function createPdfFixture(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Annotation draft recovery fixture', { x: 48, y: 720, size: 18, font });
  return Buffer.from(await document.save());
}

async function openFixture(page: import('@playwright/test').Page, bytes: Buffer) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('#file-input').setInputFiles({
    name: FILE_NAME,
    mimeType: 'application/pdf',
    buffer: bytes,
    lastModified: FIXED_LAST_MODIFIED
  });
  await expect(page.locator('[aria-label="PDF viewer"]')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Switch to page tools' }).click();
  await expect(page.locator('[data-page-surface]')).toBeVisible();
  await expect(page.locator('#pdf-annotation-draft-toggle')).toBeEnabled({ timeout: 15_000 });
}

async function createSavedNote(page: import('@playwright/test').Page) {
  await page.getByRole('checkbox', { name: 'Save annotation drafts on this device' }).check();
  await page.getByRole('button', { name: 'Place note' }).click();
  await page.locator('[data-page-surface]').click({ position: { x: 180, y: 210 } });
  await page.getByRole('textbox', { name: 'Note text' }).fill('Keep this annotation after reopening');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('button', { name: 'Note: Keep this annotation after reopening' })).toBeVisible();
  await expect(page.getByText('Saved on this device. The PDF itself is not stored.')).toBeVisible({
    timeout: 10_000
  });
}

test('restores an opted-in annotation draft after a page reload', async ({ page }) => {
  const bytes = await createPdfFixture();
  await openFixture(page, bytes);
  await createSavedNote(page);

  // A reload clears the in-memory viewer state but keeps the browser-local IndexedDB draft.
  await openFixture(page, bytes);
  const restore = page.getByRole('button', { name: 'Restore saved draft' });
  await expect(restore).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('A saved draft has 1 annotation(s).')).toBeVisible();
  await restore.click();

  await expect(page.getByRole('button', { name: 'Note: Keep this annotation after reopening' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Save annotation drafts on this device' })).toBeChecked();
  await expect(page.getByText('Saved on this device. The PDF itself is not stored.')).toBeVisible({
    timeout: 10_000
  });
});

test('allows a user to discard a saved annotation draft', async ({ page }) => {
  const bytes = await createPdfFixture();
  await openFixture(page, bytes);
  await createSavedNote(page);

  await openFixture(page, bytes);
  await expect(page.getByRole('button', { name: 'Discard saved draft' })).toBeVisible({
    timeout: 10_000
  });
  await page.getByRole('button', { name: 'Discard saved draft' }).click();

  await expect(page.getByRole('button', { name: 'Restore saved draft' })).toHaveCount(0);
  await expect(page.getByText('Saved annotation draft discarded from this device.')).toBeVisible();
});

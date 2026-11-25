import { expect, test, type Page } from '@playwright/test';

function createTwoPagePdf(): Buffer {
  const pageTexts = [
    'PDF Utils browser test first page',
    'PDF Utils searchable needle on the second page'
  ];
  const pageCount = pageTexts.length;
  const fontObjectNumber = pageCount + 3;
  const firstContentObjectNumber = pageCount + 4;
  const pageObjects = pageTexts.map((_, index) => {
    const pageObjectNumber = index + 3;
    const contentObjectNumber = firstContentObjectNumber + index;
    return (
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> ` +
      `/Contents ${contentObjectNumber} 0 R >>`
    );
  });
  const contentObjects = pageTexts.map((text) => {
    const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    return `<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`;
  });
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageTexts.map((_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...pageObjects,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...contentObjects
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const crossReferenceOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${crossReferenceOffset}\n%%EOF`;

  return Buffer.from(pdf, 'binary');
}

async function visitHome(page: Page) {
  page.on('pageerror', (error) => console.error('[browser pageerror]', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('[browser console error]', message.text());
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('#file-input')).toHaveCount(1);
}

async function openTestPdf(page: Page) {
  await page.locator('#file-input').setInputFiles({
    name: 'pdf-utils-browser-test.pdf',
    mimeType: 'application/pdf',
    buffer: createTwoPagePdf()
  });
  await expect(page.locator('[aria-label="PDF viewer"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="status"]').last()).toContainText('Page 1 of 2');
  await expect(page.locator('canvas[aria-label^="Page "]')).toBeVisible();
}

test('opens a PDF and supports page navigation, local search, and zoom', async ({ page }) => {
  await visitHome(page);
  await openTestPdf(page);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('[role="status"]').last()).toContainText('Page 2 of 2');

  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.locator('[role="status"]').last()).toContainText('Page 1 of 2');

  await page.getByLabel('Find in document').fill('needle');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page.locator('[aria-label="Search results"]')).toContainText('1 match found');
  await expect(page.locator('[aria-label="Search results"]')).toContainText('Page 2');

  await page.locator('[aria-label="Search results"] button').click();
  await expect(page.locator('[role="status"]').last()).toContainText('Page 2 of 2');

  const widthBeforeZoom = await page.locator('canvas[aria-label^="Page "]').evaluate(
    (canvas) => (canvas as HTMLCanvasElement).style.width
  );
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () =>
    page.locator('canvas[aria-label^="Page "]').evaluate((canvas) => (canvas as HTMLCanvasElement).style.width)
  ).not.toBe(widthBeforeZoom);

  await page.getByRole('button', { name: 'Fit width' }).click();
  await expect(page.getByRole('button', { name: 'Fit width' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Close document' }).click();
  await expect(page.locator('[aria-label="PDF viewer"]')).toBeHidden();
  await expect(page.getByRole('heading', { name: /Your documents/ })).toBeVisible();
});

test('rejects a file that does not contain a PDF signature', async ({ page }) => {
  await visitHome(page);
  await page.locator('#file-input').setInputFiles({
    name: 'not-a-pdf.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('This file is not a PDF.')
  });

  await expect(page.getByText(/does not look like a valid PDF/)).toBeVisible();
  await expect(page.locator('[aria-label="PDF viewer"]')).toHaveCount(0);
});

test('keeps the viewer usable without horizontal page overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visitHome(page);
  await expect(page.getByRole('heading', { name: /Your documents/ })).toHaveCSS('font-size', '43px');

  await openTestPdf(page);

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    sidebarWidth: document.querySelector('aside[aria-label="Page navigation"]')?.getBoundingClientRect().width ?? 0
  }));

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.sidebarWidth).toBeLessThanOrEqual(90);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('[role="status"]')).toContainText('Page 2 of 2');
});

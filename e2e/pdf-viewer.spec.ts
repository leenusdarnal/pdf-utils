import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

function createTwoPagePdf(rotation = 0): Buffer {
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
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${rotation} ` +
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
    ...contentObjects,
    '<< /Title (PDF Utils Test Document) /Author (Browser Test Author) /Subject (Metadata panel test) /Creator (PDF Utils Test Suite) /Producer (PDF Utils Browser Fixture) >>'
  ];
  const infoObjectNumber = objects.length;

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
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObjectNumber} 0 R >>\n` +
    `startxref\n${crossReferenceOffset}\n%%EOF`;

  return Buffer.from(pdf, 'binary');
}


async function createPdfWithPageSizes(pageSizes: Array<[number, number]>): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (const [width, height] of pageSizes) document.addPage([width, height]);
  return Buffer.from(await document.save());
}

async function visitHome(page: Page) {
  page.on('pageerror', (error) => console.error('[browser pageerror]', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('[browser console error]', message.text());
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('#file-input')).toHaveCount(1);
}

async function openTestPdf(page: Page, rotation = 0, mode: 'page' | 'scroll' = 'page') {
  await page.locator('#file-input').setInputFiles({
    name: 'pdf-utils-browser-test.pdf',
    mimeType: 'application/pdf',
    buffer: createTwoPagePdf(rotation)
  });
  await expect(page.locator('[aria-label="PDF viewer"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="status"]').last()).toContainText('Page 1 of 2');

  if (mode === 'scroll') {
    const firstPage = page.locator('[data-pdf-continuous-page="1"]');
    await expect(firstPage).toBeVisible();
    await expect(firstPage.locator('canvas[aria-label^="Page "]')).toBeVisible();
    await expect(firstPage.locator('.textLayer')).toContainText('PDF Utils browser test first page');
    return;
  }

  await page.getByRole('button', { name: 'Switch to page tools' }).click();
  await expect(page.locator('[data-page-surface]')).toBeVisible();
  await expect(page.locator('canvas[aria-label^="Page "]')).toBeVisible();
  const selectableText = page.locator('.textLayer');
  await expect(selectableText).toContainText('PDF Utils browser test first page');

  const selectedText = await selectableText.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? '';
  });
  expect(selectedText).toContain('PDF Utils browser test first page');
}

test('opens a PDF and supports page navigation, local search, and zoom', async ({ page }) => {
  await visitHome(page);
  await openTestPdf(page);

  const infoButton = page.getByRole('button', { name: 'Document info' });
  await expect(infoButton).toHaveAttribute('aria-expanded', 'false');
  await infoButton.click();
  const infoPanel = page.getByRole('region', { name: 'Document information' });
  await expect(infoPanel).toBeVisible();
  await expect(infoPanel).toContainText('PDF Utils Test Document');
  await expect(infoPanel).toContainText('Browser Test Author');
  await expect(infoPanel).toContainText('Metadata panel test');
  await infoButton.click();
  await expect(infoPanel).toBeHidden();

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

test('keeps rotated-page highlights within the page and stable after zooming', async ({ page }) => {
  await visitHome(page);
  await openTestPdf(page, 90);

  const textLayer = page.locator('.textLayer');
  const selectionRect = await textLayer.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const rect = range.getClientRects()[0];
    if (!rect) throw new Error('The selected PDF text has no client rectangle');
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  expect(selectionRect.width).toBeGreaterThan(0);
  expect(selectionRect.height).toBeGreaterThan(0);
  await textLayer.dispatchEvent('mouseup');
  await page.getByRole('button', { name: 'Highlight selection' }).click();

  const highlight = page.locator('[data-annotation-type="highlight"]').first();
  await expect(highlight).toBeVisible();
  const highlightBefore = await highlight.boundingBox();
  const pageBefore = await page.locator('canvas[aria-label^="Page "]').boundingBox();
  expect(highlightBefore).not.toBeNull();
  expect(pageBefore).not.toBeNull();
  // DOM text-selection rectangles are glyph metrics, while the saved overlay
  // uses page coordinates. Verify it stays on the rotated page and then compare
  // the exact same overlay before and after zooming.
  expect(highlightBefore!.x).toBeGreaterThanOrEqual(pageBefore!.x - 1);
  expect(highlightBefore!.y).toBeGreaterThanOrEqual(pageBefore!.y - 1);
  expect(highlightBefore!.x + highlightBefore!.width).toBeLessThanOrEqual(
    pageBefore!.x + pageBefore!.width + 1
  );
  expect(highlightBefore!.y + highlightBefore!.height).toBeLessThanOrEqual(
    pageBefore!.y + pageBefore!.height + 1
  );

  const before = {
    x: (highlightBefore!.x - pageBefore!.x) / pageBefore!.width,
    y: (highlightBefore!.y - pageBefore!.y) / pageBefore!.height,
    width: highlightBefore!.width / pageBefore!.width,
    height: highlightBefore!.height / pageBefore!.height
  };

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('[role="status"]').last()).toContainText('Page 1 of 2');
  const highlightAfter = await highlight.boundingBox();
  const pageAfter = await page.locator('canvas[aria-label^="Page "]').boundingBox();
  expect(highlightAfter).not.toBeNull();
  expect(pageAfter).not.toBeNull();
  expect(Math.abs((highlightAfter!.x - pageAfter!.x) / pageAfter!.width - before.x)).toBeLessThan(0.02);
  expect(Math.abs((highlightAfter!.y - pageAfter!.y) / pageAfter!.height - before.y)).toBeLessThan(0.02);
  expect(Math.abs(highlightAfter!.width / pageAfter!.width - before.width)).toBeLessThan(0.02);
  expect(Math.abs(highlightAfter!.height / pageAfter!.height - before.height)).toBeLessThan(0.02);
});

test('opens the original local PDF in a new tab for native printing', async ({ page }) => {
  await visitHome(page);
  await openTestPdf(page);

  await page.evaluate(() => {
    (window as any).__printOpenCalls = [];
    window.open = ((url: string | URL, target?: string) => {
      (window as any).__printOpenCalls.push({ url: String(url), target: target ?? '' });
      return { opener: null } as unknown as Window;
    }) as typeof window.open;
  });

  await page.getByRole('button', { name: 'Open PDF for printing' }).click();
  const calls = await page.evaluate(() => (window as any).__printOpenCalls as Array<{url: string; target: string}>);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toMatch(/^blob:/);
  expect(calls[0].target).toBe('_blank');
  await expect(page.locator('[role="status"]').last()).toContainText(
    'Opened the original PDF in a new tab'
  );

  await page.evaluate(() => {
    window.open = (() => null) as typeof window.open;
  });
  await page.getByRole('button', { name: 'Open PDF for printing' }).click();
  await expect(page.locator('[role="status"]').last()).toContainText(
    'The browser blocked the print tab'
  );
});

test('creates, moves, and undoes selectable text highlights', async ({ page }) => {
  await visitHome(page);
  await openTestPdf(page);

  await page.locator('.textLayer').dispatchEvent('mouseup');
  const addHighlight = page.getByRole('button', { name: 'Highlight selection' });
  await expect(addHighlight).toBeEnabled();
  await addHighlight.click();

  const highlights = page.locator('[data-annotation-type="highlight"]');
  await expect(highlights.first()).toBeVisible();
  const beforeDrag = await highlights.first().boundingBox();
  expect(beforeDrag).not.toBeNull();

  const startX = beforeDrag!.x + beforeDrag!.width / 2;
  const startY = beforeDrag!.y + beforeDrag!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 18, startY + 14, { steps: 5 });
  await page.mouse.up();

  const afterDrag = await highlights.first().boundingBox();
  expect(afterDrag).not.toBeNull();
  expect(afterDrag!.y - beforeDrag!.y).toBeGreaterThan(5);

  await page.getByRole('button', { name: 'Undo annotation' }).click();
  const afterUndo = await highlights.first().boundingBox();
  expect(afterUndo).not.toBeNull();
  expect(Math.abs(afterUndo!.y - beforeDrag!.y)).toBeLessThan(2);

  await page.getByRole('button', { name: 'Undo annotation' }).click();
  await expect(highlights).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo annotation' }).click();
  await expect(highlights.first()).toBeVisible();
});

test('scrolls through PDF pages and keeps quick navigation in sync', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visitHome(page);
  await openTestPdf(page, 0, 'scroll');

  const viewport = page.getByRole('region', { name: 'Document page area' });
  const firstPage = page.locator('[data-pdf-continuous-page="1"]');
  const secondPage = page.locator('[data-pdf-continuous-page="2"]');
  await expect(firstPage.locator('canvas[aria-label^="Page "]')).toBeVisible();

  // Scroll the document itself; no Next button interaction is required.
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect(secondPage).toBeInViewport();
  await expect(secondPage.locator('canvas[aria-label^="Page "]')).toBeVisible();
  await expect(page.locator('[role="status"]').last()).toContainText('Page 2 of 2');

  // The existing page controls remain useful as quick jumps in scroll mode.
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(firstPage).toBeInViewport();
  await expect(page.locator('[role="status"]').last()).toContainText('Page 1 of 2');

  // Page tools switches back to the annotation-enabled single-page workspace.
  await page.getByRole('button', { name: 'Switch to page tools' }).click();
  await expect(page.locator('[data-page-surface]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place note' })).toBeVisible();
});

test('splits a PDF into separate page-range downloads', async ({ page }) => {
  await visitHome(page);
  await page.getByRole('button', { name: 'Open split tool' }).click();
  await expect(page.getByRole('heading', { name: 'Split PDF' })).toBeVisible();

  const sourcePdf = await createPdfWithPageSizes([
    [100, 200],
    [110, 210],
    [300, 400],
    [310, 410]
  ]);
  await page.locator('#split-file-input').setInputFiles({
    name: 'source.pdf',
    mimeType: 'application/pdf',
    buffer: sourcePdf
  });

  await expect(page.getByText('4 pages loaded')).toBeVisible();
  await page.getByRole('textbox', { name: 'Page range for output 1' }).fill('1-2');
  await page.getByRole('button', { name: '+ Add output' }).click();
  await page.getByRole('textbox', { name: 'Page range for output 2' }).fill('4, 3');

  await page.getByRole('button', { name: 'Create output PDFs' }).click();
  const outputs = page.locator('[data-split-output]');
  await expect(outputs).toHaveCount(2);
  await expect(outputs.nth(0)).toContainText('Pages 1-2');
  await expect(outputs.nth(1)).toContainText('Pages 4, 3');

  const firstDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download part 1' }).click();
  const firstDownload = await firstDownloadPromise;
  expect(firstDownload.suggestedFilename()).toBe('source-part-1.pdf');
  const firstPath = await firstDownload.path();
  expect(firstPath).not.toBeNull();
  const firstOutput = await PDFDocument.load(await readFile(firstPath!));
  expect(firstOutput.getPages().map((pdfPage) => [pdfPage.getWidth(), pdfPage.getHeight()])).toEqual([
    [100, 200],
    [110, 210]
  ]);

  const secondDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download part 2' }).click();
  const secondDownload = await secondDownloadPromise;
  expect(secondDownload.suggestedFilename()).toBe('source-part-2.pdf');
  const secondPath = await secondDownload.path();
  expect(secondPath).not.toBeNull();
  const secondOutput = await PDFDocument.load(await readFile(secondPath!));
  expect(secondOutput.getPages().map((pdfPage) => [pdfPage.getWidth(), pdfPage.getHeight()])).toEqual([
    [310, 410],
    [300, 400]
  ]);
});

test('rejects invalid split page ranges before producing output files', async ({ page }) => {
  await visitHome(page);
  await page.getByRole('button', { name: 'Open split tool' }).click();

  const sourcePdf = await createPdfWithPageSizes([[100, 200], [110, 210], [300, 400], [310, 410]]);
  await page.locator('#split-file-input').setInputFiles({
    name: 'invalid-range-source.pdf',
    mimeType: 'application/pdf',
    buffer: sourcePdf
  });
  await expect(page.getByText('4 pages loaded')).toBeVisible();

  const range = page.getByRole('textbox', { name: 'Page range for output 1' });
  await range.fill('2-5');
  await page.getByRole('button', { name: 'Create output PDFs' }).click();
  await expect(page.getByRole('alert')).toContainText('between 1 and 4');
  await expect(page.locator('[data-split-output]')).toHaveCount(0);

  await range.fill('3-2');
  await page.getByRole('button', { name: 'Create output PDFs' }).click();
  await expect(page.getByRole('alert')).toContainText('ascending');
  await expect(page.locator('[data-split-output]')).toHaveCount(0);
});

test('merges multiple PDFs in the selected order and downloads the combined document', async ({ page }) => {
  await visitHome(page);
  await page.getByRole('button', { name: 'Open merge tool' }).click();
  await expect(page.getByRole('heading', { name: 'Merge PDFs' })).toBeVisible();

  const firstPdf = await createPdfWithPageSizes([
    [100, 200],
    [110, 210]
  ]);
  const secondPdf = await createPdfWithPageSizes([[300, 400]]);

  await page.locator('#merge-file-input').setInputFiles([
    {
      name: 'first.pdf',
      mimeType: 'application/pdf',
      buffer: firstPdf
    },
    {
      name: 'second.pdf',
      mimeType: 'application/pdf',
      buffer: secondPdf
    }
  ]);

  const mergeRows = page.locator('[data-merge-source]');
  await expect(mergeRows).toHaveCount(2);
  await page.getByRole('button', { name: 'Move second.pdf up' }).click();
  await expect(mergeRows.nth(0)).toHaveAttribute('data-merge-source', 'second.pdf');
  await expect(mergeRows.nth(1)).toHaveAttribute('data-merge-source', 'first.pdf');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Merge PDFs', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('merged-document.pdf');

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const merged = await PDFDocument.load(await readFile(downloadPath!));
  const mergedPages = merged.getPages();

  expect(mergedPages).toHaveLength(3);
  expect(mergedPages.map((pdfPage) => [pdfPage.getWidth(), pdfPage.getHeight()])).toEqual([
    [300, 400],
    [100, 200],
    [110, 210]
  ]);
  await expect(page.locator('[role="status"]').last()).toContainText('started the download');
});

test('does not allow merging fewer than two PDFs and rejects invalid files', async ({ page }) => {
  await visitHome(page);
  await page.getByRole('button', { name: 'Open merge tool' }).click();

  const mergeButton = page.getByRole('button', { name: 'Merge PDFs', exact: true });
  await expect(mergeButton).toBeDisabled();

  await page.locator('#merge-file-input').setInputFiles({
    name: 'not-a-pdf.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('This is not a PDF document.')
  });
  await expect(page.getByRole('alert')).toContainText('not a valid PDF');
  await expect(page.locator('[data-merge-source]')).toHaveCount(0);
  await expect(mergeButton).toBeDisabled();
});

test('creates, moves, edits, and deletes page-relative text notes', async ({ page }) => {
  await visitHome(page);
  await openTestPdf(page);

  const pageSurface = page.locator('[data-page-surface]');
  // Switching from an active shape tool to notes must clear the old drawing mode.
  await page.getByRole('button', { name: 'Draw arrow' }).click();
  await page.getByRole('button', { name: 'Place note' }).click();
  await expect(page.getByText('Select a point on the page to place a note.')).toBeVisible();
  await pageSurface.click({ position: { x: 220, y: 230 } });

  const noteEditor = page.getByRole('form', { name: 'Text note editor' });
  await expect(noteEditor).toBeVisible();
  await page.getByRole('textbox', { name: 'Note text' }).fill('Review this section');
  await page.getByRole('button', { name: 'Save note' }).click();

  const note = page.getByRole('button', { name: 'Note: Review this section' });
  await expect(note).toBeVisible();
  const noteBeforeZoom = await note.boundingBox();
  const pageBeforeZoom = await page.locator('canvas[aria-label^="Page "]').boundingBox();
  expect(noteBeforeZoom).not.toBeNull();
  expect(pageBeforeZoom).not.toBeNull();
  const relativeX = (noteBeforeZoom!.x + noteBeforeZoom!.width / 2 - pageBeforeZoom!.x) / pageBeforeZoom!.width;
  const relativeY = (noteBeforeZoom!.y + noteBeforeZoom!.height / 2 - pageBeforeZoom!.y) / pageBeforeZoom!.height;

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('[role="status"]').last()).toContainText('Page 1 of 2');
  const noteAfterZoom = await note.boundingBox();
  const pageAfterZoom = await page.locator('canvas[aria-label^="Page "]').boundingBox();
  expect(noteAfterZoom).not.toBeNull();
  expect(pageAfterZoom).not.toBeNull();
  const zoomedRelativeX = (noteAfterZoom!.x + noteAfterZoom!.width / 2 - pageAfterZoom!.x) / pageAfterZoom!.width;
  const zoomedRelativeY = (noteAfterZoom!.y + noteAfterZoom!.height / 2 - pageAfterZoom!.y) / pageAfterZoom!.height;
  expect(Math.abs(zoomedRelativeX - relativeX)).toBeLessThan(0.02);
  expect(Math.abs(zoomedRelativeY - relativeY)).toBeLessThan(0.02);

  const dragStartX = noteAfterZoom!.x + noteAfterZoom!.width / 2;
  const dragStartY = noteAfterZoom!.y + noteAfterZoom!.height / 2;
  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  await page.mouse.move(dragStartX + 24, dragStartY + 16, { steps: 4 });
  await page.mouse.up();
  const noteAfterDrag = await note.boundingBox();
  expect(noteAfterDrag).not.toBeNull();
  expect(noteAfterDrag!.x - noteAfterZoom!.x).toBeGreaterThan(10);

  await note.click();
  const noteInput = page.getByRole('textbox', { name: 'Note text' });
  await expect(noteInput).toHaveValue('Review this section');
  await noteInput.fill('Updated review note');
  await page.getByRole('button', { name: 'Save note' }).click();
  const updatedNote = page.getByRole('button', { name: 'Note: Updated review note' });
  await expect(updatedNote).toBeVisible();

  await updatedNote.click();
  await page.getByRole('button', { name: 'Delete note' }).click();
  await expect(page.locator('[data-annotation-type="text-note"]')).toHaveCount(0);
});

test('autosaves annotation drafts locally and restores them for the same PDF', async ({ page }) => {
  await visitHome(page);
  const sourcePdf = createTwoPagePdf();

  await page.locator('#file-input').setInputFiles({
    name: 'pdf-utils-draft-recovery.pdf',
    mimeType: 'application/pdf',
    buffer: sourcePdf
  });
  await expect(page.locator('[aria-label="PDF viewer"]')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Switch to page tools' }).click();
  await expect(page.getByRole('button', { name: 'Place note' })).toBeEnabled();

  await page.getByRole('button', { name: 'Place note' }).click();
  await page.locator('[data-page-surface]').click({ position: { x: 210, y: 220 } });
  await page.getByRole('textbox', { name: 'Note text' }).fill('Keep this note after reopening');
  await page.getByRole('button', { name: 'Save note' }).click();

  await expect(page.getByRole('button', { name: 'Note: Keep this note after reopening' })).toBeVisible();
  await expect(page.getByText('Saved locally on this device.')).toBeVisible({ timeout: 10_000 });

  // A full reload discards the viewer component while keeping this origin's IndexedDB.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#file-input')).toHaveCount(1);

  // Re-select the same file bytes as a fresh File object after the reload.
  await page.locator('#file-input').setInputFiles({
    name: 'pdf-utils-draft-recovery.pdf',
    mimeType: 'application/pdf',
    buffer: sourcePdf
  });
  await expect(page.locator('[aria-label="PDF viewer"]')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Switch to page tools' }).click();
  await expect(page.getByText('Restored 1 annotation(s) from this device.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Note: Keep this note after reopening' })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear saved annotation draft' }).click();
  await expect(page.getByText('Local annotation draft cleared.')).toBeVisible();
  await expect(page.locator('[data-annotation-type="text-note"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear saved annotation draft' })).toHaveCount(0);
});

test('draws rectangle and arrow annotations and supports undo/redo', async ({ page }) => {
  await visitHome(page);
  await openTestPdf(page);

  const pageSurface = page.locator('[data-page-surface]');
  const surfaceBounds = await pageSurface.boundingBox();
  expect(surfaceBounds).not.toBeNull();
  const draw = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(surfaceBounds!.x + x1, surfaceBounds!.y + y1);
    await page.mouse.down();
    await page.mouse.move(surfaceBounds!.x + x2, surfaceBounds!.y + y2, { steps: 5 });
    await page.mouse.up();
  };

  await page.getByRole('button', { name: 'Draw rectangle' }).click();
  await draw(120, 150, 220, 230);
  const rectangle = page.locator('[data-annotation-type="rectangle"]');
  await expect(rectangle).toBeVisible();

  const rectangleBeforeMove = await rectangle.boundingBox();
  expect(rectangleBeforeMove).not.toBeNull();
  await page.mouse.move(rectangleBeforeMove!.x + rectangleBeforeMove!.width / 2, rectangleBeforeMove!.y + rectangleBeforeMove!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rectangleBeforeMove!.x + rectangleBeforeMove!.width / 2 + 24, rectangleBeforeMove!.y + rectangleBeforeMove!.height / 2 + 18, { steps: 4 });
  await page.mouse.up();
  const rectangleAfterMove = await rectangle.boundingBox();
  expect(rectangleAfterMove).not.toBeNull();
  expect(rectangleAfterMove!.x - rectangleBeforeMove!.x).toBeGreaterThan(10);

  await rectangle.click({ position: { x: 10, y: 10 } });
  const deleteButton = page.getByRole('button', { name: 'Delete selected annotation' });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(rectangle).toHaveCount(0);

  await page.getByRole('button', { name: 'Draw arrow' }).click();
  await draw(260, 280, 360, 340);
  const arrow = page.locator('[data-annotation-type="arrow"]');
  await expect(arrow).toBeVisible();

  await page.getByRole('button', { name: 'Undo annotation' }).click();
  await expect(arrow).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo annotation' }).click();
  await expect(arrow).toBeVisible();

  // Click the transparent stroke target to select the arrow, then delete it.
  await arrow.locator('line[stroke="transparent"]').click();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(arrow).toHaveCount(0);
});


test('draws shapes using touch gestures on a mobile-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visitHome(page);
  await openTestPdf(page);

  const pageSurface = page.locator('[data-page-surface]');
  await page.getByRole('button', { name: 'Draw rectangle' }).click();
  await expect(pageSurface).toHaveClass(/touch-none/);
  const bounds = await pageSurface.boundingBox();
  expect(bounds).not.toBeNull();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const start = { x: bounds!.x + 70, y: bounds!.y + 120, id: 1, radiusX: 2, radiusY: 2, force: 1 };
  const end = { x: bounds!.x + 190, y: bounds!.y + 220, id: 1, radiusX: 2, radiusY: 2, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(page.locator('[data-annotation-type="rectangle"]')).toBeVisible();
  await cdp.detach();
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

test('keeps the viewer usable and lets mobile users collapse page thumbnails', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visitHome(page);
  await expect(page.getByRole('heading', { name: /Your documents/ })).toHaveCSS('font-size', '43px');

  await openTestPdf(page);

  const thumbnails = page.locator('aside[aria-label="Page navigation"]');
  const showPages = page.getByRole('button', { name: 'Show pages' });
  await expect(showPages).toBeVisible();
  await expect(showPages).toHaveAttribute('aria-expanded', 'false');
  await expect(thumbnails).toBeHidden();

  const collapsedLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    sidebarWidth: document.querySelector('aside[aria-label="Page navigation"]')?.getBoundingClientRect().width ?? 0
  }));
  expect(collapsedLayout.documentWidth).toBeLessThanOrEqual(collapsedLayout.viewportWidth);
  expect(collapsedLayout.sidebarWidth).toBe(0);

  await showPages.click();
  const hidePages = page.getByRole('button', { name: 'Hide pages' });
  await expect(hidePages).toHaveAttribute('aria-expanded', 'true');
  await expect(thumbnails).toBeVisible();

  const expandedSidebarWidth = await thumbnails.evaluate((element) => element.getBoundingClientRect().width);
  expect(expandedSidebarWidth).toBeLessThanOrEqual(90);
  expect(expandedSidebarWidth).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Go to page 2' }).click();
  await expect(page.locator('[role="status"]').last()).toContainText('Page 2 of 2');
  await expect(page.getByRole('button', { name: 'Show pages' })).toBeVisible();
  await expect(thumbnails).toBeHidden();

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('button', { name: 'Fit width' })).toBeVisible();

    const groups = await page.evaluate(() => {
      const utility = document.querySelector('[data-annotation-group="utility"]');
      const primary = document.querySelector('[data-annotation-group="primary"]');
      const pageStatus = document.querySelector('div[role="status"][aria-live="polite"][aria-atomic="true"]');
      if (!utility || !primary || !pageStatus) throw new Error('Annotation groups or page status are missing');

      const utilityBounds = utility.getBoundingClientRect();
      const primaryBounds = primary.getBoundingClientRect();
      const pageStatusBounds = pageStatus.getBoundingClientRect();
      return {
        utilityBottom: utilityBounds.bottom,
        primaryTop: primaryBounds.top,
        primaryBottom: primaryBounds.bottom,
        pageStatusTop: pageStatusBounds.top,
        utilityWidth: utility.clientWidth,
        utilityScrollWidth: utility.scrollWidth,
        primaryWidth: primary.clientWidth,
        primaryScrollWidth: primary.scrollWidth,
        utilityButtons: Array.from(utility.querySelectorAll('button')).map((button) => button.getAttribute('aria-label')),
        primaryButtons: Array.from(primary.querySelectorAll('button')).map((button) => button.getAttribute('aria-label')),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      };
    });

    expect(groups.utilityBottom).toBeLessThanOrEqual(groups.primaryTop + 1);
    expect(groups.primaryBottom).toBeLessThanOrEqual(groups.pageStatusTop + 1);
    expect(groups.utilityScrollWidth).toBeLessThanOrEqual(groups.utilityWidth + 1);
    expect(groups.primaryScrollWidth).toBeLessThanOrEqual(groups.primaryWidth + 1);
    expect(groups.documentWidth).toBeLessThanOrEqual(groups.viewportWidth);
    expect(groups.utilityButtons).toEqual([
      'Undo annotation',
      'Redo annotation',
      'Delete selected annotation'
    ]);
    expect(groups.primaryButtons).toEqual([
      'Place note',
      'Highlight selection',
      'Draw freehand',
      'Draw rectangle',
      'Draw arrow'
    ]);
  }
});

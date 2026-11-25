import { expect, test, type Page } from '@playwright/test';

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

async function visitHome(page: Page) {
  page.on('pageerror', (error) => console.error('[browser pageerror]', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('[browser console error]', message.text());
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('#file-input')).toHaveCount(1);
}

async function openTestPdf(page: Page, rotation = 0) {
  await page.locator('#file-input').setInputFiles({
    name: 'pdf-utils-browser-test.pdf',
    mimeType: 'application/pdf',
    buffer: createTwoPagePdf(rotation)
  });
  await expect(page.locator('[aria-label="PDF viewer"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="status"]').last()).toContainText('Page 1 of 2');
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

test('keeps text highlights aligned on rotated pages and after zooming', async ({ page }) => {
  await visitHome(page);
  await openTestPdf(page, 90);

  const textLayer = page.locator('.textLayer');
  const selectionRect = await textLayer.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const rect = range.getBoundingClientRect();
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
  expect(Math.abs(highlightBefore!.x - selectionRect.left)).toBeLessThan(3);
  expect(Math.abs(highlightBefore!.y - selectionRect.top)).toBeLessThan(3);
  expect(Math.abs(highlightBefore!.width - selectionRect.width)).toBeLessThan(3);
  expect(Math.abs(highlightBefore!.height - selectionRect.height)).toBeLessThan(3);

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

test('creates, moves, edits, and deletes page-relative text notes', async ({ page }) => {
  await visitHome(page);
  await openTestPdf(page);

  const pageSurface = page.locator('[data-page-surface]');
  await page.getByRole('button', { name: 'Place note' }).click();
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

  await page.getByRole('button', { name: 'Draw arrow' }).click();
  await draw(260, 280, 360, 340);
  await expect(page.locator('[data-annotation-type="arrow"]')).toBeVisible();

  await page.getByRole('button', { name: 'Undo annotation' }).click();
  await expect(page.locator('[data-annotation-type="arrow"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo annotation' }).click();
  await expect(page.locator('[data-annotation-type="arrow"]')).toBeVisible();
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
});

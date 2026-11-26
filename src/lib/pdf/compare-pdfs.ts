import { createPdfDocumentTask, type PdfPage } from './pdfjs-client';

export type PdfPageComparisonStatus = 'unchanged' | 'changed' | 'added' | 'removed';

export interface PdfPageComparison {
  pageNumber: number;
  status: PdfPageComparisonStatus;
  textChanged: boolean;
  pageSizeChanged: boolean;
  visualDifferencePercent: number | null;
  baselineTextPreview: string;
  updatedTextPreview: string;
}

export interface PdfComparisonProgress {
  completedPages: number;
  totalPages: number;
  currentPage: number;
}

export interface PdfComparisonResult {
  baselinePageCount: number;
  updatedPageCount: number;
  comparedPages: number;
  changedPages: number;
  unchangedPages: number;
  addedPages: number;
  removedPages: number;
  textChangedPages: number;
  visualChangedPages: number;
  pages: PdfPageComparison[];
}

const MAX_FILE_BYTES = 150 * 1024 * 1024;
const MAX_PAGES = 300;
const MAX_TEXT_CHARACTERS = 20_000_000;
const MAX_CANVAS_PIXELS = 1_500_000;
const MAX_RENDER_SIDE = 1_400;
const PIXEL_CHANNEL_THRESHOLD = 32;
const VISUAL_CHANGE_THRESHOLD_PERCENT = 0.1;

/** Normalize layout-only whitespace while preserving actual text and punctuation changes. */
export function normalizeComparisonText(text: string): string {
  return text.normalize('NFKC').replace(/[\t\r\n\u00a0 ]+/g, ' ').trim();
}

/** Compare RGBA image data and ignore small per-channel antialiasing differences. */
export function calculatePixelDifferencePercent(
  baseline: Uint8ClampedArray,
  updated: Uint8ClampedArray
): number {
  if (baseline.length !== updated.length || baseline.length % 4 !== 0) {
    throw new Error('The rendered pages have incompatible pixel buffers.');
  }
  if (baseline.length === 0) return 0;

  const pixelCount = baseline.length / 4;
  let changedPixels = 0;
  for (let index = 0; index < baseline.length; index += 4) {
    const different =
      Math.abs(baseline[index] - updated[index]) > PIXEL_CHANNEL_THRESHOLD ||
      Math.abs(baseline[index + 1] - updated[index + 1]) > PIXEL_CHANNEL_THRESHOLD ||
      Math.abs(baseline[index + 2] - updated[index + 2]) > PIXEL_CHANNEL_THRESHOLD ||
      Math.abs(baseline[index + 3] - updated[index + 3]) > PIXEL_CHANNEL_THRESHOLD;
    if (different) changedPixels += 1;
  }
  return Number(((changedPixels / pixelCount) * 100).toFixed(2));
}

function getTextPreview(text: string): string {
  return text.length > 220 ? text.slice(0, 217).trimEnd() + '…' : text;
}

async function extractPageText(page: PdfPage): Promise<string> {
  const content = await page.getTextContent();
  const parts: string[] = [];
  for (const item of content.items) {
    if ('str' in item && item.str) parts.push(item.str);
  }
  return normalizeComparisonText(parts.join(' '));
}

async function renderPagePixels(
  page: PdfPage,
  scale: number,
  canvasWidth: number,
  canvasHeight: number
): Promise<Uint8ClampedArray> {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('A browser canvas is unavailable for visual comparison.');

  try {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    const viewport = page.getViewport({ scale });
    await page.render({
      canvas,
      viewport,
      background: '#ffffff'
    }).promise;
    return new Uint8ClampedArray(context.getImageData(0, 0, canvasWidth, canvasHeight).data);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function comparePageVisuals(
  baselinePage: PdfPage,
  updatedPage: PdfPage
): Promise<{ differencePercent: number; pageSizeChanged: boolean }> {
  const baselineViewport = baselinePage.getViewport({ scale: 1 });
  const updatedViewport = updatedPage.getViewport({ scale: 1 });
  const maxWidth = Math.max(baselineViewport.width, updatedViewport.width);
  const maxHeight = Math.max(baselineViewport.height, updatedViewport.height);
  const rawArea = maxWidth * maxHeight;
  if (!Number.isFinite(rawArea) || rawArea <= 0) {
    throw new Error('A compared page has invalid dimensions.');
  }

  const scale = Math.min(
    1,
    MAX_RENDER_SIDE / maxWidth,
    MAX_RENDER_SIDE / maxHeight,
    Math.sqrt(MAX_CANVAS_PIXELS / rawArea)
  );
  const canvasWidth = Math.max(1, Math.ceil(maxWidth * scale));
  const canvasHeight = Math.max(1, Math.ceil(maxHeight * scale));
  const [baselinePixels, updatedPixels] = await Promise.all([
    renderPagePixels(baselinePage, scale, canvasWidth, canvasHeight),
    renderPagePixels(updatedPage, scale, canvasWidth, canvasHeight)
  ]);

  return {
    differencePercent: calculatePixelDifferencePercent(baselinePixels, updatedPixels),
    pageSizeChanged:
      Math.abs(baselineViewport.width - updatedViewport.width) > 0.5 ||
      Math.abs(baselineViewport.height - updatedViewport.height) > 0.5
  };
}

/**
 * Compare page-index-aligned text and rendered appearance locally in the browser.
 * This reports detectable differences; it does not establish semantic equivalence.
 */
export async function comparePdfFiles(
  baselineFile: Blob,
  updatedFile: Blob,
  onProgress?: (progress: PdfComparisonProgress) => void
): Promise<PdfComparisonResult> {
  for (const [label, file] of [['baseline', baselineFile], ['updated', updatedFile]] as const) {
    if (file.size === 0) throw new Error('Choose a non-empty ' + label + ' PDF.');
    if (file.size > MAX_FILE_BYTES) {
      throw new Error('The ' + label + ' PDF exceeds the 150 MB comparison limit.');
    }
  }

  let baselineTask: Awaited<ReturnType<typeof createPdfDocumentTask>> | null = null;
  let updatedTask: Awaited<ReturnType<typeof createPdfDocumentTask>> | null = null;
  try {
    baselineTask = await createPdfDocumentTask(baselineFile);
    updatedTask = await createPdfDocumentTask(updatedFile);
    const [baselineDocument, updatedDocument] = await Promise.all([
      baselineTask.promise,
      updatedTask.promise
    ]);
    if (baselineDocument.numPages < 1 || updatedDocument.numPages < 1) {
      throw new Error('Both PDFs must contain at least one page.');
    }
    if (baselineDocument.numPages > MAX_PAGES || updatedDocument.numPages > MAX_PAGES) {
      throw new Error('PDF comparison supports up to 300 pages in each file.');
    }

    const comparedPages = Math.min(baselineDocument.numPages, updatedDocument.numPages);
    const totalPages = Math.max(baselineDocument.numPages, updatedDocument.numPages);
    const pages: PdfPageComparison[] = [];
    let charactersRead = 0;
    let changedPages = 0;
    let unchangedPages = 0;
    let textChangedPages = 0;
    let visualChangedPages = 0;

    for (let pageNumber = 1; pageNumber <= comparedPages; pageNumber += 1) {
      const baselinePage = await baselineDocument.getPage(pageNumber);
      const updatedPage = await updatedDocument.getPage(pageNumber);
      try {
        const [baselineText, updatedText, visual] = await Promise.all([
          extractPageText(baselinePage),
          extractPageText(updatedPage),
          comparePageVisuals(baselinePage, updatedPage)
        ]);
        charactersRead += baselineText.length + updatedText.length;
        if (charactersRead > MAX_TEXT_CHARACTERS) {
          throw new Error('PDF comparison exceeded the 20-million-character text limit.');
        }

        const textChanged = baselineText !== updatedText;
        const visualChanged =
          visual.differencePercent >= VISUAL_CHANGE_THRESHOLD_PERCENT || visual.pageSizeChanged;
        const changed = textChanged || visualChanged;
        if (textChanged) textChangedPages += 1;
        if (visualChanged) visualChangedPages += 1;
        if (changed) changedPages += 1;
        else unchangedPages += 1;

        pages.push({
          pageNumber,
          status: changed ? 'changed' : 'unchanged',
          textChanged,
          pageSizeChanged: visual.pageSizeChanged,
          visualDifferencePercent: visual.differencePercent,
          baselineTextPreview: getTextPreview(baselineText),
          updatedTextPreview: getTextPreview(updatedText)
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown rendering error';
        throw new Error('Page ' + pageNumber + ' could not be compared: ' + detail);
      } finally {
        baselinePage.cleanup();
        updatedPage.cleanup();
      }

      onProgress?.({ completedPages: pageNumber, totalPages, currentPage: pageNumber });
    }

    const addedPages = Math.max(0, updatedDocument.numPages - baselineDocument.numPages);
    const removedPages = Math.max(0, baselineDocument.numPages - updatedDocument.numPages);
    for (let pageNumber = comparedPages + 1; pageNumber <= totalPages; pageNumber += 1) {
      const added = pageNumber > baselineDocument.numPages;
      pages.push({
        pageNumber,
        status: added ? 'added' : 'removed',
        textChanged: false,
        pageSizeChanged: false,
        visualDifferencePercent: null,
        baselineTextPreview: '',
        updatedTextPreview: ''
      });
      onProgress?.({ completedPages: pageNumber, totalPages, currentPage: pageNumber });
    }

    return {
      baselinePageCount: baselineDocument.numPages,
      updatedPageCount: updatedDocument.numPages,
      comparedPages,
      changedPages,
      unchangedPages,
      addedPages,
      removedPages,
      textChangedPages,
      visualChangedPages,
      pages
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Page ')) throw error;
    const detail = error instanceof Error ? error.message : 'Unknown PDF comparison error';
    throw new Error('The PDFs could not be compared. They may be damaged, encrypted, or unsupported. ' + detail);
  } finally {
    if (baselineTask) await baselineTask.destroy().catch(() => undefined);
    if (updatedTask) await updatedTask.destroy().catch(() => undefined);
  }
}

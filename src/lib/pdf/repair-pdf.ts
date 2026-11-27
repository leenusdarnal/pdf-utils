import { PDFDocument, type PDFPage } from 'pdf-lib';
import { createPdfDocumentTask, type PdfPage } from './pdfjs-client';

export interface PdfRepairProgress {
  phase: 'opening' | 'rebuilding' | 'verifying';
  completedPages: number;
  totalPages: number;
  currentPage?: number;
}

export interface PdfRepairResult {
  bytes: Uint8Array;
  pageCount: number;
  originalSize: number;
  repairedSize: number;
  sizeChangePercent: number;
  maxVisualDifferencePercent: number;
  searchableTextPreserved: boolean;
  verification: 'passed';
}

export const PDF_REPAIR_LIMITS = {
  maxFileBytes: 75 * 1024 * 1024,
  maxPages: 200,
  maxOutputBytes: 150 * 1024 * 1024,
  maxRenderPixels: 1_200_000,
  maxRenderSide: 1_400,
  maxVisualDifferencePercent: 0.1,
  pixelChannelThreshold: 20
} as const;

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
const BYTE_RANGE_MARKER = '/ByteRange';

export function hasPdfRepairHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1_024);
  for (let offset = 0; offset <= limit - PDF_HEADER.length; offset += 1) {
    if (PDF_HEADER.every((byte, index) => bytes[offset + index] === byte)) return true;
  }
  return false;
}

/**
 * Conservatively detect a PDF signature marker before rewriting.
 *
 * This intentionally rejects any raw /ByteRange token, even when its value is
 * malformed or unusually formatted. It can produce false positives when that
 * token appears in unrelated stream data; it is not cryptographic signature
 * validation and cannot guarantee detection of every signature representation.
 */
export function hasPdfSignatureByteRange(bytes: Uint8Array): boolean {
  const source = new TextDecoder('latin1').decode(bytes);
  return /\/ByteRange\b/.test(source);
}

/** Ignore whitespace and Unicode compatibility differences, but not actual text changes. */
export function normalizeRepairText(text: string): string {
  return text.normalize('NFKC').replace(/[\t\r\n\u00a0 ]+/g, ' ').trim();
}

export function calculateRepairPixelDifferencePercent(
  baseline: Uint8ClampedArray,
  rebuilt: Uint8ClampedArray,
  channelThreshold = PDF_REPAIR_LIMITS.pixelChannelThreshold
): number {
  if (baseline.length !== rebuilt.length || baseline.length % 4 !== 0) {
    throw new Error('The original and rebuilt page images have incompatible dimensions.');
  }
  if (baseline.length === 0) return 0;

  let changedPixels = 0;
  const pixelCount = baseline.length / 4;
  for (let index = 0; index < baseline.length; index += 4) {
    if (
      Math.abs(baseline[index] - rebuilt[index]) > channelThreshold ||
      Math.abs(baseline[index + 1] - rebuilt[index + 1]) > channelThreshold ||
      Math.abs(baseline[index + 2] - rebuilt[index + 2]) > channelThreshold ||
      Math.abs(baseline[index + 3] - rebuilt[index + 3]) > channelThreshold
    ) {
      changedPixels += 1;
    }
  }
  return Number(((changedPixels / pixelCount) * 100).toFixed(3));
}

function boxesMatch(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
  tolerance = 0.01
): boolean {
  return (
    Math.abs(first.x - second.x) <= tolerance &&
    Math.abs(first.y - second.y) <= tolerance &&
    Math.abs(first.width - second.width) <= tolerance &&
    Math.abs(first.height - second.height) <= tolerance
  );
}

export function areRepairPageGeometriesEquivalent(original: PDFPage, rebuilt: PDFPage): boolean {
  return (
    boxesMatch(original.getMediaBox(), rebuilt.getMediaBox()) &&
    boxesMatch(original.getCropBox(), rebuilt.getCropBox()) &&
    original.getRotation().angle === rebuilt.getRotation().angle
  );
}

async function extractComparableText(page: PdfPage): Promise<string> {
  const content = await page.getTextContent();
  const fragments: string[] = [];
  for (const item of content.items) {
    if ('str' in item && item.str) fragments.push(item.str);
  }
  return normalizeRepairText(fragments.join(' '));
}

function getRenderScale(page: PdfPage): { scale: number; width: number; height: number } {
  const viewport = page.getViewport({ scale: 1 });
  const area = viewport.width * viewport.height;
  if (!Number.isFinite(area) || area <= 0) {
    throw new Error('The PDF contains a page with invalid rendering dimensions.');
  }
  const scale = Math.min(
    1,
    PDF_REPAIR_LIMITS.maxRenderSide / viewport.width,
    PDF_REPAIR_LIMITS.maxRenderSide / viewport.height,
    Math.sqrt(PDF_REPAIR_LIMITS.maxRenderPixels / area)
  );
  return {
    scale,
    width: Math.max(1, Math.ceil(viewport.width * scale)),
    height: Math.max(1, Math.ceil(viewport.height * scale))
  };
}

async function renderPagePixels(
  page: PdfPage,
  scale: number,
  width: number,
  height: number
): Promise<Uint8ClampedArray> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.');

  try {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    await page.render({
      canvas,
      viewport: page.getViewport({ scale }),
      background: '#ffffff'
    }).promise;
    return new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function getPageLimitError(pageCount: number): string | null {
  return pageCount > PDF_REPAIR_LIMITS.maxPages
    ? 'This tool supports up to ' + PDF_REPAIR_LIMITS.maxPages + ' pages per PDF.'
    : null;
}

/**
 * Rebuild a supported PDF's cross-reference/trailer structures using pdf-lib.
 * The rebuilt document is returned only when PDF.js and pdf-lib can reopen it
 * and all page geometry, selectable text, and bounded visual renderings match.
 *
 * This is not a general damaged-content recovery tool. Files that cannot be
 * parsed, signed documents, and documents whose rendered/text content changes
 * are rejected; the source Blob is never modified.
 */
export async function repairPdfStructure(
  source: Blob,
  onProgress?: (progress: PdfRepairProgress) => void
): Promise<PdfRepairResult> {
  if (source.size === 0) throw new Error('Choose a non-empty PDF file.');
  if (source.size > PDF_REPAIR_LIMITS.maxFileBytes) {
    throw new Error('This tool supports PDF files up to 75 MB.');
  }

  const sourceBytes = new Uint8Array(await source.arrayBuffer());
  if (!hasPdfRepairHeader(sourceBytes)) {
    throw new Error('This file does not contain a valid PDF header.');
  }
  if (hasPdfSignatureByteRange(sourceBytes)) {
    throw new Error('This PDF contains a signature byte-range marker and was not rebuilt. The check is conservative and is not cryptographic signature validation.');
  }

  let originalLoadingTask: Awaited<ReturnType<typeof createPdfDocumentTask>> | null = null;
  let rebuiltLoadingTask: Awaited<ReturnType<typeof createPdfDocumentTask>> | null = null;
  try {
    onProgress?.({ phase: 'opening', completedPages: 0, totalPages: 0 });
    let originalPdf: PDFDocument;
    try {
      originalPdf = await PDFDocument.load(sourceBytes);
    } catch {
      throw new Error(
        'The PDF could not be parsed by the supported recovery engine. Password-protected files and damaged page-content streams cannot be repaired by this tool.'
      );
    }

    const originalPages = originalPdf.getPages();
    if (originalPages.length < 1) throw new Error('The PDF does not contain any pages.');
    const pageLimitError = getPageLimitError(originalPages.length);
    if (pageLimitError) throw new Error(pageLimitError);

    originalLoadingTask = await createPdfDocumentTask(source);
    const originalRenderDocument = await originalLoadingTask.promise;
    if (originalRenderDocument.numPages !== originalPages.length) {
      throw new Error('The PDF parsers disagree about the page count. A safe rebuild is not possible.');
    }

    onProgress?.({
      phase: 'rebuilding',
      completedPages: 0,
      totalPages: originalPages.length
    });
    let rebuiltBytes: Uint8Array;
    try {
      // Use a classic cross-reference table for broad reader compatibility.
      rebuiltBytes = await originalPdf.save({ useObjectStreams: false, addDefaultPage: false });
    } catch {
      throw new Error('The PDF structure could not be rewritten safely. The original file has not been changed.');
    }
    if (rebuiltBytes.byteLength > PDF_REPAIR_LIMITS.maxOutputBytes) {
      throw new Error('The rebuilt PDF exceeds the 150 MB output safety limit.');
    }

    let rebuiltPdf: PDFDocument;
    try {
      rebuiltPdf = await PDFDocument.load(rebuiltBytes);
    } catch {
      throw new Error('The rebuilt PDF failed structural validation and was discarded.');
    }
    const rebuiltPages = rebuiltPdf.getPages();
    if (rebuiltPages.length !== originalPages.length) {
      throw new Error('The rebuilt PDF does not contain the original number of pages and was discarded.');
    }
    for (let index = 0; index < originalPages.length; index += 1) {
      if (!areRepairPageGeometriesEquivalent(originalPages[index], rebuiltPages[index])) {
        throw new Error('Page ' + (index + 1) + ' dimensions or rotation changed during rebuilding. The output was discarded.');
      }
    }

    rebuiltLoadingTask = await createPdfDocumentTask(
      new Blob([rebuiltBytes as BlobPart], { type: 'application/pdf' })
    );
    const rebuiltRenderDocument = await rebuiltLoadingTask.promise;
    if (rebuiltRenderDocument.numPages !== originalRenderDocument.numPages) {
      throw new Error('PDF.js could not reopen the rebuilt file with the original page count.');
    }

    let maxVisualDifferencePercent = 0;
    let completedPages = 0;
    for (let pageNumber = 1; pageNumber <= originalRenderDocument.numPages; pageNumber += 1) {
      onProgress?.({
        phase: 'verifying',
        completedPages,
        totalPages: originalRenderDocument.numPages,
        currentPage: pageNumber
      });

      const originalPage = await originalRenderDocument.getPage(pageNumber);
      let rebuiltPageForCleanup: PdfPage | null = null;
      try {
        const rebuiltPage = await rebuiltRenderDocument.getPage(pageNumber);
        rebuiltPageForCleanup = rebuiltPage;
        const [originalText, rebuiltText] = await Promise.all([
          extractComparableText(originalPage),
          extractComparableText(rebuiltPage)
        ]);
        if (originalText !== rebuiltText) {
          throw new Error('Page ' + pageNumber + ' searchable text changed during rebuilding. The output was discarded.');
        }

        const originalRender = getRenderScale(originalPage);
        const rebuiltRender = getRenderScale(rebuiltPage);
        if (originalRender.width !== rebuiltRender.width || originalRender.height !== rebuiltRender.height) {
          throw new Error('Page ' + pageNumber + ' render dimensions changed during rebuilding. The output was discarded.');
        }

        const originalPixels = await renderPagePixels(
          originalPage,
          originalRender.scale,
          originalRender.width,
          originalRender.height
        );
        const rebuiltPixels = await renderPagePixels(
          rebuiltPage,
          rebuiltRender.scale,
          rebuiltRender.width,
          rebuiltRender.height
        );
        const visualDifference = calculateRepairPixelDifferencePercent(originalPixels, rebuiltPixels);
        maxVisualDifferencePercent = Math.max(maxVisualDifferencePercent, visualDifference);
        if (visualDifference > PDF_REPAIR_LIMITS.maxVisualDifferencePercent) {
          throw new Error(
            'Page ' + pageNumber + ' visual content changed by ' + visualDifference +
            '%. The output exceeded the ' + PDF_REPAIR_LIMITS.maxVisualDifferencePercent +
            '% safety threshold and was discarded.'
          );
        }
      } finally {
        originalPage.cleanup();
        rebuiltPageForCleanup?.cleanup();
      }

      completedPages += 1;
      onProgress?.({
        phase: 'verifying',
        completedPages,
        totalPages: originalRenderDocument.numPages,
        currentPage: pageNumber
      });
    }

    return {
      bytes: rebuiltBytes,
      pageCount: originalPages.length,
      originalSize: source.size,
      repairedSize: rebuiltBytes.byteLength,
      sizeChangePercent: Number((((rebuiltBytes.byteLength - source.size) / source.size) * 100).toFixed(1)),
      maxVisualDifferencePercent,
      searchableTextPreserved: true,
      verification: 'passed'
    };
  } finally {
    if (rebuiltLoadingTask) await rebuiltLoadingTask.destroy().catch(() => undefined);
    if (originalLoadingTask) await originalLoadingTask.destroy().catch(() => undefined);
  }
}

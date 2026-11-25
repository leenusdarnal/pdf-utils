import { createPdfDocumentTask } from './pdfjs-client';

export type ImageFormat = 'png' | 'jpeg';
export type ImageDpi = 72 | 150 | 200 | 300;

export interface PdfImageExportOptions {
  pages: readonly number[];
  format: ImageFormat;
  dpi: ImageDpi;
  quality?: number;
}

export interface PdfPageImage {
  pageNumber: number;
  fileName: string;
  blob: Blob;
}

const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_PIXELS = 80_000_000;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not encode this page as an image.'));
      },
      mimeType,
      quality
    );
  });
}

function safeBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\\.pdf$/i, '').trim();
  const safe = withoutExtension.replace(/[\\/:*?"<>|\\x00-\\x1f]/g, '-').replace(/\\s+/g, '-');
  return safe.slice(0, 80) || 'document';
}

/**
 * Render selected PDF pages sequentially to keep peak canvas memory bounded.
 * The source file is read locally and is never uploaded.
 */
export async function exportPdfPagesToImages(
  source: File | Blob,
  options: PdfImageExportOptions,
  onProgress?: (completed: number, total: number, pageNumber: number) => void
): Promise<PdfPageImage[]> {
  if (options.pages.length === 0) {
    throw new Error('Select at least one page to export.');
  }
  if (!Number.isFinite(options.dpi) || options.dpi < 72 || options.dpi > 300) {
    throw new Error('Choose a supported resolution between 72 and 300 DPI.');
  }

  const uniquePages = [...new Set(options.pages)];
  if (uniquePages.length !== options.pages.length) {
    throw new Error('A page can only be selected once.');
  }

  const loadingTask = await createPdfDocumentTask(source);
  const outputs: PdfPageImage[] = [];
  let pageCount = 0;

  try {
    const pdf = await loadingTask.promise;
    pageCount = pdf.numPages;
    if (pageCount < 1) throw new Error('The PDF does not contain any pages.');
    if (uniquePages.some((pageNumber) => !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount)) {
      throw new Error('One or more selected pages are outside the document.');
    }

    const sourceName = 'name' in source && typeof source.name === 'string' ? source.name : 'document.pdf';
    const baseName = safeBaseName(sourceName);
    const extension = options.format === 'jpeg' ? 'jpg' : 'png';
    const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const quality = Math.min(1, Math.max(0.1, options.quality ?? 0.9));
    const scale = options.dpi / 72;

    for (let index = 0; index < uniquePages.length; index += 1) {
      const pageNumber = uniquePages[index];
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);

      if (
        width > MAX_CANVAS_SIDE ||
        height > MAX_CANVAS_SIDE ||
        width * height > MAX_CANVAS_PIXELS
      ) {
        page.cleanup();
        throw new Error(
          'Page ' + pageNumber + ' is too large at ' + options.dpi +
          ' DPI. Choose a lower resolution and try again.'
        );
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) {
        page.cleanup();
        throw new Error('Canvas rendering is not available in this browser.');
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);

      try {
        await page.render({ canvas, viewport }).promise;
        const blob = await canvasToBlob(canvas, mimeType, options.format === 'jpeg' ? quality : undefined);
        const paddedPage = String(pageNumber).padStart(String(pageCount).length, '0');
        outputs.push({
          pageNumber,
          fileName: baseName + '-page-' + paddedPage + '.' + extension,
          blob
        });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }

      onProgress?.(index + 1, uniquePages.length, pageNumber);
    }
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error('The PDF could not be converted. It may be damaged or password-protected.');
  } finally {
    await loadingTask.destroy();
  }

  return outputs;
}

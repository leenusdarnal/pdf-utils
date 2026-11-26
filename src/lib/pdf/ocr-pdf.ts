import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { createWorker } from 'tesseract.js';
import { createPdfDocumentTask, type PdfPage } from './pdfjs-client';
import {
  getOcrFontSize,
  hasSelectableText,
  mapOcrWordBounds,
  sanitizeOcrWord
} from './ocr-helpers';

const MAX_FILE_BYTES = 150 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_PIXELS = 35_000_000;
const OCR_RENDER_SCALE = 2;

export type SearchableOcrStage =
  | 'checking'
  | 'loading-engine'
  | 'rendering'
  | 'recognizing'
  | 'saving';

export interface SearchableOcrProgress {
  stage: SearchableOcrStage;
  completedPages: number;
  totalPages: number;
  currentPage: number;
  engineProgress?: number;
  detail?: string;
}

export interface SearchableOcrResult {
  bytes: Uint8Array;
  totalPages: number;
  searchablePages: number;
  processedPages: number;
  recognizedWords: number;
}

export interface SearchableOcrOptions {
  /** SvelteKit base path, for example /pdf-utils on GitHub Pages. */
  assetBasePath: string;
  signal?: AbortSignal;
}

function abortError(): Error {
  const error = new Error('OCR was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function getAssetRoot(basePath: string): string {
  const normalizedBase = basePath.replace(/\/+$/, '');
  return normalizedBase + '/tesseract';
}

function getSafeRenderViewport(page: PdfPage) {
  let scale = OCR_RENDER_SCALE;
  let viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const scaleLimit = Math.min(
    1,
    MAX_CANVAS_SIDE / width,
    MAX_CANVAS_SIDE / height,
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height))
  );

  if (scaleLimit < 1) {
    scale *= scaleLimit;
    viewport = page.getViewport({ scale });
  }

  return viewport;
}

/**
 * Add an invisible, word-positioned English text layer to scanned pages.
 * The document is rendered and recognized locally; the original bytes are
 * never uploaded. Pages that already contain selectable text are preserved.
 */
export async function createSearchableOcrPdf(
  source: File | Blob,
  options: SearchableOcrOptions,
  onProgress?: (progress: SearchableOcrProgress) => void
): Promise<SearchableOcrResult> {
  if (source.size > MAX_FILE_BYTES) {
    throw new Error('This PDF exceeds the 150 MB OCR limit.');
  }

  throwIfAborted(options.signal);
  onProgress?.({
    stage: 'checking',
    completedPages: 0,
    totalPages: 0,
    currentPage: 0,
    detail: 'Opening the PDF locally…'
  });

  const sourceBytes = new Uint8Array(await source.arrayBuffer());
  let outputDocument: PDFDocument;
  try {
    outputDocument = await PDFDocument.load(sourceBytes);
  } catch {
    throw new Error(
      'This PDF could not be opened. Password-protected or damaged PDFs are not supported.'
    );
  }

  const totalPages = outputDocument.getPageCount();
  if (totalPages < 1) throw new Error('The PDF does not contain any pages.');
  if (totalPages > MAX_PAGES) {
    throw new Error('This OCR tool supports up to 100 pages per document.');
  }

  const loadingTask = await createPdfDocumentTask(source);
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  let workerTerminated = false;
  let font: PDFFont | null = null;
  let searchablePages = 0;
  let processedPages = 0;
  let recognizedWords = 0;
  let scannedPages = 0;

  const terminateWorker = () => {
    if (worker && !workerTerminated) {
      workerTerminated = true;
      void worker.terminate().catch(() => undefined);
    }
  };

  options.signal?.addEventListener('abort', terminateWorker, { once: true });

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages !== totalPages) {
      throw new Error('The PDF page count could not be read consistently. Please try another copy.');
    }

    const assetRoot = getAssetRoot(options.assetBasePath);
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      throwIfAborted(options.signal);
      const page = await pdf.getPage(pageNumber);
      let canvas: HTMLCanvasElement | null = null;

      try {
        const textContent = await page.getTextContent();
        const existingText = textContent.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');

        if (hasSelectableText(existingText)) {
          searchablePages += 1;
          onProgress?.({
            stage: 'checking',
            completedPages: pageNumber,
            totalPages,
            currentPage: pageNumber,
            detail: 'Page ' + pageNumber + ' already contains selectable text.'
          });
          continue;
        }

        scannedPages += 1;
        throwIfAborted(options.signal);

        if (!worker) {
          onProgress?.({
            stage: 'loading-engine',
            completedPages: pageNumber - 1,
            totalPages,
            currentPage: pageNumber,
            detail: 'Loading the on-device English OCR engine and language model…'
          });

          try {
            worker = await createWorker('eng', 1, {
              workerPath: assetRoot + '/worker.min.js',
              corePath: assetRoot + '/core',
              langPath: assetRoot + '/lang',
              gzip: true,
              workerBlobURL: false,
              cacheMethod: 'write',
              logger: (message) => {
                onProgress?.({
                  stage: 'loading-engine',
                  completedPages: pageNumber - 1,
                  totalPages,
                  currentPage: pageNumber,
                  engineProgress:
                    typeof message.progress === 'number' ? message.progress : undefined,
                  detail: message.status
                });
              }
            });
          } catch {
            throw new Error(
              'The local OCR engine could not be loaded. Refresh the app and check that its OCR assets are available.'
            );
          }
          throwIfAborted(options.signal);
          if (workerTerminated) throw abortError();
        }

        const viewport = getSafeRenderViewport(page);
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        if (
          width < 1 ||
          height < 1 ||
          width > MAX_CANVAS_SIDE ||
          height > MAX_CANVAS_SIDE ||
          width * height > MAX_CANVAS_PIXELS
        ) {
          throw new Error(
            'Page ' + pageNumber + ' is too large to OCR safely. Split the PDF or use a smaller scan.'
          );
        }

        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas rendering is not available in this browser.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);

        onProgress?.({
          stage: 'rendering',
          completedPages: pageNumber - 1,
          totalPages,
          currentPage: pageNumber,
          detail: 'Rendering scanned page ' + pageNumber + '…'
        });
        await page.render({ canvas, viewport }).promise;
        throwIfAborted(options.signal);

        onProgress?.({
          stage: 'recognizing',
          completedPages: pageNumber - 1,
          totalPages,
          currentPage: pageNumber,
          detail: 'Recognizing English text on page ' + pageNumber + '…'
        });
        const recognition = await worker.recognize(canvas, {}, { blocks: true });
        throwIfAborted(options.signal);

        const words = (recognition.data.blocks ?? [])
          .flatMap((block) => block.paragraphs ?? [])
          .flatMap((paragraph) => paragraph.lines ?? [])
          .flatMap((line) => line.words ?? []);
        let pageWordCount = 0;
        if (!font) font = await outputDocument.embedFont(StandardFonts.Helvetica);
        const outputPage = outputDocument.getPage(pageNumber - 1);

        for (const word of words) {
          const text = sanitizeOcrWord(word.text);
          if (!text) continue;

          const placement = mapOcrWordBounds(viewport, word.bbox);
          if (!placement) continue;

          outputPage.drawText(text, {
            x: placement.x,
            y: placement.y,
            size: getOcrFontSize(placement.height),
            font,
            opacity: 0
          });
          pageWordCount += 1;
        }

        if (pageWordCount > 0) {
          processedPages += 1;
          recognizedWords += pageWordCount;
        }
      } finally {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        page.cleanup();
      }

      onProgress?.({
        stage: 'recognizing',
        completedPages: pageNumber,
        totalPages,
        currentPage: pageNumber,
        detail: 'Finished page ' + pageNumber + ' of ' + totalPages + '.'
      });
    }

    throwIfAborted(options.signal);
    if (scannedPages === 0) {
      throw new Error(
        'Every page already contains selectable text. Use PDF to Text & Markdown to export it.'
      );
    }
    if (processedPages === 0) {
      throw new Error(
        'No readable English text was found in the scanned pages. Try a clearer or higher-resolution scan.'
      );
    }

    onProgress?.({
      stage: 'saving',
      completedPages: totalPages,
      totalPages,
      currentPage: totalPages,
      detail: 'Creating the searchable PDF copy…'
    });

    const bytes = await outputDocument.save();
    return {
      bytes,
      totalPages,
      searchablePages,
      processedPages,
      recognizedWords
    };
  } finally {
    options.signal?.removeEventListener('abort', terminateWorker);
    if (worker && !workerTerminated) {
      workerTerminated = true;
      await worker.terminate().catch(() => undefined);
    }
    await loadingTask.destroy();
  }
}

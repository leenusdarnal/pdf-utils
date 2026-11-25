import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

export type PdfDocumentTask = PDFDocumentLoadingTask;
export type PdfDocument = PDFDocumentProxy;
export type PdfPage = PDFPageProxy;
export type PdfRenderTask = RenderTask;

export interface PdfTextLayerTask {
  promise: Promise<void>;
  cancel(): void;
}

/**
 * Creates a PDF.js loading task for a local file.
 * PDF.js and its matching worker are loaded by the browser; document bytes
 * are passed directly to PDF.js and are not sent to a remote service.
 */
export async function createPdfDocumentTask(file: Blob): Promise<PdfDocumentTask> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data });
}

/**
 * Renders selectable text into a layer positioned over the page canvas.
 * The caller must pass the same viewport instance used for canvas rendering.
 */
export async function createPdfTextLayerTask(
  page: PdfPage,
  container: HTMLDivElement,
  viewport: PageViewport
): Promise<PdfTextLayerTask> {
  const pdfjs = await import('pdfjs-dist');
  const textLayer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport
  });

  return {
    promise: textLayer.render(),
    cancel: () => textLayer.cancel()
  };
}

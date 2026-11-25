import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

export type PdfDocumentTask = ReturnType<typeof import('pdfjs-dist').getDocument>;
export type PdfDocument = Awaited<PdfDocumentTask['promise']>;
export type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
export type PdfRenderTask = ReturnType<PdfPage['render']>;

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
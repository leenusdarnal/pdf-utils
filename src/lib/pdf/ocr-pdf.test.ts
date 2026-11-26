import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

function createPdfBlob(bytes: Uint8Array): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'application/pdf' });
}

afterEach(() => {
  vi.doUnmock('tesseract.js');
  vi.doUnmock('./pdfjs-client');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('createSearchableOcrPdf export fidelity', () => {
  it('reopens the searchable copy and preserves existing text and rotated scanned-page geometry', async () => {
    const sourceDocument = await PDFDocument.create();
    const font = await sourceDocument.embedFont(StandardFonts.Helvetica);
    const searchablePage = sourceDocument.addPage([612, 792]);
    searchablePage.drawText('ORIGINAL SEARCHABLE CONTENT', {
      x: 50,
      y: 700,
      size: 16,
      font
    });

    const scannedPage = sourceDocument.addPage([420, 300]);
    scannedPage.setCropBox(20, 20, 360, 260);
    scannedPage.setRotation(degrees(90));
    const source = createPdfBlob(await sourceDocument.save());
    const originalBytes = new Uint8Array(await source.arrayBuffer());

    const scannedViewport = {
      width: 520,
      height: 720,
      // PDF.js viewport coordinates are scaled image coordinates with a top-left origin.
      // This transform maps a 90° rotated viewport into the source page's crop-box space.
      convertToPdfPoint: (x: number, y: number): [number, number] => [
        20 + y / 2,
        20 + x / 2
      ]
    };

    const pages = [
      {
        getTextContent: async () => ({ items: [{ str: 'ORIGINAL SEARCHABLE CONTENT' }] }),
        getViewport: () => ({ width: 1224, height: 1584 }),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
        cleanup: vi.fn()
      },
      {
        getTextContent: async () => ({ items: [] }),
        getViewport: () => scannedViewport,
        render: vi.fn(() => ({ promise: Promise.resolve() })),
        cleanup: vi.fn()
      }
    ];

    const fakePdf = {
      numPages: 2,
      getPage: async (pageNumber: number) => pages[pageNumber - 1]
    };
    const loadingTask = {
      promise: Promise.resolve(fakePdf),
      destroy: vi.fn(async () => undefined)
    };
    const worker = {
      recognize: vi.fn(async () => ({
        data: {
          blocks: [
            {
              paragraphs: [
                {
                  lines: [
                    {
                      words: [
                        { text: 'ROTATED', bbox: { x0: 100, y0: 100, x1: 250, y1: 140 } },
                        { text: 'OCR', bbox: { x0: 270, y0: 100, x1: 340, y1: 140 } }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      })),
      terminate: vi.fn(async () => undefined)
    };

    vi.doMock('./pdfjs-client', () => ({
      createPdfDocumentTask: vi.fn(async () => loadingTask)
    }));
    vi.doMock('tesseract.js', () => ({
      createWorker: vi.fn(async () => worker)
    }));
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: '#ffffff',
          fillRect: vi.fn()
        })
      }))
    });

    const { createSearchableOcrPdf } = await import('./ocr-pdf');
    const result = await createSearchableOcrPdf(source, { assetBasePath: '' });

    expect(result.totalPages).toBe(2);
    expect(result.searchablePages).toBe(1);
    expect(result.processedPages).toBe(1);
    expect(result.recognizedWords).toBe(2);
    expect(worker.recognize).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(originalBytes);

    const reopenedDocument = await PDFDocument.load(result.bytes);
    expect(reopenedDocument.getPageCount()).toBe(2);
    expect(reopenedDocument.getPage(1).getRotation().angle).toBe(90);
    expect(reopenedDocument.getPage(1).getCropBox()).toEqual({
      x: 20,
      y: 20,
      width: 360,
      height: 260
    });

    const pdfTask = pdfjs.getDocument({ data: result.bytes.slice() });
    const reopened = await pdfTask.promise;
    try {
      expect(reopened.numPages).toBe(2);

      const existingPage = await reopened.getPage(1);
      const existingItems = (await existingPage.getTextContent()).items;
      const existingText = existingItems
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      expect(existingText).toContain('ORIGINAL SEARCHABLE CONTENT');
      expect(existingText).not.toContain('ROTATED');

      const ocrPage = await reopened.getPage(2);
      const viewport = ocrPage.getViewport({ scale: 1 });
      expect(viewport.width).toBeCloseTo(260, 0);
      expect(viewport.height).toBeCloseTo(360, 0);

      const textItems = (await ocrPage.getTextContent()).items
        .filter((item) => 'str' in item && item.str.trim().length > 0);
      const extractedText = textItems
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      expect(extractedText).toContain('ROTATED');
      expect(extractedText).toContain('OCR');

      for (const item of textItems) {
        if (!('transform' in item)) continue;
        expect(item.transform[4]).toBeGreaterThanOrEqual(19);
        expect(item.transform[4]).toBeLessThanOrEqual(381);
        expect(item.transform[5]).toBeGreaterThanOrEqual(19);
        expect(item.transform[5]).toBeLessThanOrEqual(281);
      }
    } finally {
      await pdfTask.destroy();
    }
  });
});

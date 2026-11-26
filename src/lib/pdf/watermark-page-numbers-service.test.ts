import { describe, expect, it } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addWatermarkAndPageNumbers } from './watermark-page-numbers-service';

describe('addWatermarkAndPageNumbers', () => {
  async function createSource(): Promise<Blob> {
    const document = await PDFDocument.create();
    document.addPage([300, 400]);
    const rotatedPage = document.addPage([420, 300]);
    rotatedPage.setCropBox(10, 12, 390, 270);
    rotatedPage.setRotation(degrees(90));
    document.addPage([612, 792]);
    const bytes = await document.save();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Blob([buffer], { type: 'application/pdf' });
  }

  it('adds overlays while preserving pages, crop boxes, rotations, and the source', async () => {
    const source = await createSource();
    const originalBytes = new Uint8Array(await source.arrayBuffer());
    const original = await PDFDocument.load(originalBytes);
    const result = await addWatermarkAndPageNumbers(source, {
      pages: [1, 2],
      watermark: { text: 'DRAFT', color: '#777777', fontSize: 52, opacity: 0.24, angle: 45 },
      pageNumbers: { format: 'page-of-total', position: 'bottom-center', color: '#333333', fontSize: 10, margin: 24 }
    });
    const output = await PDFDocument.load(result.bytes);
    expect(result.totalPages).toBe(3);
    expect(result.changedPages).toBe(2);
    expect(output.getPageCount()).toBe(3);
    expect(output.getPage(1).getRotation().angle).toBe(90);
    expect(output.getPage(1).getCropBox()).toEqual(original.getPage(1).getCropBox());
    expect(result.bytes.byteLength).toBeGreaterThan(originalBytes.byteLength);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(originalBytes);
  });

  it('reopens output and verifies watermark and page-number placement on a rotated crop box', async () => {
    const source = await createSource();
    const result = await addWatermarkAndPageNumbers(source, {
      pages: [2],
      watermark: { text: 'ROTATED WATERMARK', color: '#777777', fontSize: 36, opacity: 0.3, angle: 0 },
      pageNumbers: { format: 'page-of-total', position: 'bottom-center', color: '#333333', fontSize: 10, margin: 24 }
    });
    const loadingTask = pdfjs.getDocument({ data: result.bytes.slice() });
    const reopened = await loadingTask.promise;

    try {
      const page = await reopened.getPage(2);
      const viewport = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items.filter((item) => 'str' in item);
      const textItems = items.filter((item) => 'transform' in item);
      const text = textItems.map((item) => item.str).join(' ');

      expect(viewport.width).toBeCloseTo(270, 1);
      expect(viewport.height).toBeCloseTo(390, 1);
      expect(text).toContain('ROTATED WATERMARK');
      expect(text).toContain('Page 2 of 3');

      const watermark = textItems.find((item) => item.str === 'ROTATED WATERMARK');
      const pageNumber = textItems.find((item) => item.str === 'Page 2 of 3');
      expect(watermark).toBeDefined();
      expect(pageNumber).toBeDefined();
      if (!watermark || !('transform' in watermark) || !pageNumber || !('transform' in pageNumber)) {
        throw new Error('Expected overlay text could not be located in the exported PDF.');
      }

      const watermarkX = watermark.transform[4];
      const watermarkY = watermark.transform[5];
      expect(watermarkX).toBeGreaterThan(40);
      expect(watermarkX).toBeLessThan(230);
      expect(watermarkY).toBeGreaterThan(130);
      expect(watermarkY).toBeLessThan(300);

      const pageNumberX = pageNumber.transform[4];
      const pageNumberY = pageNumber.transform[5];
      expect(pageNumberX).toBeGreaterThan(40);
      expect(pageNumberX).toBeLessThan(230);
      expect(pageNumberY).toBeGreaterThan(8);
      expect(pageNumberY).toBeLessThan(80);
    } finally {
      await loadingTask.destroy();
    }
  });

  it('adds page numbers without requiring a watermark', async () => {
    const result = await addWatermarkAndPageNumbers(await createSource(), {
      pages: [2],
      pageNumbers: { format: 'number', position: 'top-right', color: '#111111', fontSize: 12, margin: 16 }
    });
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(3);
    expect(result.changedPages).toBe(1);
  });

  it('rejects empty operations and invalid page selections', async () => {
    await expect(addWatermarkAndPageNumbers(await createSource(), { pages: [] })).rejects.toThrow(
      'Enable a watermark or page numbers'
    );
    await expect(addWatermarkAndPageNumbers(await createSource(), {
      pages: [4],
      watermark: { text: 'DRAFT', color: '#777777', fontSize: 48, opacity: 0.2, angle: 45 }
    })).rejects.toThrow('outside the document');
  });

  it('rejects invalid colors and malformed PDFs', async () => {
    await expect(addWatermarkAndPageNumbers(await createSource(), {
      pages: [1],
      watermark: { text: 'DRAFT', color: 'red', fontSize: 48, opacity: 0.2, angle: 45 }
    })).rejects.toThrow('six-digit hex color');
    await expect(addWatermarkAndPageNumbers(new Blob(['not a PDF']), {
      pages: [1],
      pageNumbers: { format: 'number', position: 'bottom-center', color: '#333333', fontSize: 10, margin: 20 }
    })).rejects.toThrow('could not be opened');
  });
});

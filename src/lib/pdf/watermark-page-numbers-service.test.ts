import { describe, expect, it } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
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

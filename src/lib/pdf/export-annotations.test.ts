import { describe, expect, it } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
import type { PdfAnnotation } from '$lib/annotations/annotations';
import { exportAnnotatedPdf } from './export-annotations';

describe('exportAnnotatedPdf', () => {
  async function createSource(): Promise<Blob> {
    const document = await PDFDocument.create();
    document.addPage([300, 400]);
    const rotatedPage = document.addPage([420, 300]);
    rotatedPage.setCropBox(10, 12, 390, 270);
    rotatedPage.setRotation(degrees(90));
    const bytes = await document.save();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Blob([buffer], { type: 'application/pdf' });
  }

  it('adds every supported annotation type without rasterizing or dropping pages', async () => {
    const source = await createSource();
    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    const annotations: PdfAnnotation[] = [
      {
        id: 'highlight-1',
        type: 'highlight',
        pageNumber: 1,
        createdAt: 1,
        updatedAt: 1,
        color: '#f5c542',
        opacity: 0.38,
        rects: [{ x: 0.1, y: 0.12, width: 0.4, height: 0.03 }]
      },
      {
        id: 'note-1',
        type: 'text-note',
        pageNumber: 1,
        createdAt: 2,
        updatedAt: 2,
        color: '#2463eb',
        opacity: 1,
        anchor: { x: 0.65, y: 0.24 },
        text: 'Review this paragraph before approval.\nRésumé — notes may contain unsupported glyphs.'
      },
      {
        id: 'freehand-1',
        type: 'freehand',
        pageNumber: 1,
        createdAt: 3,
        updatedAt: 3,
        color: '#2463eb',
        opacity: 0.85,
        points: [{ x: 0.1, y: 0.5 }, { x: 0.25, y: 0.55 }, { x: 0.4, y: 0.52 }],
        strokeWidth: 0.004
      },
      {
        id: 'rectangle-1',
        type: 'rectangle',
        pageNumber: 2,
        createdAt: 4,
        updatedAt: 4,
        color: '#2463eb',
        opacity: 1,
        rect: { x: 0.2, y: 0.2, width: 0.3, height: 0.25 },
        strokeWidth: 0.003,
        fillOpacity: 0.08
      },
      {
        id: 'arrow-1',
        type: 'arrow',
        pageNumber: 2,
        createdAt: 5,
        updatedAt: 5,
        color: '#c2410c',
        opacity: 1,
        start: { x: 0.1, y: 0.7 },
        end: { x: 0.55, y: 0.45 },
        strokeWidth: 0.003
      }
    ];

    const output = await exportAnnotatedPdf(source, annotations);
    const reopened = await PDFDocument.load(output);
    const original = await PDFDocument.load(sourceBytes);

    expect(reopened.getPageCount()).toBe(2);
    expect(reopened.getPage(2).getRotation().angle).toBe(90);
    expect(reopened.getPage(1).getSize()).toEqual(original.getPage(1).getSize());
    expect(output.byteLength).toBeGreaterThan(sourceBytes.byteLength);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(sourceBytes);
  });

  it('rejects exports without annotations', async () => {
    await expect(exportAnnotatedPdf(await createSource(), [])).rejects.toThrow(
      'Add at least one annotation'
    );
  });

  it('rejects annotations that point beyond the source page count', async () => {
    const invalid: PdfAnnotation = {
      id: 'outside-page',
      type: 'arrow',
      pageNumber: 3,
      createdAt: 1,
      updatedAt: 1,
      color: '#2463eb',
      opacity: 1,
      start: { x: 0.1, y: 0.1 },
      end: { x: 0.8, y: 0.8 },
      strokeWidth: 0.003
    };
    await expect(exportAnnotatedPdf(await createSource(), [invalid])).rejects.toThrow(
      'An annotation refers to a page that does not exist'
    );
  });

  it('rejects malformed annotation data before writing a PDF', async () => {
    const invalid = {
      id: 'bad-highlight',
      type: 'highlight',
      pageNumber: 1,
      createdAt: 1,
      updatedAt: 1,
      color: 'red',
      opacity: 1,
      rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }]
    } as unknown as PdfAnnotation;

    await expect(exportAnnotatedPdf(await createSource(), [invalid])).rejects.toThrow(
      'six-digit CSS hex color'
    );
  });
});

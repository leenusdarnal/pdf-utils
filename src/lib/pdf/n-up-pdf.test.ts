import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  calculateNUpCells,
  calculateNUpPlacement,
  createNUpPdf,
  getNUpFileName,
  resolveNUpGrid,
  resolveNUpPageSequence,
  resolveNUpSheetSize
} from './n-up-pdf';

function defaultOptions(overrides: Partial<Parameters<typeof createNUpPdf>[1]> = {}) {
  return {
    layout: '4-up' as const,
    rows: 2,
    columns: 2,
    pageSize: 'a4' as const,
    orientation: 'portrait' as const,
    marginMm: 10,
    gutterMm: 4,
    pageNumbers: [1, 2, 3, 4, 5],
    reverseOrder: false,
    ...overrides
  };
}

async function createSourcePdf(pageCount = 5): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pageCount; index += 1) {
    const page = document.addPage(index % 2 === 0 ? [420, 300] : [612, 792]);
    page.drawText('SOURCE PAGE ' + index, { x: 40, y: 40, size: 18, font });
  }
  return document.save();
}

function createPdfBlob(bytes: Uint8Array): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'application/pdf' });
}

describe('resolveNUpGrid', () => {
  it('resolves 2-up and 6-up to useful rows and columns for each sheet orientation', () => {
    expect(resolveNUpGrid('2-up', 'auto')).toMatchObject({
      rows: 1, columns: 2, orientation: 'landscape', pagesPerSheet: 2
    });
    expect(resolveNUpGrid('2-up', 'portrait')).toMatchObject({
      rows: 2, columns: 1, orientation: 'portrait', pagesPerSheet: 2
    });
    expect(resolveNUpGrid('6-up', 'landscape')).toMatchObject({
      rows: 2, columns: 3, pagesPerSheet: 6
    });
    expect(resolveNUpGrid('6-up', 'portrait')).toMatchObject({
      rows: 3, columns: 2, pagesPerSheet: 6
    });
  });

  it('supports 4, 9 and 16-up layouts and validates custom grids', () => {
    expect(resolveNUpGrid('4-up', 'auto').pagesPerSheet).toBe(4);
    expect(resolveNUpGrid('9-up', 'auto').pagesPerSheet).toBe(9);
    expect(resolveNUpGrid('16-up', 'auto').pagesPerSheet).toBe(16);
    expect(resolveNUpGrid('custom', 'auto', 2, 3)).toMatchObject({
      rows: 2, columns: 3, orientation: 'landscape', pagesPerSheet: 6
    });
    expect(() => resolveNUpGrid('custom', 'auto', 0, 3)).toThrow('A custom grid must contain');
    expect(() => resolveNUpGrid('custom', 'auto', 4, 5)).toThrow('A custom grid must contain');
  });
});

describe('sheet and cell geometry', () => {
  it('resolves paper dimensions with the requested orientation', () => {
    const portrait = resolveNUpSheetSize('a4', 'portrait');
    const landscape = resolveNUpSheetSize('a4', 'landscape');
    expect(portrait.height).toBeGreaterThan(portrait.width);
    expect(landscape.width).toBeGreaterThan(landscape.height);
  });

  it('creates reading-order cells from left to right and top to bottom', () => {
    const cells = calculateNUpCells(600, 800, { rows: 2, columns: 2 }, 0, 0);
    expect(cells).toHaveLength(4);
    expect(cells[0].x).toBeLessThan(cells[1].x);
    expect(cells[0].y).toBeGreaterThan(cells[2].y);
    expect(cells[3].x).toBeGreaterThan(cells[2].x);
  });

  it('rejects margins and gutters that leave no printable area', () => {
    expect(() => calculateNUpCells(100, 100, { rows: 2, columns: 2 }, 25, 20))
      .toThrow('no room for the page grid');
    expect(() => calculateNUpCells(600, 800, { rows: 2, columns: 2 }, 26, 2))
      .toThrow('between 0 and 25 mm');
  });
});

describe('calculateNUpPlacement', () => {
  const cell = { x: 10, y: 20, width: 300, height: 400 };

  it('contains a portrait page without changing its aspect ratio', () => {
    const placement = calculateNUpPlacement(200, 400, 0, cell);
    expect(placement.width / placement.height).toBeCloseTo(0.5);
    expect(placement.x).toBeGreaterThanOrEqual(cell.x);
    expect(placement.y).toBeGreaterThanOrEqual(cell.y);
    expect(placement.rotation).toBe(0);
  });

  it('swaps visual dimensions for quarter-turn source pages', () => {
    const clockwise = calculateNUpPlacement(200, 400, 90, cell);
    const counterClockwise = calculateNUpPlacement(200, 400, 270, cell);
    expect(clockwise.rotation).toBe(-90);
    expect(counterClockwise.rotation).toBe(90);
    expect(clockwise.width).toBeCloseTo(counterClockwise.width);
    expect(clockwise.height).toBeCloseTo(counterClockwise.height);
    expect(clockwise.y).toBeGreaterThan(cell.y);
    expect(counterClockwise.x).toBeGreaterThan(cell.x);
  });

  it('normalizes non-zero quarter-turn values and rejects invalid sizes', () => {
    expect(calculateNUpPlacement(100, 200, 450, cell).rotation).toBe(-90);
    expect(() => calculateNUpPlacement(0, 200, 0, cell)).toThrow('invalid dimensions');
  });
});

describe('resolveNUpPageSequence', () => {
  it('preserves the selected order or reverses it when requested', () => {
    expect(resolveNUpPageSequence([1, 4, 2, 3], false)).toEqual([1, 4, 2, 3]);
    expect(resolveNUpPageSequence([1, 4, 2, 3], true)).toEqual([3, 2, 4, 1]);
  });

  it('rejects empty, repeated, and invalid page numbers', () => {
    expect(() => resolveNUpPageSequence([], false)).toThrow('Select at least one page');
    expect(() => resolveNUpPageSequence([1, 1], false)).toThrow('invalid or repeated');
    expect(() => resolveNUpPageSequence([0], false)).toThrow('invalid or repeated');
  });
});

describe('createNUpPdf', () => {
  it('creates print-ready sheets and leaves the original source untouched', async () => {
    const sourceBytes = await createSourcePdf(5);
    const source = createPdfBlob(sourceBytes);
    const originalBytes = new Uint8Array(await source.arrayBuffer());
    const result = await createNUpPdf(source, defaultOptions());

    expect(result.sourcePages).toBe(5);
    expect(result.outputPages).toBe(2);
    expect(result.pagesPerSheet).toBe(4);
    expect(result.fileSize).toBe(result.bytes.byteLength);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(originalBytes);

    const output = await PDFDocument.load(result.bytes);
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
    expect(output.getPage(0).getHeight()).toBeCloseTo(841.89, 0);
    expect(output.getPage(1).getWidth()).toBeCloseTo(595.28, 0);
  });

  it('supports a final partially-filled sheet and a reversed page sequence', async () => {
    const source = createPdfBlob(await createSourcePdf(5));
    const result = await createNUpPdf(source, defaultOptions({
      layout: '2-up',
      orientation: 'landscape',
      pageNumbers: [1, 2, 3, 4, 5],
      reverseOrder: true
    }));
    const output = await PDFDocument.load(result.bytes);

    expect(result.outputPages).toBe(3);
    expect(result.pagesPerSheet).toBe(2);
    expect(output.getPageCount()).toBe(3);
    expect(output.getPage(0).getWidth()).toBeGreaterThan(output.getPage(0).getHeight());
  });

  it('preserves valid blank source pages as empty cells', async () => {
    const blankDocument = await PDFDocument.create();
    blankDocument.addPage([612, 792]);
    blankDocument.addPage([612, 792]);
    blankDocument.addPage([612, 792]);
    const source = createPdfBlob(await blankDocument.save());
    const result = await createNUpPdf(
      source,
      defaultOptions({ layout: '2-up', orientation: 'landscape', pageNumbers: [1, 2, 3] })
    );
    const output = await PDFDocument.load(result.bytes);

    expect(result.sourcePages).toBe(3);
    expect(result.outputPages).toBe(2);
    expect(output.getPageCount()).toBe(2);
  });

  it('rejects unsupported page selections and invalid spacing', async () => {
    const source = createPdfBlob(await createSourcePdf(2));
    await expect(createNUpPdf(source, defaultOptions({ pageNumbers: [1, 3] })))
      .rejects.toThrow('outside the document');
    await expect(createNUpPdf(source, defaultOptions({ marginMm: 26 })))
      .rejects.toThrow('between 0 and 25 mm');
  });

  it('sanitizes output names', () => {
    expect(getNUpFileName('Quarterly report.pdf')).toBe('Quarterly-report-n-up.pdf');
    expect(getNUpFileName('***')).toBe('document-n-up.pdf');
  });
});

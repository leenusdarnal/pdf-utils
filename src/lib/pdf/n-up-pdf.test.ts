import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  calculateNUpCell,
  createNUpPdf,
  getNUpGrid,
  MAX_N_UP_SELECTED_PAGES,
  resolveNUpPageSize,
  safeNUpFileName,
  type NUpPdfOptions
} from './n-up-pdf';

const options: NUpPdfOptions = {
  pagesPerSheet: 2,
  pageSize: 'a4',
  orientation: 'auto',
  marginMm: 10,
  gutterMm: 6,
  readingOrder: 'row-major',
  showCellBorders: true,
  showPageLabels: true
};

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage(index % 2 === 0 ? [595.28, 841.89] : [841.89, 595.28]);
    page.drawText('Source page ' + (index + 1), { x: 40, y: 40, size: 14 });
    if (index === 1) page.setRotation(degrees(90));
  }
  return pdf.save();
}

describe('getNUpGrid', () => {
  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [4, 2, 2],
    [6, 3, 2],
    [9, 3, 3],
    [16, 4, 4]
  ] as const)('maps %i pages to a %ix%i grid', (count, columns, rows) => {
    expect(getNUpGrid(count)).toEqual({ columns, rows });
  });
});

describe('resolveNUpPageSize', () => {
  it('chooses a sheet orientation from the grid when set to auto', () => {
    const twoUp = resolveNUpPageSize('a4', 'auto', { columns: 2, rows: 1 });
    const fourUp = resolveNUpPageSize('a4', 'auto', { columns: 2, rows: 2 });
    expect(twoUp.width).toBeGreaterThan(twoUp.height);
    expect(fourUp.height).toBeGreaterThan(fourUp.width);
  });

  it('honours explicitly selected portrait and landscape paper', () => {
    const portrait = resolveNUpPageSize('letter', 'portrait', { columns: 4, rows: 1 });
    const landscape = resolveNUpPageSize('letter', 'landscape', { columns: 1, rows: 4 });
    expect(portrait.width).toBeLessThan(portrait.height);
    expect(landscape.width).toBeGreaterThan(landscape.height);
  });
});

describe('calculateNUpCell', () => {
  const paper = { width: 612, height: 792 };
  const grid = { columns: 2, rows: 2 };

  it('places row-major cells from top-left to bottom-right', () => {
    const first = calculateNUpCell(paper, grid, 0, 10, 5, 'row-major');
    const second = calculateNUpCell(paper, grid, 1, 10, 5, 'row-major');
    const third = calculateNUpCell(paper, grid, 2, 10, 5, 'row-major');

    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeCloseTo(first.y);
    expect(third.x).toBeCloseTo(first.x);
    expect(third.y).toBeLessThan(first.y);
  });

  it('supports column-major reading order', () => {
    const first = calculateNUpCell(paper, grid, 0, 10, 5, 'column-major');
    const second = calculateNUpCell(paper, grid, 1, 10, 5, 'column-major');
    expect(second.x).toBeCloseTo(first.x);
    expect(second.y).toBeLessThan(first.y);
  });

  it('rejects margins and gutters that leave no printable grid', () => {
    expect(() => calculateNUpCell(paper, grid, 0, 50, 25)).toThrow(
      'The margins and spacing leave no room for the selected page grid.'
    );
    expect(() => calculateNUpCell(paper, grid, 0, 51, 0)).toThrow(
      'Choose page margins between 0 and 50 mm.'
    );
  });
});

describe('safeNUpFileName', () => {
  it('normalizes the output name', () => {
    expect(safeNUpFileName('Meeting notes.pdf')).toBe('Meeting-notes.pdf');
    expect(safeNUpFileName('***')).toBe('n-up-layout.pdf');
  });
});

describe('createNUpPdf', () => {
  it('creates print-ready sheets, groups pages, and reports progress in source order', async () => {
    const sourceBytes = await makePdf(5);
    const progress: number[] = [];
    const outputBytes = await createNUpPdf(
      new Blob([sourceBytes as BlobPart], { type: 'application/pdf' }),
      '1-5',
      options,
      (event) => progress.push(event.sourcePageNumber)
    );
    const output = await PDFDocument.load(outputBytes);

    expect(output.getPageCount()).toBe(3);
    expect(output.getPages()[0].getSize().width).toBeGreaterThan(output.getPages()[0].getSize().height);
    expect(output.getPages()[1].getSize().width).toBeGreaterThan(output.getPages()[1].getSize().height);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps custom selected-page order and creates one sheet for one selected page', async () => {
    const sourceBytes = await makePdf(5);
    const progress: number[] = [];
    const outputBytes = await createNUpPdf(
      new Blob([sourceBytes as BlobPart]),
      '5, 1',
      { ...options, pagesPerSheet: 4, orientation: 'portrait' },
      (event) => progress.push(event.sourcePageNumber)
    );
    const output = await PDFDocument.load(outputBytes);

    expect(output.getPageCount()).toBe(1);
    expect(progress).toEqual([5, 1]);
    expect(output.getPages()[0].getSize().height).toBeGreaterThan(output.getPages()[0].getSize().width);
  });

  it('accepts a rotated source page and emits a valid PDF', async () => {
    const sourceBytes = await makePdf(2);
    const outputBytes = await createNUpPdf(
      new Blob([sourceBytes as BlobPart]),
      '2',
      { ...options, pagesPerSheet: 1 }
    );
    const output = await PDFDocument.load(outputBytes);
    expect(output.getPageCount()).toBe(1);
  });

  it('rejects invalid, repeated, and oversized page selections', async () => {
    const sourceBytes = await makePdf(3);
    const source = new Blob([sourceBytes as BlobPart]);

    await expect(createNUpPdf(source, '0', options)).rejects.toThrow(
      'Page numbers must be between 1 and 3.'
    );
    await expect(createNUpPdf(source, '1, 1', options)).rejects.toThrow(
      'Page 1 appears more than once in this range.'
    );

    const tooMany = Array.from({ length: MAX_N_UP_SELECTED_PAGES + 1 }, (_, index) => String(index + 1)).join(',');
    await expect(createNUpPdf(source, tooMany, options)).rejects.toThrow(
      'Page numbers must be between 1 and 3.'
    );
  });

  it('rejects unsupported page counts, invalid spacing, and non-PDF input', async () => {
    const sourceBytes = await makePdf(2);
    const source = new Blob([sourceBytes as BlobPart]);

    await expect(createNUpPdf(source, '1-2', { ...options, pagesPerSheet: 3 as 2 })).rejects.toThrow(
      'Choose 1, 2, 4, 6, 9, or 16 pages per sheet.'
    );
    await expect(createNUpPdf(source, '1-2', { ...options, gutterMm: 26 })).rejects.toThrow(
      'Choose page spacing between 0 and 25 mm.'
    );
    await expect(createNUpPdf(new Blob(['not a pdf']), '1', options)).rejects.toThrow(
      'This PDF could not be opened. It may be damaged or password-protected.'
    );
  });
});

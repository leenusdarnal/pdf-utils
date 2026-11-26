import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import { parsePageRange } from './split-pdf';

export type NUpPagesPerSheet = 1 | 2 | 4 | 6 | 9 | 16;
export type NUpPageSize = 'a4' | 'letter' | 'legal';
export type NUpOrientation = 'auto' | 'portrait' | 'landscape';
export type NUpReadingOrder = 'row-major' | 'column-major';

export interface NUpPdfOptions {
  pagesPerSheet: NUpPagesPerSheet;
  pageSize: NUpPageSize;
  orientation: NUpOrientation;
  marginMm: number;
  gutterMm: number;
  readingOrder: NUpReadingOrder;
  showCellBorders: boolean;
  showPageLabels: boolean;
}

export interface NUpGrid {
  columns: number;
  rows: number;
}

export interface NUpPageSizePoints {
  width: number;
  height: number;
}

export interface NUpCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NUpProgress {
  completed: number;
  total: number;
  sourcePageNumber: number;
  sheetNumber: number;
  sheetCount: number;
}

const POINTS_PER_MM = 72 / 25.4;
const PAGE_SIZES: Record<NUpPageSize, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008]
};

export const N_UP_PAGE_COUNTS: readonly NUpPagesPerSheet[] = [1, 2, 4, 6, 9, 16];
export const MAX_N_UP_SOURCE_BYTES = 150 * 1024 * 1024;
export const MAX_N_UP_SELECTED_PAGES = 500;
export const MAX_N_UP_DOCUMENT_PAGES = 5_000;

function assertValidOptions(options: NUpPdfOptions): void {
  if (!N_UP_PAGE_COUNTS.includes(options.pagesPerSheet)) {
    throw new Error('Choose 1, 2, 4, 6, 9, or 16 pages per sheet.');
  }
  if (!Object.prototype.hasOwnProperty.call(PAGE_SIZES, options.pageSize)) {
    throw new Error('Choose A4, US Letter, or US Legal paper.');
  }
  if (!['auto', 'portrait', 'landscape'].includes(options.orientation)) {
    throw new Error('Choose automatic, portrait, or landscape orientation.');
  }
  if (!['row-major', 'column-major'].includes(options.readingOrder)) {
    throw new Error('Choose a valid page reading order.');
  }
  if (!Number.isFinite(options.marginMm) || options.marginMm < 0 || options.marginMm > 50) {
    throw new Error('Choose page margins between 0 and 50 mm.');
  }
  if (!Number.isFinite(options.gutterMm) || options.gutterMm < 0 || options.gutterMm > 25) {
    throw new Error('Choose page spacing between 0 and 25 mm.');
  }
}

export function getNUpGrid(pagesPerSheet: NUpPagesPerSheet): NUpGrid {
  switch (pagesPerSheet) {
    case 1:
      return { columns: 1, rows: 1 };
    case 2:
      return { columns: 2, rows: 1 };
    case 4:
      return { columns: 2, rows: 2 };
    case 6:
      return { columns: 3, rows: 2 };
    case 9:
      return { columns: 3, rows: 3 };
    case 16:
      return { columns: 4, rows: 4 };
  }
}

export function resolveNUpPageSize(
  pageSize: NUpPageSize,
  orientation: NUpOrientation,
  grid: NUpGrid
): NUpPageSizePoints {
  const base = PAGE_SIZES[pageSize];
  if (!base) throw new Error('Choose A4, US Letter, or US Legal paper.');
  if (!Number.isInteger(grid.columns) || !Number.isInteger(grid.rows) || grid.columns < 1 || grid.rows < 1) {
    throw new Error('The selected page grid is invalid.');
  }

  let [width, height] = base;
  const landscape = orientation === 'landscape' ||
    (orientation === 'auto' && grid.columns > grid.rows);
  const portrait = orientation === 'portrait' ||
    (orientation === 'auto' && grid.rows >= grid.columns);

  if (landscape && width < height) [width, height] = [height, width];
  if (portrait && width > height) [width, height] = [height, width];
  return { width, height };
}

export function calculateNUpCell(
  pageSize: NUpPageSizePoints,
  grid: NUpGrid,
  slotIndex: number,
  marginMm: number,
  gutterMm: number,
  readingOrder: NUpReadingOrder = 'row-major'
): NUpCell {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= grid.columns * grid.rows) {
    throw new Error('The selected N-up cell is outside the page grid.');
  }
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 50) {
    throw new Error('Choose page margins between 0 and 50 mm.');
  }
  if (!Number.isFinite(gutterMm) || gutterMm < 0 || gutterMm > 25) {
    throw new Error('Choose page spacing between 0 and 25 mm.');
  }
  if (!['row-major', 'column-major'].includes(readingOrder)) {
    throw new Error('Choose a valid page reading order.');
  }

  const margin = marginMm * POINTS_PER_MM;
  const gutter = gutterMm * POINTS_PER_MM;
  const width = (pageSize.width - margin * 2 - gutter * (grid.columns - 1)) / grid.columns;
  const height = (pageSize.height - margin * 2 - gutter * (grid.rows - 1)) / grid.rows;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The margins and spacing leave no room for the selected page grid.');
  }

  const column = readingOrder === 'row-major'
    ? slotIndex % grid.columns
    : Math.floor(slotIndex / grid.rows);
  const row = readingOrder === 'row-major'
    ? Math.floor(slotIndex / grid.columns)
    : slotIndex % grid.rows;

  return {
    x: margin + column * (width + gutter),
    y: pageSize.height - margin - (row + 1) * height - row * gutter,
    width,
    height
  };
}

export function safeNUpFileName(value: string): string {
  const base = value
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return (base || 'n-up-layout') + '.pdf';
}

/**
 * Arrange selected source pages as vector page forms on print-sized sheets.
 * Input page order follows the page-range expression; source bytes are never changed.
 */
export async function createNUpPdf(
  source: Blob,
  pageSelection: string,
  options: NUpPdfOptions,
  onProgress?: (progress: NUpProgress) => void
): Promise<Uint8Array> {
  if (source.size === 0) throw new Error('The selected PDF is empty.');
  if (source.size > MAX_N_UP_SOURCE_BYTES) {
    throw new Error('This PDF is larger than the 150 MB local processing limit.');
  }
  assertValidOptions(options);

  let sourceDocument: PDFDocument;
  try {
    sourceDocument = await PDFDocument.load(new Uint8Array(await source.arrayBuffer()));
  } catch {
    throw new Error('This PDF could not be opened. It may be damaged or password-protected.');
  }

  const totalDocumentPages = sourceDocument.getPageCount();
  if (totalDocumentPages < 1) throw new Error('The PDF does not contain any pages.');
  if (totalDocumentPages > MAX_N_UP_DOCUMENT_PAGES) {
    throw new Error('This PDF has more than 5,000 pages. Split it into smaller documents first.');
  }

  const selectedPageNumbers = parsePageRange(pageSelection, totalDocumentPages);
  if (selectedPageNumbers.length > MAX_N_UP_SELECTED_PAGES) {
    throw new Error('Select no more than 500 pages for one N-up export.');
  }

  const grid = getNUpGrid(options.pagesPerSheet);
  const sheetSize = resolveNUpPageSize(options.pageSize, options.orientation, grid);
  // Validate the geometry before creating any output pages.
  calculateNUpCell(sheetSize, grid, 0, options.marginMm, options.gutterMm, options.readingOrder);
  const sheetCount = Math.ceil(selectedPageNumbers.length / options.pagesPerSheet);
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  output.setTitle('N-up PDF layout');
  output.setProducer('PDF Utils');

  const sourcePages: PDFPage[] = sourceDocument.getPages();
  let completed = 0;

  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
    const sheet = output.addPage([sheetSize.width, sheetSize.height]);
    const startIndex = sheetIndex * options.pagesPerSheet;
    const endIndex = Math.min(startIndex + options.pagesPerSheet, selectedPageNumbers.length);

    for (let selectedIndex = startIndex; selectedIndex < endIndex; selectedIndex += 1) {
      const pageNumber = selectedPageNumbers[selectedIndex];
      const slotIndex = selectedIndex - startIndex;
      const cell = calculateNUpCell(
        sheetSize,
        grid,
        slotIndex,
        options.marginMm,
        options.gutterMm,
        options.readingOrder
      );
      const embeddedPages = await output.embedPages([sourcePages[pageNumber - 1]]);
      const embeddedPage = embeddedPages[0];
      const scale = Math.min(cell.width / embeddedPage.width, cell.height / embeddedPage.height);
      const width = embeddedPage.width * scale;
      const height = embeddedPage.height * scale;

      sheet.drawPage(embeddedPage, {
        x: cell.x + (cell.width - width) / 2,
        y: cell.y + (cell.height - height) / 2,
        width,
        height
      });

      if (options.showCellBorders) {
        sheet.drawRectangle({
          x: cell.x,
          y: cell.y,
          width: cell.width,
          height: cell.height,
          borderColor: rgb(0.72, 0.74, 0.78),
          borderWidth: 0.45,
          borderOpacity: 0.8
        });
      }

      if (options.showPageLabels) {
        sheet.drawText(String(pageNumber), {
          x: cell.x + 4,
          y: cell.y + 4,
          size: 7,
          font,
          color: rgb(0.32, 0.34, 0.38)
        });
      }

      completed += 1;
      onProgress?.({
        completed,
        total: selectedPageNumbers.length,
        sourcePageNumber: pageNumber,
        sheetNumber: sheetIndex + 1,
        sheetCount
      });
    }
  }

  return output.save();
}

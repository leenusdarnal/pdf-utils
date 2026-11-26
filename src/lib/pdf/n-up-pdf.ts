import { degrees, PDFDocument, type PDFPage } from 'pdf-lib';

export type NUpLayout = '2-up' | '4-up' | '6-up' | '9-up' | '16-up' | 'custom';
export type NUpPageSize = 'a4' | 'letter' | 'legal' | 'a3';
export type NUpOrientation = 'auto' | 'portrait' | 'landscape';

export interface NUpPdfOptions {
  layout: NUpLayout;
  rows: number;
  columns: number;
  pageSize: NUpPageSize;
  orientation: NUpOrientation;
  marginMm: number;
  gutterMm: number;
  pageNumbers: readonly number[];
  reverseOrder: boolean;
}

export interface NUpGrid {
  rows: number;
  columns: number;
  orientation: 'portrait' | 'landscape';
  pagesPerSheet: number;
}

export interface NUpCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NUpPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
}

export interface NUpProgress {
  completedPages: number;
  totalPages: number;
  currentPage: number;
  sheetNumber: number;
  totalSheets: number;
}

export interface NUpPdfResult {
  bytes: Uint8Array;
  sourcePages: number;
  outputPages: number;
  pagesPerSheet: number;
  fileSize: number;
}

const POINTS_PER_MM = 72 / 25.4;
const MAX_NUP_FILE_BYTES = 150 * 1024 * 1024;
const MAX_NUP_SOURCE_PAGES = 500;
const MAX_NUP_OUTPUT_PAGES = 500;
const MAX_PAGE_SIDE_POINTS = 14_400;

const PAGE_SIZE_POINTS: Record<NUpPageSize, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55]
};

function validateSpacing(marginMm: number, gutterMm: number): void {
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 25) {
    throw new Error('Choose a sheet margin between 0 and 25 mm.');
  }
  if (!Number.isFinite(gutterMm) || gutterMm < 0 || gutterMm > 20) {
    throw new Error('Choose a page gap between 0 and 20 mm.');
  }
}

export function resolveNUpGrid(
  layout: NUpLayout,
  orientation: NUpOrientation,
  customRows = 2,
  customColumns = 2
): NUpGrid {
  if (!['auto', 'portrait', 'landscape'].includes(orientation)) {
    throw new Error('Choose portrait, landscape, or automatic sheet orientation.');
  }

  if (layout === 'custom') {
    if (
      !Number.isInteger(customRows) ||
      !Number.isInteger(customColumns) ||
      customRows < 1 ||
      customColumns < 1 ||
      customRows > 4 ||
      customColumns > 4 ||
      customRows * customColumns < 2
    ) {
      throw new Error('A custom grid must contain between 2 and 16 cells, with 1–4 rows and columns.');
    }

    const resolvedOrientation = orientation === 'auto'
      ? customColumns > customRows ? 'landscape' : 'portrait'
      : orientation;
    return {
      rows: customRows,
      columns: customColumns,
      orientation: resolvedOrientation,
      pagesPerSheet: customRows * customColumns
    };
  }

  const isPreset = ['2-up', '4-up', '6-up', '9-up', '16-up'].includes(layout);
  if (!isPreset) throw new Error('Choose a supported N-up layout.');

  const resolvedOrientation = orientation === 'auto'
    ? layout === '2-up' || layout === '6-up' ? 'landscape' : 'portrait'
    : orientation;

  let rows = 2;
  let columns = 2;
  switch (layout) {
    case '2-up':
      rows = resolvedOrientation === 'landscape' ? 1 : 2;
      columns = resolvedOrientation === 'landscape' ? 2 : 1;
      break;
    case '4-up':
      rows = 2;
      columns = 2;
      break;
    case '6-up':
      rows = resolvedOrientation === 'landscape' ? 2 : 3;
      columns = resolvedOrientation === 'landscape' ? 3 : 2;
      break;
    case '9-up':
      rows = 3;
      columns = 3;
      break;
    case '16-up':
      rows = 4;
      columns = 4;
      break;
  }

  return { rows, columns, orientation: resolvedOrientation, pagesPerSheet: rows * columns };
}

export function resolveNUpSheetSize(
  pageSize: NUpPageSize,
  orientation: 'portrait' | 'landscape'
): { width: number; height: number } {
  const dimensions = PAGE_SIZE_POINTS[pageSize];
  if (!dimensions) throw new Error('Choose A4, A3, Letter, or Legal paper.');
  let [width, height] = dimensions;
  if (orientation === 'landscape' && width < height) [width, height] = [height, width];
  if (orientation === 'portrait' && width > height) [width, height] = [height, width];
  if (
    width > MAX_PAGE_SIDE_POINTS ||
    height > MAX_PAGE_SIDE_POINTS ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('The selected paper size is outside the supported range.');
  }
  return { width, height };
}

export function calculateNUpCells(
  sheetWidth: number,
  sheetHeight: number,
  grid: Pick<NUpGrid, 'rows' | 'columns'>,
  marginMm: number,
  gutterMm: number
): NUpCell[] {
  validateSpacing(marginMm, gutterMm);
  const margin = marginMm * POINTS_PER_MM;
  const gutter = gutterMm * POINTS_PER_MM;
  const availableWidth = sheetWidth - margin * 2 - gutter * (grid.columns - 1);
  const availableHeight = sheetHeight - margin * 2 - gutter * (grid.rows - 1);

  if (
    !Number.isFinite(sheetWidth) ||
    !Number.isFinite(sheetHeight) ||
    sheetWidth <= 0 ||
    sheetHeight <= 0 ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) {
    throw new Error('The selected margins and page gap leave no room for the page grid.');
  }

  const cellWidth = availableWidth / grid.columns;
  const cellHeight = availableHeight / grid.rows;
  const cells: NUpCell[] = [];

  // Reading order is left-to-right, top-to-bottom.
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const bottomRow = grid.rows - row - 1;
      cells.push({
        x: margin + column * (cellWidth + gutter),
        y: margin + bottomRow * (cellHeight + gutter),
        width: cellWidth,
        height: cellHeight
      });
    }
  }

  return cells;
}

/** Fit a source page inside a cell without stretching or cropping it. */
export function calculateNUpPlacement(
  pageWidth: number,
  pageHeight: number,
  rotation: number,
  cell: NUpCell
): NUpPlacement {
  if (
    ![pageWidth, pageHeight, rotation, cell.x, cell.y, cell.width, cell.height].every(Number.isFinite) ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    cell.width <= 0 ||
    cell.height <= 0
  ) {
    throw new Error('A source page or layout cell has invalid dimensions.');
  }

  const normalizedRotation = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  const swapsDimensions = normalizedRotation === 90 || normalizedRotation === 270;
  const visualWidth = swapsDimensions ? pageHeight : pageWidth;
  const visualHeight = swapsDimensions ? pageWidth : pageHeight;
  const scale = Math.min(cell.width / visualWidth, cell.height / visualHeight);
  const drawWidth = pageWidth * scale;
  const drawHeight = pageHeight * scale;
  const placedVisualWidth = swapsDimensions ? drawHeight : drawWidth;
  const placedVisualHeight = swapsDimensions ? drawWidth : drawHeight;
  const visualLeft = cell.x + (cell.width - placedVisualWidth) / 2;
  const visualBottom = cell.y + (cell.height - placedVisualHeight) / 2;

  switch (normalizedRotation) {
    case 90:
      return {
        x: visualLeft,
        y: visualBottom + drawWidth,
        width: drawWidth,
        height: drawHeight,
        rotation: -90,
        scale
      };
    case 180:
      return {
        x: visualLeft + drawWidth,
        y: visualBottom + drawHeight,
        width: drawWidth,
        height: drawHeight,
        rotation: 180,
        scale
      };
    case 270:
      return {
        x: visualLeft + drawHeight,
        y: visualBottom,
        width: drawWidth,
        height: drawHeight,
        rotation: 90,
        scale
      };
    default:
      return {
        x: visualLeft,
        y: visualBottom,
        width: drawWidth,
        height: drawHeight,
        rotation: 0,
        scale
      };
  }
}

export function resolveNUpPageSequence(
  pageNumbers: readonly number[],
  reverseOrder: boolean
): number[] {
  if (pageNumbers.length === 0) throw new Error('Select at least one page to arrange.');
  const seen = new Set<number>();
  for (const pageNumber of pageNumbers) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || seen.has(pageNumber)) {
      throw new Error('The selected page list contains an invalid or repeated page number.');
    }
    seen.add(pageNumber);
  }
  return reverseOrder ? [...pageNumbers].reverse() : [...pageNumbers];
}

export function getNUpFileName(sourceName: string): string {
  const baseName = sourceName
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 100);
  return (baseName || 'document') + '-n-up.pdf';
}

/**
 * Arrange selected source pages as vector page content on print-ready sheets.
 * Page appearances are embedded locally; the source PDF is never modified.
 * Interactive forms, links, comments, bookmarks, and signatures are not retained.
 */
export async function createNUpPdf(
  source: Blob,
  options: NUpPdfOptions,
  onProgress?: (progress: NUpProgress) => void
): Promise<NUpPdfResult> {
  if (source.size === 0) throw new Error('Choose a non-empty PDF file.');
  if (source.size > MAX_NUP_FILE_BYTES) {
    throw new Error('This PDF exceeds the 150 MB N-up layout limit.');
  }
  validateSpacing(options.marginMm, options.gutterMm);

  let sourceDocument;
  try {
    sourceDocument = await PDFDocument.load(new Uint8Array(await source.arrayBuffer()));
  } catch {
    throw new Error('This PDF could not be opened. It may be damaged, encrypted, or unsupported.');
  }

  const sourcePages = sourceDocument.getPages();
  if (sourcePages.length < 1) throw new Error('This PDF does not contain any pages.');
  if (sourcePages.length > MAX_NUP_SOURCE_PAGES) {
    throw new Error('This tool supports up to 500 source pages per PDF.');
  }

  const pageSequence = resolveNUpPageSequence(options.pageNumbers, options.reverseOrder);
  if (pageSequence.some((pageNumber) => pageNumber > sourcePages.length)) {
    throw new Error('One or more selected pages are outside the document.');
  }

  const grid = resolveNUpGrid(options.layout, options.orientation, options.rows, options.columns);
  const sheetSize = resolveNUpSheetSize(options.pageSize, grid.orientation);
  const cells = calculateNUpCells(
    sheetSize.width,
    sheetSize.height,
    grid,
    options.marginMm,
    options.gutterMm
  );
  const outputPageCount = Math.ceil(pageSequence.length / grid.pagesPerSheet);
  if (outputPageCount > MAX_NUP_OUTPUT_PAGES) {
    throw new Error('The resulting PDF would exceed the 500-sheet limit.');
  }

  const outputDocument = await PDFDocument.create();
  outputDocument.setTitle('N-up layout');
  outputDocument.setProducer('PDF Utils');
  outputDocument.setCreator('PDF Utils');

  for (let offset = 0; offset < pageSequence.length; offset += grid.pagesPerSheet) {
    const sheet = outputDocument.addPage([sheetSize.width, sheetSize.height]);
    const sheetNumber = Math.floor(offset / grid.pagesPerSheet) + 1;
    const group = pageSequence.slice(offset, offset + grid.pagesPerSheet);

    for (let slot = 0; slot < group.length; slot += 1) {
      const sourcePageNumber = group[slot];
      const sourcePage: PDFPage = sourcePages[sourcePageNumber - 1];
      const cropBox = sourcePage.getCropBox();
      if (cropBox.width <= 0 || cropBox.height <= 0) {
        throw new Error('Page ' + sourcePageNumber + ' has invalid visible dimensions.');
      }

      try {
        const embeddedPage = await outputDocument.embedPage(sourcePage, {
          left: cropBox.x,
          bottom: cropBox.y,
          right: cropBox.x + cropBox.width,
          top: cropBox.y + cropBox.height
        });
        const placement = calculateNUpPlacement(
          embeddedPage.width,
          embeddedPage.height,
          sourcePage.getRotation().angle,
          cells[slot]
        );
        sheet.drawPage(embeddedPage, {
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
          rotate: degrees(placement.rotation)
        });
      } catch {
        throw new Error(
          'Page ' + sourcePageNumber + ' could not be embedded. The document may contain unsupported page content.'
        );
      }

      onProgress?.({
        completedPages: offset + slot + 1,
        totalPages: pageSequence.length,
        currentPage: sourcePageNumber,
        sheetNumber,
        totalSheets: outputPageCount
      });
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await outputDocument.save();
  } catch {
    throw new Error('The arranged PDF could not be saved. Try a smaller document.');
  }

  return {
    bytes,
    sourcePages: pageSequence.length,
    outputPages: outputPageCount,
    pagesPerSheet: grid.pagesPerSheet,
    fileSize: bytes.byteLength
  };
}

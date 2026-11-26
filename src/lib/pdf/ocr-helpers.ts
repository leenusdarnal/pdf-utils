export interface OcrBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfCoordinateViewport {
  convertToPdfPoint(x: number, y: number): number[];
}

export interface PdfWordPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when a page already has enough selectable text to avoid duplicate OCR. */
export function hasSelectableText(text: string, minimumCharacters = 12): boolean {
  const meaningfulCharacters = text.replace(/[\s\p{P}\p{S}]/gu, '');
  return meaningfulCharacters.length >= minimumCharacters;
}

/** Keep OCR text compatible with the built-in WinAnsi Helvetica font. */
export function sanitizeOcrWord(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert a Tesseract image-space box to PDF user-space coordinates.
 * Transforming all four corners also handles rotated PDF.js viewports.
 */
export function mapOcrWordBounds(
  viewport: PdfCoordinateViewport,
  bounds: OcrBoundingBox
): PdfWordPlacement | null {
  const values = [bounds.x0, bounds.y0, bounds.x1, bounds.y1];
  if (!values.every(Number.isFinite) || bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) {
    return null;
  }

  const corners = [
    viewport.convertToPdfPoint(bounds.x0, bounds.y0),
    viewport.convertToPdfPoint(bounds.x1, bounds.y0),
    viewport.convertToPdfPoint(bounds.x0, bounds.y1),
    viewport.convertToPdfPoint(bounds.x1, bounds.y1)
  ];

  const xValues = corners.map(([x]) => x);
  const yValues = corners.map(([, y]) => y);
  const x = Math.min(...xValues);
  const y = Math.min(...yValues);
  const width = Math.max(...xValues) - x;
  const height = Math.max(...yValues) - y;

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

export function getOcrFontSize(boundsHeight: number): number {
  if (!Number.isFinite(boundsHeight) || boundsHeight <= 0) return 4;
  return Math.min(36, Math.max(4, boundsHeight * 0.82));
}

export function getSearchableOcrFileName(sourceName: string): string {
  const baseName = sourceName
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .trim()
    .slice(0, 120);

  return (baseName || 'document') + '-searchable.pdf';
}

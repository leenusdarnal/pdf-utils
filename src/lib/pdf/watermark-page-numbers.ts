export type PageNumberPosition = 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right';
export type PageNumberFormat = 'number' | 'page' | 'page-of-total';
export interface PageBounds { x: number; y: number; width: number; height: number; }
export interface VisualPageSize { width: number; height: number; }
export interface TextOverlayPlacement { x: number; y: number; rotation: number; centerX: number; centerY: number; }

export function normalizePageRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) return 0;
  return ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
}

export function getVisualPageSize(bounds: PageBounds, rotation: number): VisualPageSize {
  const normalized = normalizePageRotation(rotation);
  return normalized === 90 || normalized === 270
    ? { width: bounds.height, height: bounds.width }
    : { width: bounds.width, height: bounds.height };
}

/** Convert displayed-page coordinates (bottom-left origin) to PDF user space. */
export function visualPointToPdf(
  bounds: PageBounds,
  rotation: number,
  point: { x: number; y: number }
): { x: number; y: number } {
  switch (normalizePageRotation(rotation)) {
    case 90:
      return { x: bounds.x + bounds.width - point.y, y: bounds.y + point.x };
    case 180:
      return { x: bounds.x + bounds.width - point.x, y: bounds.y + bounds.height - point.y };
    case 270:
      return { x: bounds.x + point.y, y: bounds.y + bounds.height - point.x };
    default:
      return { x: bounds.x + point.x, y: bounds.y + point.y };
  }
}

/**
 * Position text by its visible center and compensate for the page's clockwise
 * rotation. This keeps the output orientation consistent with the preview.
 */
export function getTextOverlayPlacement(
  bounds: PageBounds,
  pageRotation: number,
  center: { x: number; y: number },
  textWidth: number,
  fontSize: number,
  displayAngle = 0
): TextOverlayPlacement {
  const normalizedRotation = normalizePageRotation(pageRotation);
  const localRotation = ((displayAngle + normalizedRotation) % 360 + 360) % 360;
  const centerPdf = visualPointToPdf(bounds, normalizedRotation, center);
  const radians = (localRotation * Math.PI) / 180;
  const offsetX = (textWidth / 2) * Math.cos(radians) - (fontSize / 2) * Math.sin(radians);
  const offsetY = (textWidth / 2) * Math.sin(radians) + (fontSize / 2) * Math.cos(radians);
  return {
    x: centerPdf.x - offsetX,
    y: centerPdf.y - offsetY,
    rotation: localRotation,
    centerX: center.x,
    centerY: center.y
  };
}

export function getPageNumberLabel(pageNumber: number, totalPages: number, format: PageNumberFormat): string {
  if (format === 'page-of-total') return 'Page ' + pageNumber + ' of ' + totalPages;
  if (format === 'page') return 'Page ' + pageNumber;
  return String(pageNumber);
}

export function sanitizePdfOverlayText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getOverlayFileName(sourceName: string): string {
  const baseName = sourceName
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .trim()
    .slice(0, 120);
  return (baseName || 'document') + '-watermarked.pdf';
}

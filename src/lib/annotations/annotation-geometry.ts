import type { NormalizedPoint, NormalizedRect } from './annotations';

/** The coordinate conversion methods exposed by PDF.js PageViewport. */
export interface PdfViewportTransform {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Maps a normalized point from the unrotated page coordinate system into the
 * currently rendered PDF.js viewport. This keeps saved annotations unchanged
 * when zoom, page rotation, or device pixel ratio changes.
 */
export function normalizedPointToViewport(
  point: NormalizedPoint,
  unrotatedViewport: PdfViewportTransform,
  renderedViewport: PdfViewportTransform
): NormalizedPoint {
  const [pdfX, pdfY] = unrotatedViewport.convertToPdfPoint(
    point.x * unrotatedViewport.width,
    point.y * unrotatedViewport.height
  );
  const [x, y] = renderedViewport.convertToViewportPoint(pdfX, pdfY);
  return { x, y };
}

/** Maps a point in the current rendered viewport back to normalized page space. */
export function viewportPointToNormalized(
  point: NormalizedPoint,
  renderedViewport: PdfViewportTransform,
  unrotatedViewport: PdfViewportTransform
): NormalizedPoint {
  const [pdfX, pdfY] = renderedViewport.convertToPdfPoint(point.x, point.y);
  const [pageX, pageY] = unrotatedViewport.convertToViewportPoint(pdfX, pdfY);
  return {
    x: clampUnit(pageX / unrotatedViewport.width),
    y: clampUnit(pageY / unrotatedViewport.height)
  };
}

function boundsFromPoints(points: readonly NormalizedPoint[]): ViewportRect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y
  };
}

/** Maps all four rectangle corners so quarter-turn page rotation is handled. */
export function normalizedRectToViewport(
  rect: NormalizedRect,
  unrotatedViewport: PdfViewportTransform,
  renderedViewport: PdfViewportTransform
): ViewportRect {
  const points = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  ].map((point) => normalizedPointToViewport(point, unrotatedViewport, renderedViewport));

  return boundsFromPoints(points);
}

/**
 * Converts a rectangle from viewport pixels back to normalized page space.
 * Four corners are required because a 90/270-degree page rotation swaps axes.
 */
export function viewportRectToNormalized(
  rect: ViewportRect,
  renderedViewport: PdfViewportTransform,
  unrotatedViewport: PdfViewportTransform
): NormalizedRect | null {
  const points = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  ].map((point) => viewportPointToNormalized(point, renderedViewport, unrotatedViewport));

  const bounds = boundsFromPoints(points);
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.min(1 - bounds.x, bounds.width),
    height: Math.min(1 - bounds.y, bounds.height)
  };
}

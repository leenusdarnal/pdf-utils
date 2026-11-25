import { describe, expect, it } from 'vitest';
import {
  normalizedPointToViewport,
  normalizedRectToViewport,
  viewportPointToNormalized,
  viewportRectToNormalized,
  type PdfViewportTransform
} from './annotation-geometry';

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

function createViewport(rotation: 0 | 90, scale = 1): PdfViewportTransform {
  if (rotation === 0) {
    return {
      width: PAGE_WIDTH * scale,
      height: PAGE_HEIGHT * scale,
      convertToPdfPoint: (x, y) => [x / scale, PAGE_HEIGHT - y / scale],
      convertToViewportPoint: (x, y) => [x * scale, (PAGE_HEIGHT - y) * scale]
    };
  }

  return {
    width: PAGE_HEIGHT * scale,
    height: PAGE_WIDTH * scale,
    convertToPdfPoint: (x, y) => [y / scale, x / scale],
    convertToViewportPoint: (x, y) => [y * scale, x * scale]
  };
}

describe('annotation viewport transforms', () => {
  it('maps normalized points through zoom without changing their page coordinates', () => {
    const page = createViewport(0);
    const zoomed = createViewport(0, 1.5);
    const point = { x: 0.25, y: 0.4 };

    const viewportPoint = normalizedPointToViewport(point, page, zoomed);

    expect(viewportPoint).toEqual({ x: 225, y: 480 });
    expect(viewportPointToNormalized(viewportPoint, zoomed, page)).toEqual(point);
  });

  it('maps normalized points through a quarter-turn page rotation', () => {
    const page = createViewport(0);
    const rotated = createViewport(90);
    const point = { x: 0.25, y: 0.4 };

    const viewportPoint = normalizedPointToViewport(point, page, rotated);

    expect(viewportPoint).toEqual({ x: 480, y: 150 });
    expect(viewportPointToNormalized(viewportPoint, rotated, page)).toEqual(point);
  });

  it('maps all rectangle corners and round-trips across 90-degree rotation', () => {
    const page = createViewport(0);
    const rotated = createViewport(90);
    const rect = { x: 0.2, y: 0.1, width: 0.3, height: 0.4 };

    const viewportRect = normalizedRectToViewport(rect, page, rotated);

    expect(viewportRect).toEqual({ x: 400, y: 120, width: 320, height: 180 });
    expect(viewportRectToNormalized(viewportRect, rotated, page)).toEqual(rect);
  });

  it('returns null for zero-area viewport rectangles', () => {
    const page = createViewport(0);
    expect(
      viewportRectToNormalized({ x: 120, y: 80, width: 0, height: 0 }, page, page)
    ).toBeNull();
  });
});

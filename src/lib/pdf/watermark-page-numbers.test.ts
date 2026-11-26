import { describe, expect, it } from 'vitest';
import {
  getOverlayFileName,
  getPageNumberLabel,
  getTextOverlayPlacement,
  getVisualPageSize,
  sanitizePdfOverlayText,
  visualPointToPdf
} from './watermark-page-numbers';

describe('watermark and page-number geometry', () => {
  const bounds = { x: 10, y: 20, width: 390, height: 270 };

  it('calculates displayed dimensions for page rotations', () => {
    expect(getVisualPageSize(bounds, 0)).toEqual({ width: 390, height: 270 });
    expect(getVisualPageSize(bounds, 90)).toEqual({ width: 270, height: 390 });
    expect(getVisualPageSize(bounds, 180)).toEqual({ width: 390, height: 270 });
    expect(getVisualPageSize(bounds, 270)).toEqual({ width: 270, height: 390 });
  });

  it('maps visual corners through crop-box origins and quarter turns', () => {
    expect(visualPointToPdf(bounds, 90, { x: 0, y: 0 })).toEqual({ x: 400, y: 20 });
    expect(visualPointToPdf(bounds, 90, { x: 270, y: 390 })).toEqual({ x: 10, y: 290 });
    expect(visualPointToPdf(bounds, 270, { x: 0, y: 0 })).toEqual({ x: 10, y: 290 });
    expect(visualPointToPdf(bounds, 270, { x: 270, y: 390 })).toEqual({ x: 400, y: 20 });
  });

  it('keeps horizontal and diagonal text aligned to the displayed page', () => {
    expect(getTextOverlayPlacement(bounds, 90, { x: 135, y: 195 }, 100, 12, 0).rotation).toBe(90);
    expect(getTextOverlayPlacement(bounds, 90, { x: 135, y: 195 }, 100, 48, 45).rotation).toBe(135);
    expect(getTextOverlayPlacement(bounds, 270, { x: 135, y: 195 }, 100, 48, 45).rotation).toBe(315);
  });

  it('formats page labels, sanitizes text, and creates safe output names', () => {
    expect(getPageNumberLabel(3, 12, 'number')).toBe('3');
    expect(getPageNumberLabel(3, 12, 'page')).toBe('Page 3');
    expect(getPageNumberLabel(3, 12, 'page-of-total')).toBe('Page 3 of 12');
    expect(sanitizePdfOverlayText('  “Draft”—for review' + String.fromCharCode(10) + 'now  ')).toBe('"Draft"-for review now');
    expect(getOverlayFileName('Quarter: 1/2026.pdf')).toBe('Quarter- 1-2026-watermarked.pdf');
  });
});

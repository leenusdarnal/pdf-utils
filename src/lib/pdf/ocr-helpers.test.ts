import { describe, expect, it } from 'vitest';
import {
  getOcrFontSize,
  getSearchableOcrFileName,
  hasSelectableText,
  mapOcrWordBounds,
  sanitizeOcrWord
} from './ocr-helpers';

describe('OCR helpers', () => {
  it('distinguishes text pages from image-only scanned pages', () => {
    expect(hasSelectableText('A searchable page has enough actual words here.')).toBe(true);
    expect(hasSelectableText('     ...---  ')).toBe(false);
    expect(hasSelectableText('Short')).toBe(false);
  });

  it('normalizes common OCR punctuation and removes unsupported glyphs', () => {
    expect(sanitizeOcrWord('“Sikkim”—it’s…')).toBe('"Sikkim"-it\'s...');
    expect(sanitizeOcrWord('  hello   world  ')).toBe('hello world');
    expect(sanitizeOcrWord('नेपाली')).toBe('');
  });

  it('maps all four OCR box corners through the PDF viewport', () => {
    const viewport = {
      convertToPdfPoint: (x: number, y: number): [number, number] => [100 + y, 300 - x]
    };

    expect(
      mapOcrWordBounds(viewport, { x0: 10, y0: 20, x1: 50, y1: 40 })
    ).toEqual({ x: 120, y: 250, width: 20, height: 40 });
  });

  it('rejects malformed bounds and calculates a bounded font size', () => {
    const viewport = {
      convertToPdfPoint: (x: number, y: number): [number, number] => [x, y]
    };

    expect(
      mapOcrWordBounds(viewport, { x0: 5, y0: 5, x1: 5, y1: 10 })
    ).toBeNull();
    expect(getOcrFontSize(10)).toBe(8.2);
    expect(getOcrFontSize(100)).toBe(36);
    expect(getOcrFontSize(Number.NaN)).toBe(4);
  });

  it('creates a safe output filename without overwriting the source', () => {
    expect(getSearchableOcrFileName('Quarter: 1/2026.pdf')).toBe(
      'Quarter- 1-2026-searchable.pdf'
    );
    expect(getSearchableOcrFileName('.pdf')).toBe('document-searchable.pdf');
  });
});

import { describe, expect, it } from 'vitest';
import {
  calculatePixelDifferencePercent,
  normalizeComparisonText
} from './compare-pdfs';

describe('normalizeComparisonText', () => {
  it('collapses layout whitespace while preserving punctuation and case', () => {
    expect(normalizeComparisonText('  Hello\n  PDF\t  world!  ')).toBe('Hello PDF world!');
    expect(normalizeComparisonText('Invoice #42')).not.toBe(normalizeComparisonText('invoice #42'));
  });

  it('normalizes compatibility Unicode forms', () => {
    expect(normalizeComparisonText('oﬃce')).toBe('office');
  });
});

describe('calculatePixelDifferencePercent', () => {
  it('returns zero for identical rendered pages', () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255
    ]);
    expect(calculatePixelDifferencePercent(pixels, new Uint8ClampedArray(pixels))).toBe(0);
  });

  it('counts pixels that differ beyond the antialiasing threshold', () => {
    const baseline = new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255
    ]);
    const updated = new Uint8ClampedArray([
      255, 255, 255, 255,
      200, 0, 0, 255
    ]);
    expect(calculatePixelDifferencePercent(baseline, updated)).toBe(50);
  });

  it('ignores small antialiasing changes', () => {
    const baseline = new Uint8ClampedArray([100, 100, 100, 255]);
    const updated = new Uint8ClampedArray([125, 125, 125, 255]);
    expect(calculatePixelDifferencePercent(baseline, updated)).toBe(0);
  });

  it('rejects incompatible image data', () => {
    expect(() =>
      calculatePixelDifferencePercent(new Uint8ClampedArray([0, 0, 0, 255]), new Uint8ClampedArray())
    ).toThrow('incompatible pixel buffers');
  });
});

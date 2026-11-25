import { describe, expect, it } from 'vitest';
import { clampPageNumber, clampZoom, getVisiblePageRange, hasPdfHeader } from './viewer-utils';

describe('hasPdfHeader', () => {
  it('accepts PDF bytes even when the browser MIME type is generic', async () => {
    const file = new File(['%PDF-1.7\nbody'], 'document.bin', { type: 'application/octet-stream' });
    await expect(hasPdfHeader(file)).resolves.toBe(true);
  });

  it('rejects non-PDF bytes even when the filename and MIME type claim PDF', async () => {
    const file = new File(['not a PDF'], 'document.pdf', { type: 'application/pdf' });
    await expect(hasPdfHeader(file)).resolves.toBe(false);
  });

  it('finds a PDF header within the first 1,024 bytes', async () => {
    const prefix = ' '.repeat(900);
    const file = new Blob([`${prefix}%PDF-1.7\nbody`]);
    await expect(hasPdfHeader(file)).resolves.toBe(true);
  });

  it('rejects empty and too-small files', async () => {
    await expect(hasPdfHeader(new Blob([]))).resolves.toBe(false);
    await expect(hasPdfHeader(new Blob(['%PD']))).resolves.toBe(false);
  });
});

describe('clampPageNumber', () => {
  it('keeps page navigation within the document range', () => {
    expect(clampPageNumber(0, 5)).toBe(1);
    expect(clampPageNumber(6, 5)).toBe(5);
    expect(clampPageNumber(3, 5)).toBe(3);
  });

  it('returns page one when the total page count is invalid', () => {
    expect(clampPageNumber(4, 0)).toBe(1);
    expect(clampPageNumber(Number.NaN, 5)).toBe(1);
  });
});

describe('clampZoom', () => {
  it('keeps zoom within the supported 50% to 300% range', () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(4)).toBe(3);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it('resets non-finite zoom values to the default scale', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('getVisiblePageRange', () => {
  it('returns only the pages near the viewport for a large document', () => {
    const range = getVisiblePageRange(10_000, 124 * 500, 500, 124, 2);

    expect(range.startPage).toBe(499);
    expect(range.endPage).toBe(507);
    expect(range.endPage - range.startPage + 1).toBeLessThan(12);
  });

  it('keeps the range within the first and last page', () => {

    expect(getVisiblePageRange(5, 0, 500, 124, 3)).toEqual({ startPage: 1, endPage: 5 });
    expect(getVisiblePageRange(5, 124 * 100, 500, 124, 3)).toEqual({ startPage: 5, endPage: 5 });
  });

  it('returns an empty range for a document with no pages', () => {

    expect(getVisiblePageRange(0, 0, 500)).toEqual({ startPage: 0, endPage: 0 });
  });
});

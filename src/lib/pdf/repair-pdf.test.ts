import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  areRepairPageGeometriesEquivalent,
  calculateRepairPixelDifferencePercent,
  hasPdfRepairHeader,
  hasPdfSignatureByteRange,
  normalizeRepairText,
  PDF_REPAIR_LIMITS
} from './repair-pdf';

describe('PDF repair input inspection', () => {
  it('recognizes a PDF header within the first 1,024 bytes', () => {
    const bytes = new Uint8Array(1_030);
    bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d], 900);
    expect(hasPdfRepairHeader(bytes)).toBe(true);
    expect(hasPdfRepairHeader(new Uint8Array([0x25, 0x50, 0x44, 0x58, 0x2d]))).toBe(false);
  });

  it('detects a populated signature byte-range dictionary', () => {
    const signed = new TextEncoder().encode('%PDF-1.7\n/ByteRange [0 120 500 80]\n');
    const unsigned = new TextEncoder().encode('%PDF-1.7\n/ByteRange [not a signature]\n');
    expect(hasPdfSignatureByteRange(signed)).toBe(true);
    expect(hasPdfSignatureByteRange(unsigned)).toBe(false);
  });

  it('publishes conservative file, page, output, and rendering limits', () => {
    expect(PDF_REPAIR_LIMITS).toMatchObject({
      maxFileBytes: 75 * 1024 * 1024,
      maxPages: 200,
      maxOutputBytes: 150 * 1024 * 1024
    });
  });
});

describe('repair preservation helpers', () => {
  it('normalizes whitespace and Unicode compatibility forms', () => {
    expect(normalizeRepairText('  PDF\n  repair\tﬁle  ')).toBe('PDF repair file');
  });

  it('calculates the percentage of visibly changed pixels', () => {
    const original = new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255
    ]);
    const same = new Uint8ClampedArray(original);
    const changed = new Uint8ClampedArray([
      255, 255, 255, 255,
      220, 10, 10, 255
    ]);
    expect(calculateRepairPixelDifferencePercent(original, same)).toBe(0);
    expect(calculateRepairPixelDifferencePercent(original, changed)).toBe(50);
  });

  it('ignores small antialiasing changes but rejects incompatible buffers', () => {
    expect(
      calculateRepairPixelDifferencePercent(
        new Uint8ClampedArray([100, 100, 100, 255]),
        new Uint8ClampedArray([115, 115, 115, 255])
      )
    ).toBe(0);
    expect(() =>
      calculateRepairPixelDifferencePercent(new Uint8ClampedArray([0, 0, 0, 255]), new Uint8ClampedArray())
    ).toThrow('incompatible dimensions');
  });

  it('checks media box, crop box, and rotation equivalence', async () => {
    const original = await PDFDocument.create();
    const rebuilt = await PDFDocument.create();
    const originalPage = original.addPage([612, 792]);
    const samePage = rebuilt.addPage([612, 792]);
    const differentPage = rebuilt.addPage([600, 792]);
    expect(areRepairPageGeometriesEquivalent(originalPage, samePage)).toBe(true);
    expect(areRepairPageGeometriesEquivalent(originalPage, differentPage)).toBe(false);

    samePage.setRotation(degrees(90));
    expect(areRepairPageGeometriesEquivalent(originalPage, samePage)).toBe(false);
  });
});

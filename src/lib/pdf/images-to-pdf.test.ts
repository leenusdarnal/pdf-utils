import { describe, expect, it } from 'vitest';
import {
  calculateImagePlacement,
  detectImageFormat,
  resolveImagePdfPageSize,
  safePdfFileName
} from './images-to-pdf';

describe('detectImageFormat', () => {
  it('recognizes PNG, JPEG, and WebP signatures', async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]);
    const webp = new Blob([new TextEncoder().encode('RIFF0000WEBP')]);
    const unknown = new Blob([new TextEncoder().encode('not-an-image')]);

    await expect(detectImageFormat(png)).resolves.toBe('png');
    await expect(detectImageFormat(jpeg)).resolves.toBe('jpeg');
    await expect(detectImageFormat(webp)).resolves.toBe('webp');
    await expect(detectImageFormat(unknown)).resolves.toBeNull();
  });
});

describe('resolveImagePdfPageSize', () => {
  it('chooses orientation per image when auto is selected', () => {
    const landscape = resolveImagePdfPageSize('a4', 'auto', 1200, 800, 10);
    const portrait = resolveImagePdfPageSize('a4', 'auto', 800, 1200, 10);

    expect(landscape.width).toBeGreaterThan(landscape.height);
    expect(portrait.height).toBeGreaterThan(portrait.width);
  });

  it('keeps the requested fixed orientation', () => {
    const portrait = resolveImagePdfPageSize('letter', 'portrait', 1600, 900, 0);
    const landscape = resolveImagePdfPageSize('letter', 'landscape', 900, 1600, 0);

    expect(portrait.width).toBeLessThan(portrait.height);
    expect(landscape.width).toBeGreaterThan(landscape.height);
  });

  it('uses each source image aspect ratio for fit-to-image pages', () => {
    const page = resolveImagePdfPageSize('image', 'auto', 1200, 600, 10);
    expect(page.width).toBeGreaterThan(page.height);
    expect(page.width).toBeCloseTo(1200 * 0.75 + (20 * 72) / 25.4);
    expect(page.height).toBeCloseTo(600 * 0.75 + (20 * 72) / 25.4);
  });

  it('rejects invalid margins and image dimensions', () => {
    expect(() => resolveImagePdfPageSize('a4', 'auto', 100, 100, 51)).toThrow(
      'Choose a page margin between 0 and 50 mm.'
    );
    expect(() => resolveImagePdfPageSize('a4', 'auto', 0, 100, 10)).toThrow(
      'The selected image has invalid dimensions.'
    );
  });
});

describe('calculateImagePlacement', () => {
  it('preserves the image aspect ratio and centres it when containing', () => {
    const placement = calculateImagePlacement(200, 100, 400, 400, 10, 'contain');
    expect(placement.width / placement.height).toBeCloseTo(2);
    expect(placement.x).toBeCloseTo((72 / 25.4) * 10);
    expect(placement.y).toBeGreaterThan((72 / 25.4) * 10);
  });

  it('stretches to the available area only when explicitly selected', () => {
    const placement = calculateImagePlacement(200, 100, 400, 300, 10, 'stretch');
    const margin = (72 / 25.4) * 10;
    expect(placement.x).toBeCloseTo(margin);
    expect(placement.y).toBeCloseTo(margin);
    expect(placement.width).toBeCloseTo(400 - margin * 2);
    expect(placement.height).toBeCloseTo(300 - margin * 2);
  });

  it('sanitizes the PDF output name', () => {
    expect(safePdfFileName('My holiday photos.pdf')).toBe('My-holiday-photos.pdf');
    expect(safePdfFileName('***')).toBe('images-to-pdf.pdf');
  });
});

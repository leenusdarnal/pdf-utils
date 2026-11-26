import { describe, expect, it } from 'vitest';
import {
  decodePdfImagePixels,
  safeEmbeddedImageBaseName
} from './extract-embedded-images';

describe('decodePdfImagePixels', () => {
  it('preserves RGBA pixel channels and transparency', () => {
    const pixels = decodePdfImagePixels(
      { kind: 3, data: new Uint8Array([255, 10, 20, 128]) },
      1,
      1
    );
    expect([...pixels]).toEqual([255, 10, 20, 128]);
  });

  it('expands RGB pixels with an opaque alpha channel', () => {
    const pixels = decodePdfImagePixels(
      { kind: 2, data: new Uint8Array([10, 20, 30, 40, 50, 60]) },
      2,
      1
    );
    expect([...pixels]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('expands packed 1-bit black-and-white pixels into opaque RGB values', () => {
    const pixels = decodePdfImagePixels(
      { kind: 1, data: new Uint8Array([0b10100000]) },
      3,
      1
    );
    expect([...pixels]).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255
    ]);
  });

  it('starts each packed grayscale row at a byte boundary', () => {
    const pixels = decodePdfImagePixels(
      { kind: 1, data: new Uint8Array([0b10000000, 0b10000000, 0b01000000, 0]) },
      9,
      2
    );
    expect([...pixels.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...pixels.slice((8 * 4), (8 * 4) + 4)]).toEqual([255, 255, 255, 255]);
    expect([...pixels.slice((9 + 1) * 4, (9 + 1) * 4 + 4)]).toEqual([255, 255, 255, 255]);
    expect([...pixels.slice((9 + 2) * 4, (9 + 2) * 4 + 4)]).toEqual([0, 0, 0, 255]);
  });

  it('accepts ArrayBuffer pixel data', () => {
    const bytes = new Uint8Array([1, 2, 3, 255]).buffer;
    expect([...decodePdfImagePixels({ kind: 3, data: bytes }, 1, 1)]).toEqual([1, 2, 3, 255]);
  });

  it('rejects unsupported or incomplete image data', () => {
    expect(() => decodePdfImagePixels({ kind: 4, data: new Uint8Array([1, 2]) }, 1, 1))
      .toThrow('The embedded image uses a pixel format that is not supported yet.');
    expect(() => decodePdfImagePixels({ kind: 2, data: new Uint8Array([1, 2]) }, 1, 1))
      .toThrow('The RGB image data is incomplete.');
    expect(() => decodePdfImagePixels({ kind: 3 }, 1, 1))
      .toThrow('The PDF image has no decoded pixel data.');
  });
});

describe('safeEmbeddedImageBaseName', () => {
  it('removes the PDF extension and unsafe filename characters', () => {
    expect(safeEmbeddedImageBaseName('My trip photos.pdf')).toBe('My-trip-photos');
    expect(safeEmbeddedImageBaseName('***')).toBe('document');
  });
});

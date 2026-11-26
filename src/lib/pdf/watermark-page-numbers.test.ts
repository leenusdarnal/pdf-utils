import { describe, expect, it } from 'vitest';
import { degrees, PDFDocument } from 'pdf-lib';
import {
  calculateOverlayBox,
  calculateRotatedTextOrigin,
  formatPageNumber,
  MAX_WATERMARK_IMAGE_BYTES,
  watermarkAndNumberPdf
} from './watermark-page-numbers';

async function createSource(): Promise<Blob> {
  const document = await PDFDocument.create();
  document.addPage([300, 400]);
  const rotated = document.addPage([420, 300]);
  rotated.setRotation(degrees(90));
  document.addPage([500, 700]);
  const bytes = await document.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

describe('calculateOverlayBox', () => {
  it('places a box at each requested page anchor', () => {
    expect(calculateOverlayBox(600, 800, 100, 20, 'top-left', 24)).toEqual({
      x: 24, y: 756, width: 100, height: 20
    });
    expect(calculateOverlayBox(600, 800, 100, 20, 'bottom-center', 24)).toEqual({
      x: 250, y: 24, width: 100, height: 20
    });
    expect(calculateOverlayBox(600, 800, 100, 20, 'center', 24)).toEqual({
      x: 250, y: 390, width: 100, height: 20
    });
  });

  it('keeps overlays inside pages when the requested margin exceeds the available inset', () => {
    expect(calculateOverlayBox(100, 100, 80, 80, 'bottom-right', 30)).toEqual({
      x: 0, y: 0, width: 80, height: 80
    });
    expect(() => calculateOverlayBox(100, 100, 110, 20, 'center', 0)).toThrow(
      'does not fit'
    );
  });
});

describe('calculateRotatedTextOrigin', () => {
  it('keeps the visual center fixed when PDF text is rotated', () => {
    const width = 120;
    const height = 24;
    const rotation = 35;
    const radians = rotation * Math.PI / 180;
    const rotatedWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
    const rotatedHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
    const rotatedBox = calculateOverlayBox(600, 800, rotatedWidth, rotatedHeight, 'center', 0);
    const origin = calculateRotatedTextOrigin({
      x: rotatedBox.x + (rotatedWidth - width) / 2,
      y: rotatedBox.y + (rotatedHeight - height) / 2,
      width,
      height
    }, rotation);
    const actualCenter = {
      x: origin.x + width / 2 * Math.cos(radians) - height / 2 * Math.sin(radians),
      y: origin.y + width / 2 * Math.sin(radians) + height / 2 * Math.cos(radians)
    };

    expect(actualCenter.x).toBeCloseTo(300, 8);
    expect(actualCenter.y).toBeCloseTo(400, 8);
  });
});

describe('formatPageNumber', () => {
  it('supports page-of-total, slash-total, and simple numbering formats', () => {
    expect(formatPageNumber(1, 12, 'page-of-total')).toBe('Page 1 of 12');
    expect(formatPageNumber(4, 12, 'slash-total')).toBe('4 / 12');
    expect(formatPageNumber(4, 12, 'number')).toBe('4');
  });

  it('applies a custom starting number to both the current page and total', () => {
    expect(formatPageNumber(1, 12, 'page-of-total', 7)).toBe('Page 7 of 18');
    expect(formatPageNumber(3, 12, 'slash-total', 7)).toBe('9 / 18');
  });
});

describe('watermarkAndNumberPdf', () => {
  it('adds a text watermark and page numbers to selected pages without changing page structure', async () => {
    const source = await createSource();
    const originalBytes = new Uint8Array(await source.arrayBuffer());
    const options = {
      pages: [2, 3],
      marginMm: 10,
      textWatermark: {
        text: 'DRAFT COPY',
        fontSize: 38,
        color: '#777777',
        opacity: 0.22,
        rotation: -35,
        position: 'center' as const
      },
      pageNumbers: {
        format: 'page-of-total' as const,
        startNumber: 4,
        fontSize: 10,
        color: '#555555',
        position: 'bottom-center' as const
      }
    };

    const output = await watermarkAndNumberPdf(source, options);
    const reopened = await PDFDocument.load(output);
    const original = await PDFDocument.load(originalBytes);

    expect(reopened.getPageCount()).toBe(3);
    expect(reopened.getPage(0).getSize()).toEqual(original.getPage(0).getSize());
    expect(reopened.getPage(1).getSize()).toEqual(original.getPage(1).getSize());
    expect(reopened.getPage(1).getRotation().angle).toBe(90);
    expect(reopened.getPage(2).getSize()).toEqual(original.getPage(2).getSize());
    expect(output.byteLength).toBeGreaterThan(originalBytes.byteLength);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(originalBytes);
  });

  it('embeds a PNG image watermark and can combine it with page numbering', async () => {
    const source = await createSource();
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const pngBytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
    const image = new Blob([pngBytes as BlobPart], { type: 'image/png' });

    const output = await watermarkAndNumberPdf(source, {
      pages: [1, 2, 3],
      marginMm: 8,
      imageWatermark: {
        image,
        opacity: 0.4,
        scalePercent: 18,
        position: 'center'
      },
      pageNumbers: {
        format: 'slash-total',
        startNumber: 1,
        fontSize: 9,
        color: '#222222',
        position: 'bottom-right'
      }
    });

    const reopened = await PDFDocument.load(output);
    expect(reopened.getPageCount()).toBe(3);
    expect(output.byteLength).toBeGreaterThan((await source.arrayBuffer()).byteLength);
  });

  it('rejects disabled overlays, invalid page ranges, and duplicate selected pages', async () => {
    const source = await createSource();
    await expect(watermarkAndNumberPdf(source, {
      pages: [1],
      marginMm: 8
    })).rejects.toThrow('Enable a text watermark');

    await expect(watermarkAndNumberPdf(source, {
      pages: [4],
      marginMm: 8,
      pageNumbers: {
        format: 'number',
        startNumber: 1,
        fontSize: 9,
        color: '#222222',
        position: 'bottom-center'
      }
    })).rejects.toThrow('between 1 and 3');

    await expect(watermarkAndNumberPdf(source, {
      pages: [1, 1],
      marginMm: 8,
      pageNumbers: {
        format: 'number',
        startNumber: 1,
        fontSize: 9,
        color: '#222222',
        position: 'bottom-center'
      }
    })).rejects.toThrow('more than once');
  });

  it('rejects malformed colors, opacity, and unsupported image formats', async () => {
    const source = await createSource();
    await expect(watermarkAndNumberPdf(source, {
      pages: [1],
      marginMm: 8,
      textWatermark: {
        text: 'DRAFT',
        fontSize: 30,
        color: 'red',
        opacity: 0.2,
        rotation: 0,
        position: 'center'
      }
    })).rejects.toThrow('six-digit hex color');

    await expect(watermarkAndNumberPdf(source, {
      pages: [1],
      marginMm: 8,
      textWatermark: {
        text: 'DRAFT',
        fontSize: 30,
        color: '#555555',
        opacity: 1.5,
        rotation: 0,
        position: 'center'
      }
    })).rejects.toThrow('opacity');

    await expect(watermarkAndNumberPdf(source, {
      pages: [1],
      marginMm: 8,
      imageWatermark: {
        image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
        opacity: 0.5,
        scalePercent: 20,
        position: 'center'
      }
    })).rejects.toThrow('PNG or JPEG');
  });

  it('rejects watermark images above the local processing limit', async () => {
    const source = await createSource();
    const oversizedImage = new Blob([new Uint8Array(MAX_WATERMARK_IMAGE_BYTES + 1)]);

    await expect(watermarkAndNumberPdf(source, {
      pages: [1],
      marginMm: 8,
      imageWatermark: {
        image: oversizedImage,
        opacity: 0.5,
        scalePercent: 20,
        position: 'center'
      }
    })).rejects.toThrow('smaller than 15 MB');
  });
});

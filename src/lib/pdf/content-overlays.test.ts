import { degrees, PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  addPdfContentOverlay,
  MAX_CONTENT_OVERLAY_IMAGE_BYTES,
  type PdfContentOverlay
} from './content-overlays';

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64'
  )
);

async function createSourcePdf(rotated = false): Promise<Blob> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  page.setCropBox(24, 30, 560, 720);
  if (rotated) page.setRotation(degrees(90));
  const bytes = await document.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

describe('addPdfContentOverlay', () => {
  it('adds text to a new PDF copy and preserves page boxes and the source bytes', async () => {
    const source = await createSourcePdf();
    const originalBytes = new Uint8Array(await source.arrayBuffer());
    const overlay: PdfContentOverlay = {
      type: 'text',
      pageNumber: 1,
      xPercent: 10,
      yPercent: 12,
      text: 'New content overlay',
      fontSize: 24,
      color: '#c62828'
    };

    const result = await addPdfContentOverlay(source, overlay);
    const output = await PDFDocument.load(result.bytes);
    const outputPage = output.getPage(0);

    expect(result).toMatchObject({ pageCount: 1, pageNumber: 1, fileSize: result.bytes.byteLength });
    expect(output.getPageCount()).toBe(1);
    expect(outputPage.getCropBox()).toMatchObject({ x: 24, y: 30, width: 560, height: 720 });
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(originalBytes);
  });

  it('embeds a PNG image on the selected page', async () => {
    const source = await createSourcePdf();
    const result = await addPdfContentOverlay(source, {
      type: 'image',
      pageNumber: 1,
      xPercent: 8,
      yPercent: 10,
      widthPercent: 20,
      imageType: 'png',
      imageBytes: ONE_PIXEL_PNG
    });

    const output = await PDFDocument.load(result.bytes);
    expect(output.getPageCount()).toBe(1);
    expect(result.fileSize).toBeGreaterThan(source.size);
  });

  it('rejects rotated pages until visible-coordinate transforms are implemented', async () => {
    const source = await createSourcePdf(true);

    await expect(addPdfContentOverlay(source, {
      type: 'text',
      pageNumber: 1,
      xPercent: 10,
      yPercent: 10,
      text: 'Rotated page',
      fontSize: 20,
      color: '#000000'
    })).rejects.toThrow('Rotated-page placement is not supported yet.');
  });

  it('rejects text or images that extend beyond the visible crop box', async () => {
    const source = await createSourcePdf();

    await expect(addPdfContentOverlay(source, {
      type: 'text',
      pageNumber: 1,
      xPercent: 99,
      yPercent: 95,
      text: 'Text outside page',
      fontSize: 48,
      color: '#000000'
    })).rejects.toThrow('extends beyond the visible page');

    await expect(addPdfContentOverlay(source, {
      type: 'image',
      pageNumber: 1,
      xPercent: 85,
      yPercent: 10,
      widthPercent: 30,
      imageType: 'png',
      imageBytes: ONE_PIXEL_PNG
    })).rejects.toThrow('extends beyond the visible page');
  });

  it('rejects invalid image size and invalid page selections', async () => {
    const source = await createSourcePdf();

    await expect(addPdfContentOverlay(source, {
      type: 'image',
      pageNumber: 1,
      xPercent: 0,
      yPercent: 0,
      widthPercent: 10,
      imageType: 'png',
      imageBytes: new Uint8Array(MAX_CONTENT_OVERLAY_IMAGE_BYTES + 1)
    })).rejects.toThrow('25 MB limit');

    await expect(addPdfContentOverlay(source, {
      type: 'text',
      pageNumber: 2,
      xPercent: 0,
      yPercent: 0,
      text: 'Out of range',
      fontSize: 18,
      color: '#000000'
    })).rejects.toThrow('outside the document');
  });

  it('rejects non-PDF and empty inputs safely', async () => {
    await expect(addPdfContentOverlay(new Blob([]), {
      type: 'text',
      pageNumber: 1,
      xPercent: 0,
      yPercent: 0,
      text: 'Not a PDF',
      fontSize: 18,
      color: '#000000'
    })).rejects.toThrow('non-empty PDF');

    await expect(addPdfContentOverlay(new Blob(['not a PDF']), {
      type: 'text',
      pageNumber: 1,
      xPercent: 0,
      yPercent: 0,
      text: 'Not a PDF',
      fontSize: 18,
      color: '#000000'
    })).rejects.toThrow('damaged, encrypted, or unsupported');
  });
});

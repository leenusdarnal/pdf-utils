import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  areRepairPageGeometriesEquivalent,
  calculateRepairPixelDifferencePercent,
  hasPdfRepairHeader,
  hasPdfSignatureByteRange,
  normalizeRepairText,
  PDF_REPAIR_LIMITS
} from './repair-pdf';

interface FakeCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  getContext: () => {
    fillStyle: string;
    fillRect: () => void;
    getImageData: () => { data: Uint8ClampedArray };
  };
}

interface FakePageOptions {
  text?: string;
  width?: number;
  height?: number;
  shade?: number;
  failRender?: boolean;
}

function createCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    pixels: new Uint8ClampedArray(),
    getContext: () => {
      let fillStyle = '#ffffff';
      return {
        get fillStyle() {
          return fillStyle;
        },
        set fillStyle(value: string) {
          fillStyle = value;
        },
        fillRect: () => {
          const shade = fillStyle === '#ffffff' ? 255 : 0;
          for (let offset = 0; offset < canvas.pixels.length; offset += 4) {
            canvas.pixels.set([shade, shade, shade, 255], offset);
          }
        },
        getImageData: () => ({ data: canvas.pixels })
      };
    }
  };

  return new Proxy(canvas, {
    set(target, property, value) {
      Reflect.set(target, property, value);
      if (property === 'width' || property === 'height') {
        target.pixels = new Uint8ClampedArray(target.width * target.height * 4);
      }
      return true;
    }
  });
}

function createPage(options: FakePageOptions = {}) {
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  const shade = options.shade ?? 255;

  return {
    getTextContent: vi.fn(async () => ({
      items: options.text ? [{ str: options.text }] : []
    })),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale
    })),
    render: vi.fn(({ canvas }: { canvas: FakeCanvas }) => ({
      promise: options.failRender
        ? Promise.reject(new Error('synthetic render failure'))
        : Promise.resolve().then(() => {
            for (let offset = 0; offset < canvas.pixels.length; offset += 4) {
              canvas.pixels.set([shade, shade, shade, 255], offset);
            }
          })
    })),
    cleanup: vi.fn()
  };
}

function createTask(pages: ReturnType<typeof createPage>[]) {
  const document = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1])
  };
  return {
    document,
    task: {
      promise: Promise.resolve(document),
      destroy: vi.fn(async () => undefined)
    }
  };
}

type FakeTask = ReturnType<typeof createTask>['task'];

async function createSourcePdf(): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.setCropBox(18, 24, 560, 730);
  page.setRotation(degrees(90));
  page.drawText('PRESERVED TEXT', { x: 42, y: 700, size: 16, font });
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

async function loadRepairService(originalTask: FakeTask, rebuiltTask: FakeTask) {
  const tasks = [originalTask, rebuiltTask];
  vi.doMock('./pdfjs-client', () => ({
    createPdfDocumentTask: vi.fn(async () => {
      const task = tasks.shift();
      if (!task) throw new Error('Unexpected PDF.js loading task request.');
      return task;
    })
  }));
  vi.stubGlobal('document', {
    createElement: vi.fn(() => createCanvas())
  });

  return await import('./repair-pdf');
}

afterEach(() => {
  vi.doUnmock('./pdfjs-client');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('PDF repair input inspection', () => {
  it('recognizes a PDF header within the first 1,024 bytes', () => {
    const bytes = new Uint8Array(1_030);
    bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d], 900);
    expect(hasPdfRepairHeader(bytes)).toBe(true);
    expect(hasPdfRepairHeader(new Uint8Array([0x25, 0x50, 0x44, 0x58, 0x2d]))).toBe(false);
  });

  it('detects a populated signature byte-range dictionary', () => {
    const signed = new TextEncoder().encode('%PDF-1.7\\n/ByteRange [0 120 500 80]\\n');
    const unsigned = new TextEncoder().encode('%PDF-1.7\\n/ByteRange [not a signature]\\n');
    expect(hasPdfSignatureByteRange(signed)).toBe(true);
    expect(hasPdfSignatureByteRange(unsigned)).toBe(false);
  });

  it('publishes conservative file, page, output, and rendering limits', () => {
    expect(PDF_REPAIR_LIMITS).toMatchObject({
      maxFileBytes: 75 * 1024 * 1024,
      maxPages: 200,
      maxOutputBytes: 150 * 1024 * 1024,
      maxVisualDifferencePercent: 0.1
    });
  });
});

describe('repair preservation helpers', () => {
  it('normalizes whitespace and Unicode compatibility forms', () => {
    expect(normalizeRepairText('  PDF\\n  repair\\tﬁle  ')).toBe('PDF repair file');
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

describe('repairPdfStructure service', () => {
  it('rebuilds a PDF and verifies page geometry, selectable text, pixels, and progress', async () => {
    const source = await createSourcePdf();
    const originalBytes = new Uint8Array(await source.arrayBuffer());
    const originalPage = createPage({ text: 'PRESERVED TEXT', shade: 255 });
    const rebuiltPage = createPage({ text: 'PRESERVED TEXT', shade: 255 });
    const original = createTask([originalPage]);
    const rebuilt = createTask([rebuiltPage]);
    const { repairPdfStructure } = await loadRepairService(original.task, rebuilt.task);
    const progress: string[] = [];

    const result = await repairPdfStructure(source, (value) => progress.push(value.phase));

    expect(result).toMatchObject({
      pageCount: 1,
      originalSize: source.size,
      maxVisualDifferencePercent: 0,
      searchableTextPreserved: true,
      verification: 'passed'
    });
    expect(result.repairedSize).toBe(result.bytes.byteLength);
    expect(progress).toEqual(['opening', 'rebuilding', 'verifying', 'verifying']);

    const reopened = await PDFDocument.load(result.bytes);
    const reopenedPage = reopened.getPage(0);
    expect(reopenedPage.getCropBox()).toMatchObject({
      x: 18,
      y: 24,
      width: 560,
      height: 730
    });
    expect(reopenedPage.getRotation().angle).toBe(90);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(originalBytes);

    expect(originalPage.cleanup).toHaveBeenCalledOnce();
    expect(rebuiltPage.cleanup).toHaveBeenCalledOnce();
    expect(original.task.destroy).toHaveBeenCalledOnce();
    expect(rebuilt.task.destroy).toHaveBeenCalledOnce();
  });

  it('cleans up the first page when acquiring its matching rebuilt page fails', async () => {
    const source = await createSourcePdf();
    const originalPage = createPage({ text: 'PRESERVED TEXT' });
    const rebuiltPage = createPage({ text: 'PRESERVED TEXT' });
    const original = createTask([originalPage]);
    const rebuilt = createTask([rebuiltPage]);
    rebuilt.document.getPage.mockRejectedValue(new Error('synthetic page retrieval failure'));
    const { repairPdfStructure } = await loadRepairService(original.task, rebuilt.task);

    await expect(repairPdfStructure(source)).rejects.toThrow('synthetic page retrieval failure');

    expect(originalPage.cleanup).toHaveBeenCalledOnce();
    expect(rebuiltPage.cleanup).not.toHaveBeenCalled();
    expect(original.task.destroy).toHaveBeenCalledOnce();
    expect(rebuilt.task.destroy).toHaveBeenCalledOnce();
  });

  it('cleans up both pages and loading tasks when rendering fails', async () => {
    const source = await createSourcePdf();
    const originalPage = createPage({ text: 'PRESERVED TEXT', failRender: true });
    const rebuiltPage = createPage({ text: 'PRESERVED TEXT' });
    const original = createTask([originalPage]);
    const rebuilt = createTask([rebuiltPage]);
    const { repairPdfStructure } = await loadRepairService(original.task, rebuilt.task);

    await expect(repairPdfStructure(source)).rejects.toThrow('Page 1');

    expect(originalPage.cleanup).toHaveBeenCalledOnce();
    expect(rebuiltPage.cleanup).toHaveBeenCalledOnce();
    expect(original.task.destroy).toHaveBeenCalledOnce();
    expect(rebuilt.task.destroy).toHaveBeenCalledOnce();
  });

  it('rejects changed searchable text and still releases both pages', async () => {
    const source = await createSourcePdf();
    const originalPage = createPage({ text: 'PRESERVED TEXT' });
    const rebuiltPage = createPage({ text: 'CHANGED TEXT' });
    const original = createTask([originalPage]);
    const rebuilt = createTask([rebuiltPage]);
    const { repairPdfStructure } = await loadRepairService(original.task, rebuilt.task);

    await expect(repairPdfStructure(source)).rejects.toThrow(
      'Page 1 searchable text changed during rebuilding'
    );

    expect(originalPage.cleanup).toHaveBeenCalledOnce();
    expect(rebuiltPage.cleanup).toHaveBeenCalledOnce();
    expect(original.task.destroy).toHaveBeenCalledOnce();
    expect(rebuilt.task.destroy).toHaveBeenCalledOnce();
  });

  it('rejects visible changes above the preservation threshold', async () => {
    const source = await createSourcePdf();
    const originalPage = createPage({ text: 'PRESERVED TEXT', shade: 255 });
    const rebuiltPage = createPage({ text: 'PRESERVED TEXT', shade: 0 });
    const original = createTask([originalPage]);
    const rebuilt = createTask([rebuiltPage]);
    const { repairPdfStructure } = await loadRepairService(original.task, rebuilt.task);

    await expect(repairPdfStructure(source)).rejects.toThrow(
      'visual content changed by 100%'
    );

    expect(originalPage.cleanup).toHaveBeenCalledOnce();
    expect(rebuiltPage.cleanup).toHaveBeenCalledOnce();
    expect(original.task.destroy).toHaveBeenCalledOnce();
    expect(rebuilt.task.destroy).toHaveBeenCalledOnce();
  });
});

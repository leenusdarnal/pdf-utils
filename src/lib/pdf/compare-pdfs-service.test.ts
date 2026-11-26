import { afterEach, describe, expect, it, vi } from 'vitest';

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
  text: string;
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

function createPage(options: FakePageOptions) {
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  const shade = options.shade ?? 255;

  return {
    getTextContent: vi.fn(async () => ({ items: [{ str: options.text }] })),
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

async function loadComparator(
  baselineFile: Blob,
  updatedFile: Blob,
  baselineTask: ReturnType<typeof createTask>['task'],
  updatedTask: ReturnType<typeof createTask>['task']
) {
  const tasks = new Map<Blob, ReturnType<typeof createTask>['task']>([
    [baselineFile, baselineTask],
    [updatedFile, updatedTask]
  ]);

  vi.doMock('./pdfjs-client', () => ({
    createPdfDocumentTask: vi.fn(async (file: Blob) => tasks.get(file))
  }));
  vi.stubGlobal('document', {
    createElement: vi.fn(() => createCanvas())
  });

  return await import('./compare-pdfs');
}

afterEach(() => {
  vi.doUnmock('./pdfjs-client');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('comparePdfFiles service', () => {
  it('compares normalized text and rendered pixels, reports page-size changes, additions, and progress', async () => {
    const baselineFile = new Blob(['baseline']);
    const updatedFile = new Blob(['updated']);
    const baselinePages = [
      createPage({ text: '  INVOICE 100\n ITEMS ', shade: 255 }),
      createPage({ text: 'TOTAL 100', shade: 255 }),
      createPage({ text: 'UNCHANGED PAGE', shade: 255 })
    ];
    const updatedPages = [
      createPage({ text: 'INVOICE 100 ITEMS', shade: 255 }),
      createPage({ text: 'TOTAL 110', width: 101, shade: 0 }),
      createPage({ text: 'UNCHANGED PAGE', shade: 0 }),
      createPage({ text: 'NEW FOURTH PAGE', shade: 255 })
    ];
    const baseline = createTask(baselinePages);
    const updated = createTask(updatedPages);
    const { comparePdfFiles } = await loadComparator(
      baselineFile,
      updatedFile,
      baseline.task,
      updated.task
    );
    const progress: Array<{ completedPages: number; totalPages: number; currentPage: number }> = [];

    const result = await comparePdfFiles(baselineFile, updatedFile, (value) => progress.push(value));

    expect(result).toMatchObject({
      baselinePageCount: 3,
      updatedPageCount: 4,
      comparedPages: 3,
      changedPages: 2,
      unchangedPages: 1,
      addedPages: 1,
      removedPages: 0,
      textChangedPages: 1,
      visualChangedPages: 2
    });
    expect(result.pages.map((page) => page.status)).toEqual([
      'unchanged',
      'changed',
      'changed',
      'added'
    ]);
    expect(result.pages[0].textChanged).toBe(false);
    expect(result.pages[0].visualDifferencePercent).toBe(0);
    expect(result.pages[1]).toMatchObject({
      textChanged: true,
      pageSizeChanged: true,
      visualDifferencePercent: 100,
      baselineTextPreview: 'TOTAL 100',
      updatedTextPreview: 'TOTAL 110'
    });
    expect(result.pages[2]).toMatchObject({
      textChanged: false,
      pageSizeChanged: false,
      visualDifferencePercent: 100
    });
    expect(progress.map((item) => item.completedPages)).toEqual([1, 2, 3, 4]);
    expect(progress.every((item) => item.totalPages === 4)).toBe(true);

    for (const page of [...baselinePages, ...updatedPages.slice(0, 3)]) {
      expect(page.cleanup).toHaveBeenCalledOnce();
    }
    expect(updatedPages[3].cleanup).not.toHaveBeenCalled();
    expect(baseline.task.destroy).toHaveBeenCalledOnce();
    expect(updated.task.destroy).toHaveBeenCalledOnce();
  });

  it('reports removed pages when the updated document is shorter', async () => {
    const baselineFile = new Blob(['baseline']);
    const updatedFile = new Blob(['updated']);
    const baselinePages = [
      createPage({ text: 'PAGE ONE' }),
      createPage({ text: 'PAGE TWO' }),
      createPage({ text: 'PAGE THREE' })
    ];
    const updatedPages = [
      createPage({ text: 'PAGE ONE' }),
      createPage({ text: 'PAGE TWO' })
    ];
    const baseline = createTask(baselinePages);
    const updated = createTask(updatedPages);
    const { comparePdfFiles } = await loadComparator(
      baselineFile,
      updatedFile,
      baseline.task,
      updated.task
    );

    const result = await comparePdfFiles(baselineFile, updatedFile);

    expect(result.removedPages).toBe(1);
    expect(result.addedPages).toBe(0);
    expect(result.pages[2]).toMatchObject({
      pageNumber: 3,
      status: 'removed',
      visualDifferencePercent: null
    });
    expect(baseline.task.destroy).toHaveBeenCalledOnce();
    expect(updated.task.destroy).toHaveBeenCalledOnce();
  });

  it('cleans up pages and both loading tasks when rendering fails', async () => {
    const baselineFile = new Blob(['baseline']);
    const updatedFile = new Blob(['updated']);
    const baselinePage = createPage({ text: 'PAGE', failRender: true });
    const updatedPage = createPage({ text: 'PAGE' });
    const baseline = createTask([baselinePage]);
    const updated = createTask([updatedPage]);
    const { comparePdfFiles } = await loadComparator(
      baselineFile,
      updatedFile,
      baseline.task,
      updated.task
    );

    await expect(comparePdfFiles(baselineFile, updatedFile)).rejects.toThrow(
      'Page 1 could not be compared: synthetic render failure'
    );
    expect(baselinePage.cleanup).toHaveBeenCalledOnce();
    expect(updatedPage.cleanup).toHaveBeenCalledOnce();
    expect(baseline.task.destroy).toHaveBeenCalledOnce();
    expect(updated.task.destroy).toHaveBeenCalledOnce();
  });

  it('cleans up the first page if fetching the matching page from the second PDF fails', async () => {
    const baselineFile = new Blob(['baseline']);
    const updatedFile = new Blob(['updated']);
    const baselinePage = createPage({ text: 'PAGE' });
    const baseline = createTask([baselinePage]);
    const updated = createTask([createPage({ text: 'PAGE' })]);
    updated.document.getPage.mockRejectedValue(new Error('synthetic page retrieval failure'));
    const { comparePdfFiles } = await loadComparator(
      baselineFile,
      updatedFile,
      baseline.task,
      updated.task
    );

    await expect(comparePdfFiles(baselineFile, updatedFile)).rejects.toThrow(
      'The PDFs could not be compared. They may be damaged, encrypted, or unsupported. synthetic page retrieval failure'
    );
    expect(baselinePage.cleanup).toHaveBeenCalledOnce();
    expect(baseline.task.destroy).toHaveBeenCalledOnce();
    expect(updated.task.destroy).toHaveBeenCalledOnce();
  });

  it('rejects empty input before opening either PDF', async () => {
    const emptyFile = new Blob([]);
    const updatedFile = new Blob(['updated']);
    const baseline = createTask([createPage({ text: 'PAGE' })]);
    const updated = createTask([createPage({ text: 'PAGE' })]);
    const { comparePdfFiles } = await loadComparator(
      emptyFile,
      updatedFile,
      baseline.task,
      updated.task
    );

    await expect(comparePdfFiles(emptyFile, updatedFile)).rejects.toThrow(
      'Choose a non-empty baseline PDF.'
    );
    expect(baseline.task.destroy).not.toHaveBeenCalled();
    expect(updated.task.destroy).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergePdfFiles } from './merge-pdfs';

async function createPdf(pageSizes: Array<[number, number]>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const [width, height] of pageSizes) document.addPage([width, height]);
  return document.save();
}

describe('mergePdfFiles', () => {
  it('merges every page in the supplied file order', async () => {
    const first = await createPdf([
      [100, 200],
      [110, 210]
    ]);
    const second = await createPdf([[300, 400]]);

    const mergedBytes = await mergePdfFiles([
      new Blob([first as BlobPart], { type: 'application/pdf' }),
      new Blob([second as BlobPart], { type: 'application/pdf' })
    ]);
    const merged = await PDFDocument.load(mergedBytes);
    const pages = merged.getPages();

    expect(pages).toHaveLength(3);
    expect(pages.map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [100, 200],
      [110, 210],
      [300, 400]
    ]);
  });

  it('rejects an empty or single-file merge', async () => {
    await expect(mergePdfFiles([])).rejects.toThrow('at least two PDF files');
    const onePage = await createPdf([[100, 200]]);
    await expect(
      mergePdfFiles([new Blob([onePage as BlobPart], { type: 'application/pdf' })])
    ).rejects.toThrow('at least two PDF files');
  });

  it('reports an unreadable source file without returning partial output', async () => {
    const first = await createPdf([[100, 200]]);
    await expect(
      mergePdfFiles([
        new Blob([first as BlobPart], { type: 'application/pdf' }),
        new Blob(['not a PDF'], { type: 'application/pdf' })
      ])
    ).rejects.toThrow('PDF 2 could not be opened');
  });
});

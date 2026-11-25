import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  getPdfPageCount,
  parsePageRange,
  splitPdfByRanges
} from './split-pdf';

async function createPdf(pageSizes: Array<[number, number]>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const [width, height] of pageSizes) document.addPage([width, height]);
  return document.save();
}

describe('parsePageRange', () => {
  it('parses individual pages and ascending ranges in the entered order', () => {
    expect(parsePageRange('1-3, 5, 7-8', 8)).toEqual([1, 2, 3, 5, 7, 8]);
    expect(parsePageRange('4, 2-3, 1', 4)).toEqual([4, 2, 3, 1]);
  });

  it('rejects empty, malformed, descending, and out-of-bounds ranges', () => {
    expect(() => parsePageRange('', 4)).toThrow('Enter a page range');
    expect(() => parsePageRange('1,,2', 4)).toThrow('Use page numbers');
    expect(() => parsePageRange('3-2', 4)).toThrow('ascending');
    expect(() => parsePageRange('0', 4)).toThrow('between 1 and 4');
    expect(() => parsePageRange('1-5', 4)).toThrow('between 1 and 4');
  });

  it('rejects a page repeated within one output range', () => {
    expect(() => parsePageRange('1-3, 3', 4)).toThrow('appears more than once');
  });
});

describe('splitPdfByRanges', () => {
  it('creates independent PDFs for each range and preserves page order and size', async () => {
    const sourceBytes = await createPdf([
      [100, 200],
      [110, 210],
      [300, 400],
      [310, 410]
    ]);
    const source = new Blob([sourceBytes as BlobPart], { type: 'application/pdf' });

    expect(await getPdfPageCount(source)).toBe(4);

    const outputs = await splitPdfByRanges(source, ['1-2', '4, 3']);
    expect(outputs).toHaveLength(2);
    expect(outputs.map((output) => output.pageNumbers)).toEqual([[1, 2], [4, 3]]);

    const first = await PDFDocument.load(outputs[0].bytes);
    const second = await PDFDocument.load(outputs[1].bytes);
    expect(first.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [100, 200],
      [110, 210]
    ]);
    expect(second.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [310, 410],
      [300, 400]
    ]);
  });

  it('requires at least one range and reports malformed source PDFs', async () => {
    const valid = await createPdf([[100, 200]]);
    const source = new Blob([valid as BlobPart], { type: 'application/pdf' });
    await expect(splitPdfByRanges(source, [])).rejects.toThrow('at least one output range');
    await expect(
      splitPdfByRanges(new Blob(['not a PDF']), ['1'])
    ).rejects.toThrow('could not be opened');
  });
});

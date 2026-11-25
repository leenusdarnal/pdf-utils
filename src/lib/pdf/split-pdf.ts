import { PDFDocument } from 'pdf-lib';

export interface SplitPdfOutput {
  range: string;
  pageNumbers: number[];
  bytes: Uint8Array;
}

/**
 * Parse a page selection such as "1-3, 5, 7-8".
 * Returned page numbers are one-based and retain the order typed by the user.
 */
export function parsePageRange(input: string, totalPages: number): number[] {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error('The PDF does not contain any pages.');
  }

  const value = input.trim();
  if (!value) {
    throw new Error('Enter a page range, for example 1-3 or 1, 3-5.');
  }

  const tokens = value.split(',');
  const pages: number[] = [];
  const seen = new Set<number>();

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) {
      throw new Error('Use page numbers and ascending ranges, for example 1-3, 5.');
    }

    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
      throw new Error('Page numbers must be valid whole numbers.');
    }
    if (first < 1 || last < 1 || first > totalPages || last > totalPages) {
      throw new Error('Page numbers must be between 1 and ' + totalPages + '.');
    }
    if (last < first) {
      throw new Error('Page ranges must be ascending. Check ' + token + '.');
    }

    for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
      if (seen.has(pageNumber)) {
        throw new Error('Page ' + pageNumber + ' appears more than once in this range.');
      }
      seen.add(pageNumber);
      pages.push(pageNumber);
    }
  }

  return pages;
}

async function loadPdf(source: Blob): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(new Uint8Array(await source.arrayBuffer()));
  } catch {
    throw new Error('This PDF could not be opened. It may be damaged or password-protected.');
  }
}

export async function getPdfPageCount(source: Blob): Promise<number> {
  const document = await loadPdf(source);
  const count = document.getPageCount();
  if (count < 1) throw new Error('The PDF does not contain any pages.');
  return count;
}

/**
 * Create one new PDF for each supplied page-range expression.
 * Source PDFs remain untouched and are processed locally in the browser.
 */
export async function splitPdfByRanges(
  source: Blob,
  rangeExpressions: readonly string[]
): Promise<SplitPdfOutput[]> {
  if (rangeExpressions.length === 0) {
    throw new Error('Add at least one output range before splitting the PDF.');
  }

  const sourceDocument = await loadPdf(source);
  const totalPages = sourceDocument.getPageCount();
  if (totalPages < 1) throw new Error('The PDF does not contain any pages.');

  const parsedRanges = rangeExpressions.map((range) => ({
    range: range.trim(),
    pageNumbers: parsePageRange(range, totalPages)
  }));

  const outputs: SplitPdfOutput[] = [];
  for (const range of parsedRanges) {
    const outputDocument = await PDFDocument.create();
    const copiedPages = await outputDocument.copyPages(
      sourceDocument,
      range.pageNumbers.map((pageNumber) => pageNumber - 1)
    );
    for (const page of copiedPages) outputDocument.addPage(page);

    outputs.push({
      range: range.range,
      pageNumbers: range.pageNumbers,
      bytes: await outputDocument.save()
    });
  }

  return outputs;
}

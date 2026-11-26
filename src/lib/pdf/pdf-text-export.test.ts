import { describe, expect, it } from 'vitest';
import { formatPdfTextExport, getTextExportFileName, normalizePdfPageText } from './pdf-text-export';

describe('PDF text export formatting', () => {
  it('normalizes whitespace without collapsing meaningful line breaks', () => {
    expect(normalizePdfPageText('  Hello\\tworld  \\n\\n\\n next  ')).toBe('Hello world\\n\\n next');
  });

  it('sorts pages and labels page boundaries in plain text', () => {
    expect(formatPdfTextExport([
      { pageNumber: 2, text: 'Second page' },
      { pageNumber: 1, text: 'First page' }
    ], 'txt')).toBe('--- Page 1 ---\\n\\nFirst page\\n\\n--- Page 2 ---\\n\\nSecond page\\n');
  });

  it('writes a Markdown title and page headings', () => {
    expect(formatPdfTextExport([{ pageNumber: 3, text: 'Body' }], 'md', 'A # Title'))
      .toBe('# A Title\\n\\n## Page 3\\n\\nBody\\n');
  });

  it('creates safe output filenames for both formats', () => {
    expect(getTextExportFileName('my/report.pdf', 'txt')).toBe('my-report.txt');
    expect(getTextExportFileName('  ', 'md')).toBe('document.md');
  });
});

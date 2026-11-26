export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
}

export type TextExportFormat = 'txt' | 'md';

export function normalizePdfPageText(text: string): string {
  return text
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatPdfTextExport(
  pages: ExtractedPdfPage[],
  format: TextExportFormat,
  title = 'Extracted PDF text'
): string {
  const sortedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  if (format === 'md') {
    const safeTitle = title.replace(/[\r\n#]+/g, ' ').trim() || 'Extracted PDF text';
    return [
      '# ' + safeTitle,
      '',
      ...sortedPages.flatMap((page) => [
        '## Page ' + page.pageNumber,
        '',
        page.text.trim(),
        ''
      ])
    ].join('\n').trimEnd() + '\n';
  }

  return sortedPages
    .map((page) => '--- Page ' + page.pageNumber + ' ---\n\n' + page.text.trim())
    .join('\n\n') + '\n';
}

export function getTextExportFileName(sourceName: string, format: TextExportFormat): string {
  const baseName = sourceName.replace(/\.pdf$/i, '').trim() || 'document';
  const safeName = baseName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 120) || 'document';
  return safeName + (format === 'md' ? '.md' : '.txt');
}

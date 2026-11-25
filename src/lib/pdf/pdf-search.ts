export interface PdfTextMatch {
  pageNumber: number;
  index: number;
  snippet: string;
  matchStart: number;
  matchText: string;
}

/**
 * Finds case-insensitive literal matches in extracted page text.
 * Snippets are plain text; the UI renders the matched span as a safe <mark>.
 */
export function findTextMatches(
  text: string,
  query: string,
  pageNumber: number,
  maxResults = 100,
  contextLength = 48
): PdfTextMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery || !text || !Number.isFinite(pageNumber) || pageNumber < 1 || maxResults < 1) {
    return [];
  }

  const normalizedText = text.toLocaleLowerCase();
  const matches: PdfTextMatch[] = [];
  let fromIndex = 0;

  while (matches.length < Math.floor(maxResults)) {
    const index = normalizedText.indexOf(normalizedQuery, fromIndex);
    if (index < 0) break;

    const start = Math.max(0, index - contextLength);
    const end = Math.min(text.length, index + normalizedQuery.length + contextLength);
    matches.push({
      pageNumber: Math.floor(pageNumber),
      index,
      snippet: text.slice(start, end),
      matchStart: index - start,
      matchText: text.slice(index, index + normalizedQuery.length)
    });
    fromIndex = index + Math.max(1, normalizedQuery.length);
  }

  return matches;
}

import { PDFDocument } from 'pdf-lib';

/**
 * Combines PDFs in the order supplied. The source files are read locally and
 * are never uploaded. Page content, size, and rotation are copied into a new
 * document; the source documents are left unchanged.
 */
export async function mergePdfFiles(sources: readonly Blob[]): Promise<Uint8Array> {
  if (sources.length < 2) {
    throw new Error('Choose at least two PDF files to merge.');
  }

  const output = await PDFDocument.create();
  let copiedPageCount = 0;

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const sourceFile = sources[sourceIndex];

    let sourceDocument: PDFDocument;
    try {
      const bytes = new Uint8Array(await sourceFile.arrayBuffer());
      sourceDocument = await PDFDocument.load(bytes);
    } catch {
      throw new Error(
        'PDF ' + (sourceIndex + 1) + ' could not be opened. It may be damaged or password-protected.'
      );
    }

    const sourcePageIndices = sourceDocument.getPageIndices();
    if (sourcePageIndices.length === 0) {
      throw new Error('PDF ' + (sourceIndex + 1) + ' does not contain any pages.');
    }

    const copiedPages = await output.copyPages(sourceDocument, sourcePageIndices);
    for (const page of copiedPages) {
      output.addPage(page);
      copiedPageCount += 1;
    }
  }

  if (copiedPageCount === 0) {
    throw new Error('No pages were available to merge.');
  }

  return output.save();
}

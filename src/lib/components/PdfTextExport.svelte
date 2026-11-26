<script lang="ts">
  import { onDestroy } from 'svelte';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import { createPdfDocumentTask } from '$lib/pdf/pdfjs-client';
  import { formatPdfTextExport, getTextExportFileName, normalizePdfPageText, type TextExportFormat } from '$lib/pdf/pdf-text-export';

  export let onClose: () => void;

  const MAX_FILE_BYTES = 150 * 1024 * 1024;
  const MAX_PAGES = 500;
  let fileInput: HTMLInputElement;
  let sourceFile: File | null = null;
  let format: TextExportFormat = 'txt';
  let isExtracting = false;
  let progress = 0;
  let extractedText = '';
  let outputName = '';
  let errorMessage = '';
  let statusMessage = 'Choose a text-based PDF to export its text locally.';
  let previewUrl: string | null = null;

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  onDestroy(clearPreview);

  async function loadFile(file?: File) {
    if (!file || isExtracting) return;
    sourceFile = null;
    extractedText = '';
    outputName = '';
    errorMessage = '';
    progress = 0;
    clearPreview();

    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('This file exceeds the 150 MB limit.');
      if (!(await hasPdfHeader(file))) throw new Error('This file does not look like a valid PDF.');
      sourceFile = file;
      statusMessage = 'PDF selected. Extract all pages to create a text export.';
    } catch (error) {
      sourceFile = null;
      errorMessage = error instanceof Error ? error.message : 'The file could not be read.';
      statusMessage = 'Unable to use this file.';
    }
  }

  function handlePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    void loadFile(file);
  }

  async function extractText() {
    if (!sourceFile || isExtracting) return;
    isExtracting = true;
    progress = 0;
    errorMessage = '';
    extractedText = '';
    clearPreview();
    let task: Awaited<ReturnType<typeof createPdfDocumentTask>> | null = null;
    try {
      task = await createPdfDocumentTask(sourceFile);
      const pdf = await task.promise;
      if (pdf.numPages > MAX_PAGES) throw new Error('This PDF exceeds the 500-page extraction limit.');
      const pages: { pageNumber: number; text: string }[] = [];
      let characters = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const lines: string[] = [];
          for (const item of content.items) {
            if (!('str' in item)) continue;
            const text = item.str.trim();
            if (text) lines.push(text + (item.hasEOL ? '\n' : ' '));
          }
          const text = normalizePdfPageText(lines.join(''));
          characters += text.length;
          if (characters > 20_000_000) throw new Error('Extracted text exceeds the 20-million-character safety limit.');
          pages.push({ pageNumber, text });
        } finally {
          page.cleanup();
        }
        progress = Math.round((pageNumber / pdf.numPages) * 100);
        statusMessage = 'Extracting page ' + pageNumber + ' of ' + pdf.numPages + '…';
      }
      if (!pages.some((page) => page.text)) {
        throw new Error('No selectable text was found. This may be a scanned PDF; OCR is not included in this tool.');
      }
      extractedText = formatPdfTextExport(pages, format, sourceFile.name.replace(/\.pdf$/i, ''));
      outputName = getTextExportFileName(sourceFile.name, format);
      const blob = new Blob([extractedText], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
      previewUrl = URL.createObjectURL(blob);
      statusMessage = 'Text extracted from ' + pages.length + ' pages. Ready to download.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Text extraction failed for this PDF.';
      statusMessage = 'Extraction failed.';
    } finally {
      if (task) await task.destroy().catch(() => undefined);
      isExtracting = false;
    }
  }

  function downloadExport() {
    if (!previewUrl || !outputName) return;
    const link = document.createElement('a');
    link.href = previewUrl;
    link.download = outputName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    statusMessage = 'Download started: ' + outputName;
  }

  function changeFormat(nextFormat: TextExportFormat) {
    format = nextFormat;
    if (sourceFile && extractedText) {
      // Re-formatting from the current text preview would lose page boundaries.
      // Ask the user to re-run extraction so headings and filename match the chosen format.
      extractedText = '';
      outputName = '';
      clearPreview();
      statusMessage = 'Format changed. Extract again to create the new format.';
    }
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="PDF text export workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">PDF to Text & Markdown</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Extract selectable text locally, with page boundaries preserved. Scanned-page OCR is not included.</p>
    </div>
    <button type="button" class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted hover:border-brand-300 hover:bg-brand-50" onclick={onClose}>← Back to tools</button>
  </header>

  <div class="space-y-5 p-6 max-[600px]:p-4">
    <div class="flex flex-wrap items-center gap-3">
      <input bind:this={fileInput} id="pdf-text-export-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
      <button type="button" class="rounded-lg border border-line bg-surface px-4 py-2.5 text-[11px] font-semibold text-ink hover:border-brand-300" disabled={isExtracting} onclick={() => fileInput?.click()}>{sourceFile ? 'Change PDF' : 'Choose PDF'}</button>
      {#if sourceFile}<span class="text-[11px] text-muted">{sourceFile.name} · {(sourceFile.size / 1024 / 1024).toFixed(1)} MB</span>{/if}
    </div>

    <div class="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-canvas p-4">
      <fieldset class="flex flex-wrap items-center gap-3">
        <legend class="mb-2 text-[11px] font-semibold text-ink">Export format</legend>
        <label class="flex items-center gap-2 text-[11px] text-muted"><input type="radio" name="pdf-text-format" checked={format === 'txt'} onchange={() => changeFormat('txt')} /> Plain text (.txt)</label>
        <label class="flex items-center gap-2 text-[11px] text-muted"><input type="radio" name="pdf-text-format" checked={format === 'md'} onchange={() => changeFormat('md')} /> Markdown (.md)</label>
      </fieldset>
      <button type="button" class="ml-auto rounded-lg bg-brand-700 px-4 py-2.5 text-[11px] font-bold text-white hover:bg-brand-800 disabled:opacity-50" disabled={!sourceFile || isExtracting} onclick={extractText}>{isExtracting ? 'Extracting…' : 'Extract text'}</button>
    </div>

    {#if isExtracting}
      <div class="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><div class="h-full bg-brand-600 transition-all" style="width: {progress}%"></div></div>
    {/if}
    <p class="text-[11px] text-muted" role="status">{statusMessage}</p>
    {#if errorMessage}<p class="rounded-lg border border-danger-200 bg-danger-50 p-3 text-[11px] text-danger-700" role="alert">{errorMessage}</p>{/if}

    {#if extractedText}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-[13px] font-bold text-ink">Extraction preview</h2><p class="text-[10px] text-muted">{extractedText.length.toLocaleString()} characters · page separators included</p></div>
        <button type="button" class="rounded-lg bg-brand-700 px-4 py-2.5 text-[11px] font-bold text-white hover:bg-brand-800" onclick={downloadExport}>Download {format.toUpperCase()}</button>
      </div>
      <pre class="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-canvas p-4 text-[11px] leading-[1.7] text-ink">{extractedText.slice(0, 100_000)}{#if extractedText.length > 100_000}\n\n[Preview limited to the first 100,000 characters. The full export will be downloaded.]{/if}</pre>
    {/if}
    <p class="text-[10px] leading-[1.6] text-muted">Text order follows PDF.js extraction order and may not match complex multi-column layouts. Images, tables, and page styling are not reconstructed. All processing stays in this browser tab.</p>
  </div>
</section>

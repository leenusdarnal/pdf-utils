<script lang="ts">
  import { repairPdfStructure, type PdfRepairProgress, type PdfRepairResult } from '$lib/pdf/repair-pdf';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';

  export let onClose: () => void;

  const MAX_FILE_BYTES = 75 * 1024 * 1024;
  let fileInput: HTMLInputElement;
  let sourceFile: File | null = null;
  let outputBlob: Blob | null = null;
  let outputFileName = '';
  let result: PdfRepairResult | null = null;
  let isRepairing = false;
  let progress = 0;
  let progressLabel = '';
  let statusMessage = 'Choose a PDF to check whether its structure can be safely rebuilt.';
  let errorMessage = '';

  function formatSize(bytes: number): string {
    if (bytes < 1_048_576) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / 1_048_576).toFixed(2) + ' MB';
  }

  function getOutputName(name: string): string {
    const base = name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
    return (base || 'document').slice(0, 100) + '-repaired.pdf';
  }

  async function loadFile(file?: File) {
    if (!file || isRepairing) return;
    sourceFile = null;
    outputBlob = null;
    outputFileName = '';
    result = null;
    errorMessage = '';
    progress = 0;
    progressLabel = '';

    try {
      if (file.size === 0) throw new Error('Choose a non-empty PDF file.');
      if (file.size > MAX_FILE_BYTES) throw new Error('This tool supports files up to 75 MB.');
      if (!(await hasPdfHeader(file))) throw new Error('This file does not contain a valid PDF header.');
      sourceFile = file;
      statusMessage = 'PDF selected. Start a safe structural rebuild and verification.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The selected file could not be read.';
      statusMessage = 'Unable to use this file.';
    }
  }

  function handlePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    void loadFile(file);
  }

  async function repair() {
    if (!sourceFile || isRepairing) return;
    isRepairing = true;
    outputBlob = null;
    outputFileName = '';
    result = null;
    errorMessage = '';
    progress = 0;
    progressLabel = 'Opening original PDF…';
    statusMessage = 'Checking the document locally. The original file will not be changed.';

    try {
      const repaired = await repairPdfStructure(sourceFile, (details: PdfRepairProgress) => {
        if (details.phase === 'opening') {
          progressLabel = 'Opening and inspecting PDF…';
          statusMessage = 'Checking the source structure…';
          return;
        }
        if (details.phase === 'rebuilding') {
          progressLabel = 'Rebuilding PDF structure…';
          statusMessage = 'Writing a new PDF with a standard cross-reference table…';
          return;
        }
        progress = details.totalPages
          ? Math.round((details.completedPages / details.totalPages) * 100)
          : 0;
        progressLabel = 'Verifying page ' + (details.currentPage ?? details.completedPages) + ' of ' + details.totalPages;
        statusMessage = 'Reopening the rebuilt file and checking page text, dimensions, and visual appearance…';
      });

      result = repaired;
      outputBlob = new Blob([repaired.bytes as BlobPart], { type: 'application/pdf' });
      outputFileName = getOutputName(sourceFile.name);
      progress = 100;
      progressLabel = 'Verification passed';
      statusMessage = 'The rebuilt copy passed the supported page checks. This does not prove complete document-feature preservation.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The PDF could not be safely rebuilt.';
      statusMessage = 'No repaired file was created. Your original PDF remains unchanged.';
    } finally {
      isRepairing = false;
    }
  }

  function downloadRepaired() {
    if (!outputBlob || !outputFileName || !result) return;
    const url = URL.createObjectURL(outputBlob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = outputFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
    statusMessage = 'Download started: ' + outputFileName;
  }

  function clearFile() {
    if (isRepairing) return;
    sourceFile = null;
    outputBlob = null;
    outputFileName = '';
    result = null;
    errorMessage = '';
    progress = 0;
    progressLabel = '';
    statusMessage = 'Choose a PDF to check whether its structure can be safely rebuilt.';
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="PDF repair workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE · QUALITY</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">Repair PDF</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Rebuild supported, parseable PDF structure and compare page text, geometry, and a bounded rendering. This is not general recovery or a guarantee that every document feature is preserved.</p>
    </div>
    <button type="button" class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted hover:border-brand-300 hover:bg-brand-50" onclick={onClose}>← Back to tools</button>
  </header>

  <div class="space-y-5 p-6 max-[600px]:p-4">
    <div class="rounded-xl border border-dashed border-brand-300 bg-brand-50/50 p-5 text-center">
      <input bind:this={fileInput} id="repair-pdf-input" class="sr-only" type="file" accept="application/pdf,.pdf" disabled={isRepairing} onchange={handlePick} />
      <div class="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-surface text-[12px] font-bold text-brand-700">PDF</div>
      <p class="mb-1 text-[12px] font-bold text-ink">{sourceFile ? sourceFile.name : 'Choose a PDF file'}</p>
      <p class="mb-3 text-[10px] text-muted">{sourceFile ? formatSize(sourceFile.size) : 'Maximum 75 MB · up to 200 pages'}</p>
      <button type="button" class="rounded-lg border border-line bg-surface px-4 py-2 text-[11px] font-semibold text-ink hover:border-brand-300 disabled:opacity-50" disabled={isRepairing} onclick={() => fileInput?.click()}>{sourceFile ? 'Change PDF' : 'Choose PDF'}</button>
    </div>

    <div class="rounded-xl border border-line bg-surface-muted p-4">
      <h2 class="mb-2 text-[12px] font-bold text-ink">What this tool can safely attempt</h2>
      <ul class="mb-0 space-y-1.5 pl-4 text-[10px] leading-5 text-muted">
        <li>Rebuild the PDF cross-reference table and trailer using a local PDF parser.</li>
        <li>Reopen the rebuilt file and compare page count, dimensions, rotation, selectable text, and rendered appearance.</li>
        <li>Conservatively refuse files containing a signature byte-range marker. This check is not cryptographic signature validation.</li>
        <li>These checks do not verify links, bookmarks, forms, attachments, metadata, or accessibility structure.</li>
      </ul>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="mb-0 min-w-0 flex-1 text-[10px] leading-5 text-muted" role="status" aria-live="polite">{statusMessage}</p>
      <div class="flex gap-2">
        <button type="button" class="rounded-lg border border-line bg-surface px-4 py-2.5 text-[11px] font-semibold text-muted hover:border-brand-300 disabled:opacity-50" disabled={isRepairing || !sourceFile} onclick={clearFile}>Clear</button>
        <button type="button" class="rounded-lg bg-brand-700 px-4 py-2.5 text-[11px] font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={!sourceFile || isRepairing} onclick={repair}>{isRepairing ? 'Checking…' : 'Repair & verify'}</button>
      </div>
    </div>

    {#if isRepairing}
      <div>
        <div class="mb-1 flex items-center justify-between text-[10px] text-muted"><span>{progressLabel}</span><span>{progress}%</span></div>
        <div class="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="PDF repair verification progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
          <div class="h-full bg-brand-600 transition-[width]" style={'width:' + progress + '%'}></div>
        </div>
      </div>
    {/if}

    {#if errorMessage}
      <p class="rounded-lg border border-danger-200 bg-danger-50 p-3 text-[11px] leading-5 text-danger-700" role="alert">{errorMessage}</p>
    {/if}

    {#if result && outputBlob}
      <div class="space-y-3 rounded-xl border border-line bg-surface p-4" aria-label="PDF repair result">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="mb-1 text-[13px] font-bold text-ink">Rebuilt copy verified</h2>
            <p class="mb-0 text-[10px] text-muted">The original remains unchanged.</p>
          </div>
          <span class="rounded-full border border-success-200 bg-success-50 px-3 py-1 text-[9px] font-semibold text-success-700">Checks passed</span>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-lg bg-surface-muted p-3"><p class="mb-1 text-[9px] text-muted">Pages</p><p class="mb-0 text-[16px] font-bold text-ink">{result.pageCount}</p></div>
          <div class="rounded-lg bg-surface-muted p-3"><p class="mb-1 text-[9px] text-muted">Original size</p><p class="mb-0 text-[16px] font-bold text-ink">{formatSize(result.originalSize)}</p></div>
          <div class="rounded-lg bg-surface-muted p-3"><p class="mb-1 text-[9px] text-muted">Rebuilt size</p><p class="mb-0 text-[16px] font-bold text-ink">{formatSize(result.repairedSize)}</p></div>
          <div class="rounded-lg bg-surface-muted p-3"><p class="mb-1 text-[9px] text-muted">Max visual difference</p><p class="mb-0 text-[16px] font-bold text-ink">{result.maxVisualDifferencePercent.toFixed(3)}%</p></div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p class="mb-0 text-[10px] text-muted">Page text, geometry, and rendered appearance matched within the verification threshold.</p>
          <button type="button" class="rounded-lg bg-brand-700 px-4 py-2.5 text-[11px] font-bold text-white hover:bg-brand-800" onclick={downloadRepaired}>Download repaired PDF</button>
        </div>
      </div>
    {/if}
  </div>

  <footer class="border-t border-line px-6 py-3 text-[10px] leading-5 text-muted max-[600px]:px-4">
    This is conservative structural rebuilding, not general recovery of missing or corrupted content. PDFs that cannot be parsed by the supported engine, encrypted files, signed PDFs, and files whose text or rendered pages change are rejected. Rewriting may not preserve every advanced feature such as bookmarks, attachments, accessibility tags, or interactive objects; keep the original.
  </footer>
</section>

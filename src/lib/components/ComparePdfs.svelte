<script lang="ts">
  import { comparePdfFiles, type PdfComparisonProgress, type PdfComparisonResult, type PdfPageComparison } from '$lib/pdf/compare-pdfs';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';

  export let onClose: () => void;

  const MAX_FILE_BYTES = 150 * 1024 * 1024;
  let baselineInput: HTMLInputElement;
  let updatedInput: HTMLInputElement;
  let baselineFile: File | null = null;
  let updatedFile: File | null = null;
  let isComparing = false;
  let progress = 0;
  let progressLabel = '';
  let result: PdfComparisonResult | null = null;
  let errorMessage = '';
  let statusMessage = 'Choose a baseline PDF and an updated PDF to compare them locally.';

  function formatSize(bytes: number): string {
    return bytes < 1_048_576
      ? Math.max(1, Math.round(bytes / 1024)) + ' KB'
      : (bytes / 1_048_576).toFixed(2) + ' MB';
  }

  async function handlePick(which: 'baseline' | 'updated', event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || isComparing) return;

    errorMessage = '';
    result = null;
    progress = 0;
    try {
      if (file.size === 0) throw new Error('Choose a non-empty PDF file.');
      if (file.size > MAX_FILE_BYTES) throw new Error('Each PDF must be 150 MB or smaller.');
      if (!(await hasPdfHeader(file))) throw new Error('This file does not look like a valid PDF.');
      if (which === 'baseline') baselineFile = file;
      else updatedFile = file;

      statusMessage = baselineFile && updatedFile
        ? 'Both PDFs are ready. Start the comparison when you are ready.'
        : 'PDF selected. Choose the other document to continue.';
    } catch (error) {
      if (which === 'baseline') baselineFile = null;
      else updatedFile = null;
      errorMessage = error instanceof Error ? error.message : 'The selected file could not be read.';
      statusMessage = 'Unable to use this file.';
    }
  }

  async function runComparison() {
    if (!baselineFile || !updatedFile || isComparing) return;
    isComparing = true;
    result = null;
    errorMessage = '';
    progress = 0;
    progressLabel = 'Preparing documents…';
    statusMessage = 'Comparing both PDFs in this browser…';

    try {
      const comparison = await comparePdfFiles(
        baselineFile,
        updatedFile,
        (details: PdfComparisonProgress) => {
          progress = Math.round((details.completedPages / details.totalPages) * 100);
          progressLabel = 'Comparing page ' + details.currentPage + ' of ' + details.totalPages;
          statusMessage = progressLabel + '…';
        }
      );
      result = comparison;
      progress = 100;
      progressLabel = 'Comparison complete';
      statusMessage =
        'Comparison complete. ' + comparison.changedPages + ' changed, ' +
        comparison.unchangedPages + ' unchanged, ' + comparison.addedPages +
        ' added, and ' + comparison.removedPages + ' removed pages.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'PDF comparison failed.';
      statusMessage = 'Comparison failed.';
    } finally {
      isComparing = false;
    }
  }

  function statusLabel(page: PdfPageComparison): string {
    switch (page.status) {
      case 'unchanged': return 'No detected change';
      case 'changed': return 'Changed';
      case 'added': return 'Added in updated PDF';
      case 'removed': return 'Removed from updated PDF';
    }
  }

  function visualLabel(page: PdfPageComparison): string {
    if (page.visualDifferencePercent === null) return 'Not paired';
    if (page.visualDifferencePercent === 0) return '0% pixel difference';
    return page.visualDifferencePercent.toFixed(2) + '% pixels differ';
  }

  function resetFiles() {
    if (isComparing) return;
    baselineFile = null;
    updatedFile = null;
    result = null;
    errorMessage = '';
    progress = 0;
    progressLabel = '';
    statusMessage = 'Choose a baseline PDF and an updated PDF to compare them locally.';
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="PDF comparison workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE · QUALITY</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">Compare PDFs</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Find page-level text and visual differences without uploading either file.</p>
    </div>
    <button type="button" class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted hover:border-brand-300 hover:bg-brand-50" onclick={onClose}>← Back to tools</button>
  </header>

  <div class="space-y-5 p-6 max-[600px]:p-4">
    <div class="grid gap-4 md:grid-cols-2">
      <div class="rounded-xl border border-line bg-canvas p-4">
        <label class="mb-2 block text-[11px] font-semibold text-ink" for="compare-baseline-input">Baseline PDF</label>
        <input bind:this={baselineInput} id="compare-baseline-input" class="sr-only" type="file" accept="application/pdf,.pdf" disabled={isComparing} onchange={(event) => handlePick('baseline', event)} />
        <button type="button" class="flex min-h-[90px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-[11px] font-semibold text-ink hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50" disabled={isComparing} onclick={() => baselineInput?.click()}>
          <span class="mb-1 text-brand-600">{baselineFile ? 'Change baseline' : 'Choose original PDF'}</span>
          <span class="max-w-full truncate text-[10px] font-normal text-muted">{baselineFile ? baselineFile.name : 'Select the earlier or original version'}</span>
        </button>
        {#if baselineFile}
          <p class="mb-0 mt-2 text-[10px] text-muted">{formatSize(baselineFile.size)}</p>
        {/if}
      </div>

      <div class="rounded-xl border border-line bg-canvas p-4">
        <label class="mb-2 block text-[11px] font-semibold text-ink" for="compare-updated-input">Updated PDF</label>
        <input bind:this={updatedInput} id="compare-updated-input" class="sr-only" type="file" accept="application/pdf,.pdf" disabled={isComparing} onchange={(event) => handlePick('updated', event)} />
        <button type="button" class="flex min-h-[90px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-[11px] font-semibold text-ink hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50" disabled={isComparing} onclick={() => updatedInput?.click()}>
          <span class="mb-1 text-brand-600">{updatedFile ? 'Change updated PDF' : 'Choose revised PDF'}</span>
          <span class="max-w-full truncate text-[10px] font-normal text-muted">{updatedFile ? updatedFile.name : 'Select the newer or revised version'}</span>
        </button>
        {#if updatedFile}
          <p class="mb-0 mt-2 text-[10px] text-muted">{formatSize(updatedFile.size)}</p>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-muted p-4">
      <div class="min-w-0 text-[10px] leading-5 text-muted">
        <p class="mb-0 font-semibold text-ink">Browser-local comparison</p>
        <p class="mb-0">Each file: up to 150 MB and 300 pages. Pages are paired by page number.</p>
      </div>
      <div class="ml-auto flex flex-wrap gap-2">
        <button type="button" class="rounded-lg border border-line bg-surface px-4 py-2.5 text-[11px] font-semibold text-muted hover:border-brand-300 disabled:opacity-50" disabled={isComparing || (!baselineFile && !updatedFile)} onclick={resetFiles}>Clear</button>
        <button type="button" class="rounded-lg bg-brand-700 px-4 py-2.5 text-[11px] font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={!baselineFile || !updatedFile || isComparing} onclick={runComparison}>{isComparing ? 'Comparing…' : 'Compare PDFs'}</button>
      </div>
    </div>

    {#if isComparing}
      <div>
        <div class="mb-1 flex items-center justify-between text-[10px] text-muted"><span>{progressLabel}</span><span>{progress}%</span></div>
        <div class="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="PDF comparison progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
          <div class="h-full bg-brand-600 transition-[width]" style={'width:' + progress + '%'}></div>
        </div>
      </div>
    {/if}

    <p class="mb-0 text-[11px] text-muted" role="status" aria-live="polite">{statusMessage}</p>
    {#if errorMessage}
      <p class="rounded-lg border border-danger-200 bg-danger-50 p-3 text-[11px] leading-5 text-danger-700" role="alert">{errorMessage}</p>
    {/if}

    {#if result}
      <div aria-label="PDF comparison results" class="space-y-4">
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div class="rounded-xl border border-line bg-surface p-3"><p class="mb-1 text-[10px] text-muted">Changed pages</p><p class="mb-0 text-[22px] font-bold text-ink">{result.changedPages}</p></div>
          <div class="rounded-xl border border-line bg-surface p-3"><p class="mb-1 text-[10px] text-muted">Unchanged pages</p><p class="mb-0 text-[22px] font-bold text-ink">{result.unchangedPages}</p></div>
          <div class="rounded-xl border border-line bg-surface p-3"><p class="mb-1 text-[10px] text-muted">Added pages</p><p class="mb-0 text-[22px] font-bold text-ink">{result.addedPages}</p></div>
          <div class="rounded-xl border border-line bg-surface p-3"><p class="mb-1 text-[10px] text-muted">Removed pages</p><p class="mb-0 text-[22px] font-bold text-ink">{result.removedPages}</p></div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="mb-0 text-[14px] font-bold text-ink">Page-by-page results</h2>
          <p class="mb-0 text-[10px] text-muted">{result.baselinePageCount} baseline pages · {result.updatedPageCount} updated pages</p>
        </div>

        <div class="space-y-2">
          {#each result.pages as pageResult (pageResult.pageNumber)}
            <article class="rounded-xl border border-line bg-surface p-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="mb-0 text-[12px] font-bold text-ink">Page {pageResult.pageNumber}</h3>
                <span class="rounded-full border border-line bg-surface-muted px-2.5 py-1 text-[9px] font-semibold text-muted">{statusLabel(pageResult)}</span>
              </div>
              {#if pageResult.status === 'changed'}
                <div class="mt-3 flex flex-wrap gap-2 text-[10px] text-muted">
                  <span class="rounded-md bg-surface-muted px-2 py-1">{pageResult.textChanged ? 'Text changed' : 'Text unchanged'}</span>
                  <span class="rounded-md bg-surface-muted px-2 py-1">{visualLabel(pageResult)}</span>
                  {#if pageResult.pageSizeChanged}<span class="rounded-md bg-surface-muted px-2 py-1">Page dimensions changed</span>{/if}
                </div>
                {#if pageResult.textChanged}
                  <details class="mt-3 rounded-lg border border-line bg-canvas p-3 text-[10px]">
                    <summary class="cursor-pointer font-semibold text-ink">Show text excerpts</summary>
                    <div class="mt-3 grid gap-3 md:grid-cols-2">
                      <div><p class="mb-1 font-bold text-muted">Baseline</p><p class="mb-0 break-words leading-5 text-ink">{pageResult.baselineTextPreview || '(No selectable text)'}</p></div>
                      <div><p class="mb-1 font-bold text-muted">Updated</p><p class="mb-0 break-words leading-5 text-ink">{pageResult.updatedTextPreview || '(No selectable text)'}</p></div>
                    </div>
                  </details>
                {/if}
              {:else if pageResult.status === 'unchanged'}
                <p class="mb-0 mt-2 text-[10px] text-muted">No text or rendered visual difference was detected.</p>
              {:else}
                <p class="mb-0 mt-2 text-[10px] text-muted">{pageResult.status === 'added' ? 'This page appears only in the updated PDF.' : 'This page appears only in the baseline PDF.'}</p>
              {/if}
            </article>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <footer class="border-t border-line px-6 py-3 text-[10px] leading-5 text-muted max-[600px]:px-4">
    Page positions are compared by page number, not by content matching. Pixel comparisons can flag layout/rendering changes, and text extraction cannot establish semantic equivalence. Scanned pages without a text layer are assessed visually only. No files are uploaded or modified.
  </footer>
</section>

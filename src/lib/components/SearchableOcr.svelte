<script lang="ts">
  import { onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import { getPdfPageCount } from '$lib/pdf/split-pdf';
  import {
    createSearchableOcrPdf,
    type SearchableOcrProgress
  } from '$lib/pdf/ocr-pdf';
  import { getSearchableOcrFileName } from '$lib/pdf/ocr-helpers';

  export let onClose: () => void;

  const MAX_FILE_BYTES = 150 * 1024 * 1024;
  const MAX_PAGES = 100;

  let sourceFile: File | null = null;
  let pageCount = 0;
  let fileInput: HTMLInputElement;
  let isLoading = false;
  let isProcessing = false;
  let progress = 0;
  let outputBlob: Blob | null = null;
  let outputName = '';
  let resultSummary = '';
  let errorMessage = '';
  let statusMessage = 'Choose a scanned PDF to make its pages searchable.';
  let abortController: AbortController | null = null;

  onDestroy(() => abortController?.abort());

  function resetOutput() {
    outputBlob = null;
    outputName = '';
    resultSummary = '';
    progress = 0;
    errorMessage = '';
  }

  async function loadFile(file?: File) {
    if (!file || isLoading || isProcessing) return;
    isLoading = true;
    sourceFile = null;
    pageCount = 0;
    resetOutput();
    errorMessage = '';

    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error('This PDF exceeds the 150 MB OCR limit.');
      }
      if (!(await hasPdfHeader(file))) {
        throw new Error('This file does not look like a valid PDF. Choose a PDF document and try again.');
      }

      const count = await getPdfPageCount(file);
      if (count > MAX_PAGES) {
        throw new Error('This OCR tool supports up to 100 pages per document.');
      }

      sourceFile = file;
      pageCount = count;
      statusMessage = count + (count === 1 ? ' page is ready for OCR.' : ' pages are ready for OCR.');
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The PDF could not be opened.';
      statusMessage = 'Unable to open document.';
    } finally {
      isLoading = false;
    }
  }

  function handlePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    void loadFile(file);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    void loadFile(event.dataTransfer?.files?.[0]);
  }

  function handleProgress(update: SearchableOcrProgress) {
    if (update.totalPages > 0) {
      progress = Math.min(99, Math.round((update.completedPages / update.totalPages) * 100));
    }
    if (update.detail) statusMessage = update.detail;
  }

  async function runOcr() {
    if (!sourceFile || isLoading || isProcessing) return;

    resetOutput();
    errorMessage = '';
    progress = 0;
    isProcessing = true;
    abortController = new AbortController();
    statusMessage = 'Preparing local OCR…';

    try {
      const result = await createSearchableOcrPdf(
        sourceFile,
        { assetBasePath: base, signal: abortController.signal },
        handleProgress
      );

      const outputBytes = new Uint8Array(result.bytes.byteLength);
      outputBytes.set(result.bytes);
      outputBlob = new Blob([outputBytes.buffer], { type: 'application/pdf' });
      outputName = getSearchableOcrFileName(sourceFile.name);
      resultSummary =
        result.processedPages +
        (result.processedPages === 1 ? ' scanned page was OCRed' : ' scanned pages were OCRed') +
        '; ' +
        result.searchablePages +
        (result.searchablePages === 1 ? ' page already had selectable text' : ' pages already had selectable text') +
        '; ' +
        result.recognizedWords +
        ' words added.';
      progress = 100;
      statusMessage = 'Your searchable PDF copy is ready.';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        statusMessage = 'OCR cancelled. Your original PDF was not changed.';
      } else {
        errorMessage = error instanceof Error ? error.message : 'OCR could not be completed.';
        statusMessage = 'OCR failed.';
      }
    } finally {
      isProcessing = false;
      abortController = null;
    }
  }

  function cancelOcr() {
    abortController?.abort();
  }

  function downloadOutput() {
    if (!outputBlob || !outputName) return;
    const objectUrl = URL.createObjectURL(outputBlob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = outputName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
    statusMessage = 'Started download of the searchable PDF copy.';
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="Searchable OCR workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">Searchable OCR</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Turn scanned pages into searchable PDF text without uploading your document.</p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50"
      onclick={onClose}
      disabled={isProcessing}
    >← Back to tools</button>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-5 py-3 max-[600px]:px-3">
    <div class="min-w-0 text-[10px] text-muted">
      {#if sourceFile}
        <span class="font-semibold text-ink">{sourceFile.name}</span>
        <span class="ml-1">· {pageCount} {pageCount === 1 ? 'page' : 'pages'} · {(sourceFile.size / 1024 / 1024).toFixed(1)} MB</span>
      {:else}
        No PDF selected
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <input bind:this={fileInput} id="ocr-file-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50"
        disabled={isLoading || isProcessing}
        onclick={() => fileInput?.click()}
      >{sourceFile ? 'Change PDF' : 'Choose PDF'}</button>
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={!sourceFile || isLoading || isProcessing}
        onclick={runOcr}
      >{isLoading ? 'Opening…' : isProcessing ? 'Recognizing…' : 'Make searchable'}</button>
      {#if isProcessing}
        <button
          type="button"
          class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-danger-600/30 bg-surface px-3 text-[10px] font-semibold text-danger-600 hover:bg-danger-600/5 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-danger-200 focus-visible:outline-offset-2"
          onclick={cancelOcr}
        >Cancel</button>
      {/if}
    </div>
  </div>

  <div
    class="min-h-[300px] bg-canvas px-6 py-6 max-[600px]:px-3"
    role="region"
    aria-label="Searchable OCR settings"
    aria-busy={isProcessing}
    ondragover={(event) => event.preventDefault()}
    ondrop={handleDrop}
  >
    {#if !sourceFile && !isLoading}
      <div class="flex min-h-[230px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
        <span class="mb-3 grid size-[44px] place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden="true">
          <svg class="size-6" viewBox="0 0 24 24" fill="none"><path d="M5 4h14v16H5zM8 9h8M8 13h5M8 17h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="m15.5 13.5 1.5 1.5 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <strong class="text-[13px] font-bold text-ink">Choose a scanned PDF</strong>
        <p class="mb-4 mt-1 max-w-[360px] text-[10px] leading-[1.6] text-muted">OCR reads image-based pages and adds an invisible text layer so you can search, select, and copy the recognized words.</p>
        <button
          type="button"
          class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          onclick={() => fileInput?.click()}
        >Choose PDF</button>
        <span class="mt-3 text-[9px] text-subtle">English OCR only in this first version; handwriting and poor-quality scans may be inaccurate.</span>
        <span class="mt-1 text-[9px] text-subtle">Or drop a PDF here. Limit: 150 MB and 100 pages.</span>
      </div>
    {:else if isLoading}
      <div class="flex min-h-[230px] items-center justify-center text-[11px] text-muted">Opening your PDF locally…</div>
    {:else}
      <div class="mx-auto max-w-[760px]">
        <div class="rounded-xl border border-line bg-surface p-4">
          <div class="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold text-ink">
            <span>{isProcessing ? 'Processing pages locally' : outputBlob ? 'OCR complete' : 'Ready to process'}</span>
            <span>{progress}%</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-canvas">
            <div class="h-full rounded-full bg-brand-600 transition-[width]" style={'width:' + progress + '%'}></div>
          </div>
          <p class="mb-0 mt-2 text-[9px] leading-[1.6] text-muted" role="status" aria-live="polite">{statusMessage}</p>
        </div>

        {#if outputBlob}
          <section class="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-4" aria-label="Searchable PDF output">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <h2 class="mb-1 text-[13px] font-bold text-ink">Your searchable PDF is ready</h2>
                <p class="mb-0 text-[9px] leading-[1.6] text-muted">{resultSummary}</p>
                <p class="mb-0 mt-1 truncate text-[9px] text-subtle">{outputName} · {(outputBlob.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                type="button"
                class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
                onclick={downloadOutput}
              >Download PDF</button>
            </div>
          </section>
        {/if}

        <div class="mt-4 rounded-xl border border-line bg-surface p-4">
          <h2 class="mb-2 text-[11px] font-bold text-ink">Before you start</h2>
          <ul class="mb-0 list-disc space-y-1 pl-4 text-[9px] leading-[1.6] text-muted">
            <li>English OCR only in this first version; handwriting and poor-quality scans may be inaccurate.</li>
            <li>Pages that already contain selectable text are left unchanged. Only scanned pages receive an invisible text layer.</li>
            <li>The OCR worker, WebAssembly engine, and English model are served by this app. First-time use loads these local app assets; document bytes are not sent to an OCR service.</li>
            <li>The output is a new PDF copy. Editing a signed document can invalidate its digital signature; password-protected PDFs are not supported.</li>
          </ul>
        </div>
      </div>
    {/if}

    {#if errorMessage}
      <p class="mx-auto mb-0 mt-4 max-w-[760px] rounded-lg border border-danger-600/20 bg-danger-600/5 px-4 py-3 text-[10px] leading-[1.6] text-danger-600" role="alert">{errorMessage}</p>
    {/if}
  </div>

  <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4 text-[10px] text-muted max-[600px]:px-4">
    <span>English OCR runs in your browser using the app-hosted model.</span>
    <span>Your source PDF is not modified.</span>
  </footer>
</section>

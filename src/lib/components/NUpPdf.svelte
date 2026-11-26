<script lang="ts">
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import { getPdfPageCount, parsePageRange } from '$lib/pdf/split-pdf';
  import {
    createNUpPdf,
    getNUpGrid,
    MAX_N_UP_SOURCE_BYTES,
    safeNUpFileName,
    type NUpOrientation,
    type NUpPageSize,
    type NUpPagesPerSheet,
    type NUpReadingOrder
  } from '$lib/pdf/n-up-pdf';

  export let onClose: () => void;

  let sourceFile: File | null = null;
  let fileInput: HTMLInputElement;
  let pageCount = 0;
  let pageSelection = '';
  let pagesPerSheet: NUpPagesPerSheet = 2;
  let pageSize: NUpPageSize = 'a4';
  let orientation: NUpOrientation = 'auto';
  let readingOrder: NUpReadingOrder = 'row-major';
  let marginMm = 10;
  let gutterMm = 5;
  let showCellBorders = true;
  let showPageLabels = true;
  let outputName = 'n-up-layout';
  let isLoading = false;
  let isExporting = false;
  let progress = 0;
  let errorMessage = '';
  let statusMessage = 'Choose a PDF to arrange multiple pages on each sheet.';
  let selectedPageNumbers: number[] = [];
  let selectionError = '';

  $: {
    selectedPageNumbers = [];
    selectionError = '';
    if (pageCount > 0) {
      try {
        selectedPageNumbers = parsePageRange(pageSelection, pageCount);
      } catch (error) {
        selectionError = error instanceof Error ? error.message : 'Enter a valid page range.';
      }
    }
  }
  $: grid = getNUpGrid(pagesPerSheet);
  $: sheetCount = selectedPageNumbers.length > 0
    ? Math.ceil(selectedPageNumbers.length / pagesPerSheet)
    : 0;
  $: previewOrientation = orientation === 'auto'
    ? grid.columns > grid.rows ? 'Landscape' : 'Portrait'
    : orientation === 'landscape' ? 'Landscape' : 'Portrait';

  function formatFileSize(size: number): string {
    if (size < 1_048_576) return Math.max(1, Math.round(size / 1_024)) + ' KB';
    return (size / 1_048_576).toFixed(2) + ' MB';
  }

  async function loadPdf(file?: File) {
    if (!file || isLoading || isExporting) return;
    isLoading = true;
    sourceFile = null;
    pageCount = 0;
    pageSelection = '';
    errorMessage = '';
    selectionError = '';
    progress = 0;
    statusMessage = 'Checking the PDF locally…';

    try {
      if (file.size === 0) throw new Error('The selected PDF is empty.');
      if (file.size > MAX_N_UP_SOURCE_BYTES) {
        throw new Error('This PDF is larger than the 150 MB local processing limit.');
      }
      if (!(await hasPdfHeader(file))) {
        throw new Error('This file does not look like a valid PDF. Choose a PDF document and try again.');
      }
      const count = await getPdfPageCount(file);
      sourceFile = file;
      pageCount = count;
      pageSelection = '1-' + count;
      statusMessage = file.name + ' is ready. Choose the layout and pages for the new PDF.';
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
    void loadPdf(file);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    void loadPdf(event.dataTransfer?.files?.[0]);
  }

  function clearPdf() {
    if (isExporting) return;
    sourceFile = null;
    pageCount = 0;
    pageSelection = '';
    selectedPageNumbers = [];
    selectionError = '';
    errorMessage = '';
    progress = 0;
    statusMessage = 'Choose a PDF to arrange multiple pages on each sheet.';
  }

  function downloadBytes(bytes: Uint8Array, fileName: string) {
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }

  async function exportPdf() {
    if (!sourceFile || isLoading || isExporting || selectionError || selectedPageNumbers.length === 0) return;

    isExporting = true;
    errorMessage = '';
    progress = 0;
    statusMessage = 'Arranging selected pages locally…';

    try {
      const bytes = await createNUpPdf(
        sourceFile,
        pageSelection,
        {
          pagesPerSheet,
          pageSize,
          orientation,
          marginMm,
          gutterMm,
          readingOrder,
          showCellBorders,
          showPageLabels
        },
        ({ completed, total, sourcePageNumber, sheetNumber, sheetCount: totalSheets }) => {
          progress = Math.round((completed / total) * 100);
          statusMessage = 'Placing page ' + sourcePageNumber + ' on sheet ' + sheetNumber +
            ' of ' + totalSheets + ' (' + completed + ' of ' + total + ')…';
        }
      );

      const fileName = safeNUpFileName(outputName);
      downloadBytes(bytes, fileName);
      statusMessage = sheetCount + (sheetCount === 1 ? ' print sheet created.' : ' print sheets created.') +
        ' Download started: ' + fileName;
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : 'The PDF could not be rearranged. Check the file and try again.';
      statusMessage = 'N-up export failed.';
    } finally {
      isExporting = false;
    }
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="N-up PDF layout workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">N-up PDF layout</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Place several PDF pages on each print sheet. Keep the source file unchanged.</p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
      onclick={onClose}
    >← Back to tools</button>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-5 py-3 max-[600px]:px-3">
    <div class="text-[10px] text-muted">{sourceFile ? sourceFile.name + ' · ' + pageCount + ' pages' : 'No PDF selected'}</div>
    <div class="flex flex-wrap items-center gap-2">
      <input
        bind:this={fileInput}
        id="n-up-pdf-file-input"
        class="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        onchange={handlePick}
      />
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50"
        disabled={isLoading || isExporting}
        onclick={() => fileInput?.click()}
      >{sourceFile ? 'Choose another PDF' : 'Choose PDF'}</button>
      {#if sourceFile}
        <button
          type="button"
          class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted hover:bg-canvas disabled:opacity-40"
          disabled={isExporting}
          onclick={clearPdf}
        >Remove PDF</button>
      {/if}
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={!sourceFile || isLoading || isExporting || Boolean(selectionError) || selectedPageNumbers.length === 0}
        onclick={exportPdf}
      >{isLoading ? 'Checking…' : isExporting ? 'Creating PDF…' : 'Create N-up PDF'}</button>
    </div>
  </div>

  <div
    class="min-h-[300px] bg-canvas px-6 py-6 max-[600px]:px-3"
    role="region"
    aria-label="Drop a PDF for N-up layout"
    ondragover={(event) => event.preventDefault()}
    ondrop={handleDrop}
  >
    {#if !sourceFile}
      <div class="flex min-h-[250px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
        <span class="mb-3 grid size-[44px] place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden="true">
          <svg class="size-6" viewBox="0 0 24 24" fill="none"><path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15h6M9 18h3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>
        </span>
        <strong class="text-[13px] font-bold text-ink">{isLoading ? 'Checking your PDF…' : 'Arrange PDF pages for printing'}</strong>
        <p class="mb-4 mt-1 max-w-[380px] text-[10px] leading-[1.6] text-muted">Choose a local PDF or drop it here. Pages are processed on this device, not uploaded.</p>
        <button
          type="button"
          class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          disabled={isLoading}
          onclick={() => fileInput?.click()}
        >Choose PDF</button>
        <span class="mt-3 text-[9px] text-subtle">Maximum file size: 150 MB. Select up to 500 pages per export.</span>
      </div>
    {:else}
      <div class="mx-auto grid max-w-[960px] grid-cols-[minmax(0,1.1fr)_minmax(250px,.9fr)] gap-5 max-[760px]:grid-cols-1">
        <div class="min-w-0 rounded-xl border border-line bg-surface p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="mb-0 text-[12px] font-bold text-ink">Print sheet preview</h2>
              <p class="mb-0 mt-1 text-[9px] text-muted">{grid.columns} columns × {grid.rows} rows · {previewOrientation}</p>
            </div>
            <span class="rounded-full bg-brand-50 px-2.5 py-1 text-[9px] font-semibold text-brand-700">{pagesPerSheet}-up</span>
          </div>
          <div class="flex min-h-[290px] items-center justify-center rounded-lg bg-[#eef0f4] p-4">
            <div
              class="grid aspect-[.707] w-full max-w-[260px] gap-[3px] border border-[#b8bec9] bg-white p-[8px] shadow-[0_4px_14px_rgb(30_40_70_/_0.1)]"
              style={'grid-template-columns:repeat(' + grid.columns + ',minmax(0,1fr));grid-template-rows:repeat(' + grid.rows + ',minmax(0,1fr));' + (previewOrientation === 'Landscape' ? 'aspect-ratio:1.414;' : '')}
              aria-label={pagesPerSheet + ' page positions on one sheet'}
            >
              {#each Array.from({ length: pagesPerSheet }) as _, index}
                <div class={'flex min-h-0 items-center justify-center overflow-hidden rounded-[2px] bg-[#f8f9fb] text-[8px] font-semibold text-[#858b98] ' + (showCellBorders ? 'border border-dashed border-[#aeb5c1]' : '')}>
                  {#if showPageLabels}<span>{index + 1}</span>{:else}<span>PDF</span>{/if}
                </div>
              {/each}
            </div>
          </div>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] text-muted">
            <span>{selectedPageNumbers.length} selected pages</span>
            <span>{sheetCount} output {sheetCount === 1 ? 'sheet' : 'sheets'}</span>
          </div>
        </div>

        <div class="grid content-start gap-3">
          <div class="rounded-xl border border-line bg-surface p-4">
            <h2 class="mb-3 text-[12px] font-bold text-ink">Page selection</h2>
            <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
              Pages to include
              <input
                aria-label="Pages to include"
                type="text"
                value={pageSelection}
                oninput={(event) => (pageSelection = (event.currentTarget as HTMLInputElement).value)}
                disabled={isExporting}
                placeholder="1-5, 8, 10-12"
                class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink"
              />
            </label>
            {#if selectionError}
              <p class="mb-0 mt-2 text-[9px] leading-[1.5] text-danger-600" role="alert">{selectionError}</p>
            {:else}
              <p class="mb-0 mt-2 text-[9px] leading-[1.5] text-muted">Use page numbers and ascending ranges, such as 1-5, 8, 10-12. Maximum 500 pages.</p>
            {/if}
          </div>

          <div class="rounded-xl border border-line bg-surface p-4">
            <h2 class="mb-3 text-[12px] font-bold text-ink">Sheet layout</h2>
            <div class="grid grid-cols-2 gap-3">
              <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
                Pages per sheet
                <select aria-label="Pages per sheet" bind:value={pagesPerSheet} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink">
                  <option value={1}>1 page</option>
                  <option value={2}>2 pages</option>
                  <option value={4}>4 pages</option>
                  <option value={6}>6 pages</option>
                  <option value={9}>9 pages</option>
                  <option value={16}>16 pages</option>
                </select>
              </label>
              <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
                Paper size
                <select aria-label="Paper size" bind:value={pageSize} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink">
                  <option value="a4">A4</option>
                  <option value="letter">US Letter</option>
                  <option value="legal">US Legal</option>
                </select>
              </label>
              <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
                Orientation
                <select aria-label="Sheet orientation" bind:value={orientation} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink">
                  <option value="auto">Auto from layout</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
                Reading order
                <select aria-label="Reading order" bind:value={readingOrder} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink">
                  <option value="row-major">Rows first</option>
                  <option value="column-major">Columns first</option>
                </select>
              </label>
              <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
                Outer margins (mm)
                <input aria-label="Outer margins (mm)" type="number" min="0" max="50" step="1" bind:value={marginMm} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink" />
              </label>
              <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
                Page spacing (mm)
                <input aria-label="Page spacing (mm)" type="number" min="0" max="25" step="1" bind:value={gutterMm} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink" />
              </label>
            </div>
            <div class="mt-3 grid gap-2 border-t border-line pt-3">
              <label class="flex items-center gap-2 text-[10px] text-ink"><input type="checkbox" bind:checked={showCellBorders} disabled={isExporting} class="size-3.5 accent-brand-700" /> Add a light border around each page</label>
              <label class="flex items-center gap-2 text-[10px] text-ink"><input type="checkbox" bind:checked={showPageLabels} disabled={isExporting} class="size-3.5 accent-brand-700" /> Print original page numbers</label>
            </div>
          </div>

          <div class="rounded-xl border border-line bg-surface p-4">
            <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
              Output PDF name
              <input aria-label="Output PDF name" type="text" maxlength="100" bind:value={outputName} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink" />
            </label>
          </div>
        </div>
      </div>
    {/if}

    {#if isExporting}
      <div class="mx-auto mt-4 max-w-[960px]">
        <div class="mb-1 flex items-center justify-between text-[9px] text-muted"><span>Building print sheets</span><span>{progress}%</span></div>
        <div class="h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-brand-600 transition-all" style={'width:' + progress + '%'}></div></div>
      </div>
    {/if}

    {#if errorMessage}
      <p class="mx-auto mb-0 mt-4 max-w-[960px] rounded-lg border border-[#f0d6d6] bg-[#fff8f8] px-4 py-3 text-[10px] leading-[1.6] text-[#a44747]" role="alert">{errorMessage}</p>
    {/if}
    <p class="mb-0 mt-4 text-center text-[10px] text-muted" role="status" aria-live="polite">{statusMessage}</p>
  </div>

  <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4 text-[10px] text-muted max-[600px]:px-4">
    <span>Processed locally in your browser; the original PDF is unchanged.</span>
    <span>Form fields, links, signatures, and interactive annotations may not carry over.</span>
  </footer>
</section>

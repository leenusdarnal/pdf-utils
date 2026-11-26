<script lang="ts">
  import {
    createNUpPdf,
    getNUpFileName,
    resolveNUpGrid,
    type NUpLayout,
    type NUpOrientation,
    type NUpPageSize,
    type NUpProgress
  } from '$lib/pdf/n-up-pdf';
  import { getPdfPageCount, parsePageRange } from '$lib/pdf/split-pdf';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';

  export let onClose: () => void;

  const MAX_FILE_BYTES = 150 * 1024 * 1024;
  const MAX_PAGES = 500;

  let sourceFile: File | null = null;
  let pageCount = 0;
  let fileInput: HTMLInputElement;
  let pageSelection = '';
  let layout: NUpLayout = '2-up';
  let pageSize: NUpPageSize = 'a4';
  let orientation: NUpOrientation = 'auto';
  let rows = 2;
  let columns = 3;
  let marginMm = 8;
  let gutterMm = 4;
  let reverseOrder = false;
  let outputName = 'document';
  let isLoading = false;
  let isExporting = false;
  let progress = 0;
  let progressLabel = '';
  let outputBlob: Blob | null = null;
  let outputFileName = '';
  let outputPageCount = 0;
  let outputSize = 0;
  let errorMessage = '';
  let statusMessage = 'Choose a PDF to arrange multiple pages on each sheet.';

  $: previewGrid = (() => {
    try {
      return resolveNUpGrid(layout, orientation, Number(rows), Number(columns));
    } catch {
      return { rows: 2, columns: 2, orientation: 'portrait' as const, pagesPerSheet: 4 };
    }
  })();
  $: previewCells = Array.from(
    { length: Math.min(previewGrid.pagesPerSheet, 16) },
    (_, index) => index + 1
  );
  $: estimatedSheets = (() => {
    if (!pageCount) return 0;
    try {
      return Math.ceil(parsePageRange(pageSelection, pageCount).length / previewGrid.pagesPerSheet);
    } catch {
      return 0;
    }
  })();

  function resetOutput() {
    outputBlob = null;
    outputFileName = '';
    outputPageCount = 0;
    outputSize = 0;
    progress = 0;
    progressLabel = '';
    errorMessage = '';
  }

  async function loadFile(file?: File) {
    if (!file || isLoading || isExporting) return;
    sourceFile = null;
    pageCount = 0;
    resetOutput();
    isLoading = true;
    try {
      if (file.size === 0) throw new Error('Choose a non-empty PDF file.');
      if (file.size > MAX_FILE_BYTES) throw new Error('This PDF exceeds the 150 MB limit.');
      if (!(await hasPdfHeader(file))) throw new Error('This file does not look like a valid PDF.');
      const count = await getPdfPageCount(file);
      if (count > MAX_PAGES) throw new Error('This tool supports up to 500 source pages per PDF.');
      sourceFile = file;
      pageCount = count;
      pageSelection = '1-' + count;
      outputName = file.name.replace(/\.pdf$/i, '') || 'document';
      statusMessage = count + (count === 1 ? ' page ready to arrange.' : ' pages ready to arrange.');
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The PDF could not be opened.';
      statusMessage = 'Unable to open this PDF.';
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

  function updateSetting() {
    resetOutput();
  }

  function formatSize(size: number): string {
    return size < 1_048_576
      ? Math.max(1, Math.round(size / 1024)) + ' KB'
      : (size / 1_048_576).toFixed(2) + ' MB';
  }

  async function exportPdf() {
    if (!sourceFile || isLoading || isExporting) return;
    resetOutput();

    try {
      const pageNumbers = parsePageRange(pageSelection, pageCount);
      if (pageNumbers.length === 0) throw new Error('Select at least one page to arrange.');
      isExporting = true;
      statusMessage = 'Arranging pages locally…';

      const result = await createNUpPdf(
        sourceFile,
        {
          layout,
          rows: Number(rows),
          columns: Number(columns),
          pageSize,
          orientation,
          marginMm: Number(marginMm),
          gutterMm: Number(gutterMm),
          pageNumbers,
          reverseOrder
        },
        (details: NUpProgress) => {
          progress = Math.round((details.completedPages / details.totalPages) * 100);
          progressLabel =
            'Sheet ' + details.sheetNumber + ' of ' + details.totalSheets +
            ' · source page ' + details.currentPage;
          statusMessage =
            'Placing page ' + details.currentPage + ' (' +
            details.completedPages + ' of ' + details.totalPages + ')…';
        }
      );

      outputBlob = new Blob([result.bytes as BlobPart], { type: 'application/pdf' });
      outputFileName = getNUpFileName(outputName || sourceFile.name);
      outputPageCount = result.outputPages;
      outputSize = result.fileSize;
      statusMessage =
        result.sourcePages + ' source pages arranged across ' +
        result.outputPages + (result.outputPages === 1 ? ' sheet.' : ' sheets.');
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : 'The pages could not be arranged. Check the PDF and try again.';
      statusMessage = 'N-up export failed.';
    } finally {
      isExporting = false;
    }
  }

  function downloadOutput() {
    if (!outputBlob || !outputFileName) return;
    const objectUrl = URL.createObjectURL(outputBlob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = outputFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="N-up PDF layout workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE · TRANSFORM</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">N-up PDF layout</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Arrange multiple PDF pages on one print-ready sheet. Your document stays in this browser.</p>
    </div>
    <button type="button" class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" onclick={onClose}>← Back to tools</button>
  </header>

  <div class="grid gap-6 p-6 max-[600px]:p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,.9fr)]">
    <div class="space-y-5">
      <div>
        <label class="mb-2 block text-[11px] font-semibold text-ink" for="nup-file-input">Choose PDF</label>
        <input
          bind:this={fileInput}
          id="nup-file-input"
          class="sr-only"
          type="file"
          accept="application/pdf,.pdf"
          onchange={handlePick}
        />
        <button
          type="button"
          class="flex min-h-[106px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-brand-300 bg-brand-50/70 px-4 py-5 text-center transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          onclick={() => fileInput?.click()}
          ondragover={(event) => event.preventDefault()}
          ondrop={handleDrop}
        >
          <span class="mb-2 grid size-9 place-items-center rounded-lg bg-surface text-brand-600">PDF</span>
          <span class="text-[12px] font-semibold text-ink">Click to choose or drop a PDF here</span>
          <span class="mt-1 text-[10px] text-muted">Up to 150 MB and 500 source pages</span>
        </button>
        {#if sourceFile}
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2 text-[10px]">
            <span class="min-w-0 truncate font-semibold text-ink">{sourceFile.name}</span>
            <span class="shrink-0 text-muted">{pageCount} pages · {formatSize(sourceFile.size)}</span>
          </div>
        {/if}
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-pages">Pages to arrange</label>
          <input id="nup-pages" type="text" bind:value={pageSelection} oninput={updateSetting} disabled={!sourceFile || isExporting} placeholder="e.g. 1-8, 10" class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:opacity-50" />
          <p class="mt-1 text-[10px] leading-4 text-muted">Use ranges such as 1-8 or 1, 3-5. Entered order is preserved.</p>
        </div>
        <div>
          <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-layout">Pages per sheet</label>
          <select id="nup-layout" bind:value={layout} onchange={updateSetting} disabled={isExporting} class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
            <option value="2-up">2-up</option>
            <option value="4-up">4-up</option>
            <option value="6-up">6-up</option>
            <option value="9-up">9-up</option>
            <option value="16-up">16-up</option>
            <option value="custom">Custom grid</option>
          </select>
        </div>
      </div>

      {#if layout === 'custom'}
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-rows">Rows (1–4)</label>
            <input id="nup-rows" type="number" min="1" max="4" step="1" bind:value={rows} oninput={updateSetting} class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400" />
          </div>
          <div>
            <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-columns">Columns (1–4)</label>
            <input id="nup-columns" type="number" min="1" max="4" step="1" bind:value={columns} oninput={updateSetting} class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400" />
          </div>
        </div>
      {/if}

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-paper">Paper size</label>
          <select id="nup-paper" bind:value={pageSize} onchange={updateSetting} disabled={isExporting} class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400">
            <option value="a4">A4</option>
            <option value="letter">US Letter</option>
            <option value="legal">US Legal</option>
            <option value="a3">A3</option>
          </select>
        </div>
        <div>
          <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-orientation">Sheet orientation</label>
          <select id="nup-orientation" bind:value={orientation} onchange={updateSetting} disabled={isExporting} class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400">
            <option value="auto">Automatic</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-margin">Sheet margin (mm)</label>
          <input id="nup-margin" type="number" min="0" max="25" step="1" bind:value={marginMm} oninput={updateSetting} disabled={isExporting} class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400" />
        </div>
        <div>
          <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-gutter">Space between pages (mm)</label>
          <input id="nup-gutter" type="number" min="0" max="20" step="1" bind:value={gutterMm} oninput={updateSetting} disabled={isExporting} class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400" />
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-order">Page sequence</label>
          <select id="nup-order" bind:value={reverseOrder} onchange={updateSetting} disabled={isExporting} class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400">
            <option value={false}>As entered</option>
            <option value={true}>Reverse sequence</option>
          </select>
        </div>
        <div>
          <label class="mb-1.5 block text-[11px] font-semibold text-ink" for="nup-name">Output file name</label>
          <input id="nup-name" type="text" bind:value={outputName} oninput={updateSetting} disabled={isExporting} class="min-h-[39px] w-full rounded-lg border border-line bg-surface px-3 text-[12px] text-ink outline-none focus:border-brand-400" />
        </div>
      </div>

      {#if errorMessage}
        <p class="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-700" role="alert">{errorMessage}</p>
      {/if}
      <p class="m-0 text-[10px] text-muted" role="status" aria-live="polite">{statusMessage}</p>
      {#if isExporting}
        <div>
          <div class="mb-1 flex items-center justify-between text-[10px] text-muted"><span>{progressLabel || 'Arranging pages…'}</span><span>{progress}%</span></div>
          <div class="h-2 overflow-hidden rounded-full bg-surface-muted"><div class="h-full rounded-full bg-brand-600 transition-[width]" style={'width:' + progress + '%'}></div></div>
        </div>
      {/if}
      <button type="button" onclick={exportPdf} disabled={!sourceFile || isLoading || isExporting} class="inline-flex min-h-[43px] w-full items-center justify-center rounded-lg bg-brand-700 px-4 text-[12px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        {isLoading ? 'Opening PDF…' : isExporting ? 'Arranging pages…' : 'Create N-up PDF'}
      </button>
    </div>

    <aside class="space-y-4 rounded-xl border border-line bg-surface-muted p-4">
      <div>
        <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.3px] text-brand-600">LAYOUT PREVIEW</p>
        <h2 class="mb-0 text-[15px] font-bold text-ink">{previewGrid.pagesPerSheet} pages per sheet</h2>
        <p class="mb-0 mt-1 text-[10px] text-muted">{previewGrid.columns} columns × {previewGrid.rows} rows · {previewGrid.orientation}</p>
      </div>
      <div class="mx-auto grid w-full max-w-[290px] gap-1.5 rounded-lg border border-line bg-surface p-3 shadow-sm" style={'aspect-ratio:' + (previewGrid.orientation === 'landscape' ? '1.414' : '0.707') + ';grid-template-columns:repeat(' + previewGrid.columns + ',minmax(0,1fr));grid-template-rows:repeat(' + previewGrid.rows + ',minmax(0,1fr))'}>
        {#each previewCells as cell}
          <div class="grid min-h-0 place-items-center rounded border border-brand-200 bg-brand-50 text-[10px] font-semibold text-brand-700">{cell}</div>
        {/each}
      </div>
      <dl class="grid grid-cols-2 gap-3 border-t border-line pt-3 text-[10px]">
        <div><dt class="text-muted">Selected pages</dt><dd class="mb-0 mt-1 font-bold text-ink">{pageSelection || '—'}</dd></div>
        <div><dt class="text-muted">Estimated sheets</dt><dd class="mb-0 mt-1 font-bold text-ink">{estimatedSheets || '—'}</dd></div>
      </dl>
      <p class="mb-0 text-[10px] leading-5 text-muted">The preview shows the page grid, not the actual source-page artwork. Each page is fitted proportionally without stretching or cropping.</p>
    </aside>
  </div>

  {#if statusMessage.includes('arranged across') && outputFileName}
    <div class="mx-6 mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 max-[600px]:mx-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="mb-1 text-[13px] font-bold text-emerald-900">Your N-up PDF is ready</h2>
          <p class="mb-0 text-[10px] text-emerald-800">{outputPageCount} sheets · {formatSize(outputSize)} · {outputFileName}</p>
        </div>
        <button type="button" onclick={downloadOutput} disabled={!outputBlob} class="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-emerald-700 px-4 text-[11px] font-bold text-white transition-colors hover:bg-emerald-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-emerald-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">Download PDF</button>
      </div>
    </div>
  {/if}

  <footer class="border-t border-line px-6 py-3 text-[10px] leading-5 text-muted max-[600px]:px-4">
    The source file is unchanged. Pages are embedded as PDF content; interactive form fields, links, comments, bookmarks, and digital signatures are not carried into the arranged copy.
  </footer>
</section>

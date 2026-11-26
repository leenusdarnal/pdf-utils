<script lang="ts">
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import { getPdfPageCount, parsePageRange } from '$lib/pdf/split-pdf';
  import {
    addWatermarkAndPageNumbers,
    type PageNumberOptions,
    type WatermarkOptions
  } from '$lib/pdf/watermark-page-numbers-service';
  import {
    getOverlayFileName,
    getPageNumberLabel,
    type PageNumberFormat,
    type PageNumberPosition
  } from '$lib/pdf/watermark-page-numbers';

  export let onClose: () => void;

  const MAX_FILE_BYTES = 150 * 1024 * 1024;
  let sourceFile: File | null = null;
  let pageCount = 0;
  let fileInput: HTMLInputElement;
  let pageSelection = '';
  let watermarkEnabled = true;
  let watermarkText = 'DRAFT';
  let watermarkColor = '#777777';
  let watermarkFontSize = 48;
  let watermarkOpacity = 0.22;
  let watermarkAngle: '0' | '45' = '45';
  let pageNumbersEnabled = true;
  let pageNumberFormat: PageNumberFormat = 'page-of-total';
  let pageNumberPosition: PageNumberPosition = 'bottom-center';
  let pageNumberColor = '#333333';
  let pageNumberFontSize = 10;
  let marginMm = 12;
  let isLoading = false;
  let isExporting = false;
  let progress = 0;
  let progressLabel = '';
  let outputBlob: Blob | null = null;
  let outputName = '';
  let outputSize = 0;
  let errorMessage = '';
  let statusMessage = 'Choose a PDF to add a watermark, page numbers, or both.';

  $: previewLabel = getPageNumberLabel(1, pageCount || 1, pageNumberFormat);

  function resetOutput() {
    outputBlob = null;
    outputName = '';
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
      if (file.size > MAX_FILE_BYTES) throw new Error('This PDF exceeds the 150 MB limit.');
      if (!(await hasPdfHeader(file))) throw new Error('This file does not look like a valid PDF.');
      const count = await getPdfPageCount(file);
      if (count > 500) throw new Error('This tool supports up to 500 pages per PDF.');
      sourceFile = file;
      pageCount = count;
      pageSelection = '1-' + count;
      statusMessage = count + (count === 1 ? ' page ready.' : ' pages ready.');
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

  function getWatermarkOptions(): WatermarkOptions | undefined {
    if (!watermarkEnabled) return undefined;
    return {
      text: watermarkText,
      color: watermarkColor,
      fontSize: Number(watermarkFontSize),
      opacity: Number(watermarkOpacity),
      angle: Number(watermarkAngle) as 0 | 45
    };
  }

  function getPageNumberOptions(): PageNumberOptions | undefined {
    if (!pageNumbersEnabled) return undefined;
    return {
      format: pageNumberFormat,
      position: pageNumberPosition,
      color: pageNumberColor,
      fontSize: Number(pageNumberFontSize),
      margin: (Number(marginMm) * 72) / 25.4
    };
  }

  async function exportPdf() {
    if (!sourceFile || isLoading || isExporting) return;
    resetOutput();
    try {
      if (!watermarkEnabled && !pageNumbersEnabled) {
        throw new Error('Enable a watermark or page numbers before exporting.');
      }
      const pages = parsePageRange(pageSelection, pageCount);
      const watermark = getWatermarkOptions();
      const pageNumbers = getPageNumberOptions();
      isExporting = true;
      statusMessage = 'Adding overlays to a new PDF copy…';
      const result = await addWatermarkAndPageNumbers(
        sourceFile,
        { pages, watermark, pageNumbers },
        (completed, total, pageNumber) => {
          progress = Math.round((completed / total) * 100);
          progressLabel = 'Page ' + pageNumber + ' · ' + completed + ' of ' + total;
          statusMessage = 'Updating selected pages locally…';
        }
      );
      const outputBytes = new Uint8Array(result.bytes.byteLength);
      outputBytes.set(result.bytes);
      outputBlob = new Blob([outputBytes.buffer], { type: 'application/pdf' });
      outputName = getOverlayFileName(sourceFile.name);
      outputSize = result.fileSize;
      statusMessage = 'Updated ' + result.changedPages + ' pages. Your new PDF is ready.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The PDF could not be updated.';
      statusMessage = 'Export failed.';
    } finally {
      isExporting = false;
    }
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
    statusMessage = 'Download started: ' + outputName;
  }
</script>

<section
  class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]"
  aria-label="Watermark and page numbers workspace"
  ondragover={(event) => event.preventDefault()}
  ondrop={handleDrop}
>
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">Watermark &amp; Page Numbers</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Add visible text overlays to a new PDF copy. Your original stays unchanged.</p>
    </div>
    <button type="button" class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50" onclick={onClose} disabled={isExporting}>← Back to tools</button>
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
      <input bind:this={fileInput} id="watermark-file-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
      <button type="button" class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted hover:border-brand-300 disabled:opacity-50" disabled={isLoading || isExporting} onclick={() => fileInput?.click()}>{sourceFile ? 'Change PDF' : 'Choose PDF'}</button>
      <button type="button" class="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-45" disabled={!sourceFile || isLoading || isExporting} onclick={exportPdf}>{isLoading ? 'Opening…' : isExporting ? 'Applying…' : 'Apply overlays'}</button>
    </div>
  </div>

  {#if !sourceFile && !isLoading}
    <div class="bg-canvas px-6 py-10 text-center max-[600px]:px-4">
      <div class="mx-auto flex min-h-[200px] max-w-[660px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-5 py-8">
        <span class="mb-3 grid size-[44px] place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden="true">
          <svg class="size-6" viewBox="0 0 24 24" fill="none"><path d="M5 4h14v16H5zM8 8h8M8 12h4M8 16h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 3v5m-2.5-2.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </span>
        <strong class="text-[13px] font-bold text-ink">Choose a PDF to customize</strong>
        <p class="mb-4 mt-1 max-w-[370px] text-[10px] leading-[1.6] text-muted">Add a diagonal DRAFT watermark, insert page numbers, or combine both in one export.</p>
        <button type="button" class="rounded-lg bg-brand-700 px-4 py-2.5 text-[10px] font-bold text-white hover:bg-brand-800" onclick={() => fileInput?.click()}>Choose PDF</button>
        <span class="mt-3 text-[9px] text-subtle">PDFs up to 150 MB and 500 pages · Files stay on your device</span>
      </div>
    </div>
  {:else if isLoading}
    <div class="flex min-h-[220px] items-center justify-center bg-canvas text-[11px] text-muted">Opening your PDF locally…</div>
  {:else}
    <div class="grid gap-6 bg-canvas p-6 lg:grid-cols-[minmax(0,1fr)_280px] max-[600px]:p-4">
      <div class="space-y-4">
        <div class="rounded-xl border border-line bg-surface p-4">
          <label for="watermark-page-range" class="mb-1.5 block text-[10px] font-semibold text-ink">Pages to update</label>
          <input id="watermark-page-range" class="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[11px] text-ink outline-none focus:border-brand-400" type="text" autocomplete="off" spellcheck="false" bind:value={pageSelection} disabled={isExporting} />
          <p class="mb-0 mt-1 text-[9px] text-muted">Example: 1-3, 5 · Default: all {pageCount} pages.</p>
        </div>

        <fieldset class="rounded-xl border border-line bg-surface p-4" disabled={isExporting}>
          <legend class="px-1 text-[11px] font-bold text-ink"><label class="inline-flex items-center gap-2"><input type="checkbox" bind:checked={watermarkEnabled} /> Add watermark</label></legend>
          {#if watermarkEnabled}
            <div class="mt-2 grid gap-3 sm:grid-cols-2">
              <label class="sm:col-span-2"><span class="mb-1 block text-[10px] font-semibold text-ink">Watermark text</span><input class="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[11px] text-ink" maxlength="120" bind:value={watermarkText} /></label>
              <label><span class="mb-1 block text-[10px] font-semibold text-ink">Text color</span><input class="h-10 w-full rounded-lg border border-line bg-canvas px-2" type="color" bind:value={watermarkColor} aria-label="Watermark color" /></label>
              <label><span class="mb-1 flex items-center justify-between text-[10px] font-semibold text-ink"><span>Font size</span><span>{watermarkFontSize} pt</span></span><input class="h-10 w-full accent-brand-700" type="range" min="12" max="80" step="1" bind:value={watermarkFontSize} aria-label="Watermark font size" /></label>
              <label><span class="mb-1 flex items-center justify-between text-[10px] font-semibold text-ink"><span>Opacity</span><span>{Math.round(watermarkOpacity * 100)}%</span></span><input class="h-10 w-full accent-brand-700" type="range" min="0.05" max="0.65" step="0.01" bind:value={watermarkOpacity} aria-label="Watermark opacity" /></label>
              <label><span class="mb-1 block text-[10px] font-semibold text-ink">Orientation</span><select class="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[11px] text-ink" bind:value={watermarkAngle}><option value="45">Diagonal</option><option value="0">Horizontal</option></select></label>
            </div>
          {/if}
        </fieldset>

        <fieldset class="rounded-xl border border-line bg-surface p-4" disabled={isExporting}>
          <legend class="px-1 text-[11px] font-bold text-ink"><label class="inline-flex items-center gap-2"><input type="checkbox" bind:checked={pageNumbersEnabled} /> Add page numbers</label></legend>
          {#if pageNumbersEnabled}
            <div class="mt-2 grid gap-3 sm:grid-cols-2">
              <label><span class="mb-1 block text-[10px] font-semibold text-ink">Number format</span><select class="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[11px] text-ink" bind:value={pageNumberFormat}><option value="number">1, 2, 3</option><option value="page">Page 1</option><option value="page-of-total">Page 1 of {pageCount}</option></select></label>
              <label><span class="mb-1 block text-[10px] font-semibold text-ink">Position</span><select class="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[11px] text-ink" bind:value={pageNumberPosition}><option value="bottom-left">Bottom left</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option><option value="top-left">Top left</option><option value="top-center">Top center</option><option value="top-right">Top right</option></select></label>
              <label><span class="mb-1 block text-[10px] font-semibold text-ink">Text color</span><input class="h-10 w-full rounded-lg border border-line bg-canvas px-2" type="color" bind:value={pageNumberColor} aria-label="Page number color" /></label>
              <label><span class="mb-1 flex items-center justify-between text-[10px] font-semibold text-ink"><span>Font size</span><span>{pageNumberFontSize} pt</span></span><input class="h-10 w-full accent-brand-700" type="range" min="6" max="24" step="1" bind:value={pageNumberFontSize} aria-label="Page number font size" /></label>
              <label class="sm:col-span-2"><span class="mb-1 flex items-center justify-between text-[10px] font-semibold text-ink"><span>Margin from page edge</span><span>{marginMm} mm</span></span><input class="h-10 w-full accent-brand-700" type="range" min="5" max="30" step="1" bind:value={marginMm} aria-label="Page number margin" /></label>
            </div>
          {/if}
        </fieldset>

        {#if isExporting}
          <div class="rounded-xl border border-line bg-surface p-4" aria-live="polite">
            <div class="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold text-ink"><span>Applying overlays</span><span>{progress}%</span></div>
            <div class="h-2 overflow-hidden rounded-full bg-canvas"><div class="h-full rounded-full bg-brand-600 transition-[width]" style={'width:' + progress + '%'}></div></div>
            <p class="mb-0 mt-2 text-[9px] text-muted">{progressLabel}</p>
          </div>
        {/if}

        {#if outputBlob}
          <section class="rounded-xl border border-brand-200 bg-brand-50/60 p-4" aria-label="Updated PDF output">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0"><h2 class="mb-1 text-[13px] font-bold text-ink">Your updated PDF is ready</h2><p class="mb-0 truncate text-[9px] text-muted">{outputName} · {(outputSize / 1024).toFixed(0)} KB</p><p class="mb-0 mt-1 text-[9px] text-muted">The original document was not changed.</p></div>
              <button type="button" class="min-h-[36px] rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800" onclick={downloadOutput}>Download PDF</button>
            </div>
          </section>
        {/if}
      </div>

      <aside class="h-fit rounded-xl border border-line bg-surface p-4">
        <h2 class="mb-3 text-[11px] font-bold text-ink">Live preview</h2>
        <div class="relative mx-auto aspect-[3/4] w-full max-w-[190px] overflow-hidden border border-[#dfe3e9] bg-white shadow-sm">
          {#if watermarkEnabled && watermarkText.trim()}
            <div class="pointer-events-none absolute left-1/2 top-1/2 w-max max-w-[140%] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-bold" style={'color:' + watermarkColor + ';opacity:' + watermarkOpacity + ';font-size:' + Math.max(10, Math.min(24, watermarkFontSize / 2)) + 'px;transform:translate(-50%,-50%) rotate(' + watermarkAngle + 'deg)'}>{watermarkText}</div>
          {/if}
          {#if pageNumbersEnabled}
            <div class="pointer-events-none absolute whitespace-nowrap text-[8px]" style={'color:' + pageNumberColor + ';font-size:' + Math.max(7, pageNumberFontSize * 0.65) + 'px;' + (pageNumberPosition.startsWith('top') ? 'top:' : 'bottom:') + (marginMm / 2) + '%;' + (pageNumberPosition.endsWith('left') ? 'left:' : pageNumberPosition.endsWith('right') ? 'right:' : 'left:50%;') + (pageNumberPosition.endsWith('center') ? 'transform:translateX(-50%);' : '')}>{previewLabel}</div>
          {/if}
          <span class="absolute bottom-2 right-2 text-[7px] text-slate-300">Preview</span>
        </div>
        <p class="mb-0 mt-3 text-[9px] leading-[1.6] text-muted">Preview updates as you change the style. Export placement uses each page's crop box and rotation.</p>
      </aside>
    </div>
  {/if}

  {#if errorMessage}
    <p class="mx-6 mb-4 rounded-lg border border-danger-600/20 bg-danger-600/5 px-4 py-3 text-[10px] leading-[1.6] text-danger-600 max-[600px]:mx-4" role="alert">{errorMessage}</p>
  {/if}
  <p class="mb-0 border-t border-line px-6 py-4 text-[10px] text-muted max-[600px]:px-4" role="status" aria-live="polite">{statusMessage}</p>
</section>

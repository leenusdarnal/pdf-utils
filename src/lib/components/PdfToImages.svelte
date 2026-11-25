<script lang="ts">
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import { getPdfPageCount, parsePageRange } from '$lib/pdf/split-pdf';
  import {
    exportPdfPagesToImages,
    type ImageDpi,
    type ImageFormat,
    type PdfPageImage
  } from '$lib/pdf/pdf-to-images';
  import { createStoredZip } from '$lib/pdf/zip';

  export let onClose: () => void;

  let sourceFile: File | null = null;
  let pageCount = 0;
  let pageSelection = '';
  let format: ImageFormat = 'png';
  let dpi: ImageDpi = 150;
  let quality = 0.9;
  let outputs: PdfPageImage[] = [];
  let fileInput: HTMLInputElement;
  let isLoading = false;
  let isExporting = false;
  let isZipping = false;
  let progress = 0;
  let errorMessage = '';
  let statusMessage = 'Choose a PDF to convert its pages into images.';

  function resetOutputs() {
    outputs = [];
    errorMessage = '';
    progress = 0;
  }

  async function loadFile(file?: File) {
    if (!file || isLoading || isExporting) return;
    isLoading = true;
    errorMessage = '';
    resetOutputs();
    try {
      if (!(await hasPdfHeader(file))) {
        throw new Error('This file does not look like a valid PDF. Choose a PDF document and try again.');
      }
      const count = await getPdfPageCount(file);
      sourceFile = file;
      pageCount = count;
      pageSelection = '1-' + count;
      statusMessage = count + (count === 1 ? ' page ready to export.' : ' pages ready to export.');
    } catch (error) {
      sourceFile = null;
      pageCount = 0;
      pageSelection = '';
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

  function downloadBlob(blob: Blob, fileName: string) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
  }

  function downloadOutput(index: number) {
    const output = outputs[index];
    if (!output) return;
    downloadBlob(output.blob, output.fileName);
    statusMessage = 'Started download for page ' + output.pageNumber + '.';
  }

  async function downloadAllAsZip() {
    if (outputs.length === 0 || isZipping) return;
    isZipping = true;
    errorMessage = '';
    statusMessage = 'Preparing a ZIP archive locally…';
    try {
      const archive = await createStoredZip(outputs.map((output) => ({
        fileName: output.fileName,
        blob: output.blob
      })));
      const baseName = (sourceFile?.name ?? 'document').replace(/\.pdf$/i, '') || 'document';
      downloadBlob(archive, baseName + '-images.zip');
      statusMessage = outputs.length + ' images added to the ZIP archive.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The ZIP archive could not be created.';
      statusMessage = 'ZIP creation failed.';
    } finally {
      isZipping = false;
    }
  }

  async function exportImages() {
    if (!sourceFile || isLoading || isExporting) return;
    isExporting = true;
    resetOutputs();
    statusMessage = 'Preparing PDF pages locally…';
    try {
      const pages = parsePageRange(pageSelection, pageCount);
      const result = await exportPdfPagesToImages(
        sourceFile,
        { pages, format, dpi, quality },
        (completed, total, pageNumber) => {
          progress = Math.round((completed / total) * 100);
          statusMessage = 'Rendering page ' + pageNumber + ' (' + completed + ' of ' + total + ')…';
        }
      );
      outputs = result;
      statusMessage = result.length + (result.length === 1 ? ' image is ready.' : ' images are ready.');
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The PDF could not be converted. Try a lower resolution.';
      statusMessage = 'Conversion failed.';
    } finally {
      isExporting = false;
    }
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="PDF to images workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">PDF to Images</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Export selected pages or the entire document as PNG or JPEG. Processing stays on your device.</p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
      onclick={onClose}
    >← Back to tools</button>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-5 py-3 max-[600px]:px-3">
    <div class="min-w-0 text-[10px] text-muted">
      {#if sourceFile}
        <span class="font-semibold text-ink">{sourceFile.name}</span>
        <span class="ml-1">· {pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
      {:else}
        No PDF selected
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <input bind:this={fileInput} id="images-file-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50"
        disabled={isLoading || isExporting}
        onclick={() => fileInput?.click()}
      >{sourceFile ? 'Change PDF' : 'Choose PDF'}</button>
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={!sourceFile || isLoading || isExporting}
        onclick={exportImages}
      >{isLoading ? 'Opening…' : isExporting ? 'Converting…' : 'Convert pages'}</button>
    </div>
  </div>

  <div
    class="min-h-[300px] bg-canvas px-6 py-6 max-[600px]:px-3"
    role="region"
    aria-label="Image export settings"
    ondragover={(event) => event.preventDefault()}
    ondrop={handleDrop}
  >
    {#if !sourceFile && !isLoading}
      <div class="flex min-h-[230px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
        <span class="mb-3 grid size-[44px] place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden="true">
          <svg class="size-6" viewBox="0 0 24 24" fill="none"><path d="M5 4h9l5 5v11H5zM14 4v5h5M8 14h8M8 17h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <strong class="text-[13px] font-bold text-ink">Choose a PDF to convert</strong>
        <p class="mb-4 mt-1 max-w-[340px] text-[10px] leading-[1.6] text-muted">Select a document, choose pages and image quality, then export your pages as image files.</p>
        <button
          type="button"
          class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          onclick={() => fileInput?.click()}
        >Choose PDF</button>
        <span class="mt-3 text-[9px] text-subtle">You can also drop a PDF here.</span>
      </div>
    {:else if isLoading}
      <div class="flex min-h-[230px] items-center justify-center text-[11px] text-muted">Opening your PDF locally…</div>
    {:else}
      <div class="mx-auto max-w-[760px]">
        <div class="grid grid-cols-2 gap-3 max-[600px]:grid-cols-1">
          <label class="min-w-0">
            <span class="mb-1.5 block text-[10px] font-semibold text-ink">Pages to export</span>
            <input
              class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[11px] text-ink outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              type="text"
              inputmode="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="1-3, 5"
              aria-label="Pages to export"
              bind:value={pageSelection}
              disabled={isExporting}
            />
            <span class="mt-1 block text-[9px] text-muted">Use 1-3 or 1, 3-5. The default selects every page.</span>
          </label>
          <label class="min-w-0">
            <span class="mb-1.5 block text-[10px] font-semibold text-ink">Image format</span>
            <select
              class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[11px] text-ink outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              bind:value={format}
              disabled={isExporting}
            >
              <option value="png">PNG · Lossless</option>
              <option value="jpeg">JPEG · Smaller files</option>
            </select>
          </label>
          <label class="min-w-0">
            <span class="mb-1.5 block text-[10px] font-semibold text-ink">Resolution</span>
            <select
              class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[11px] text-ink outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              bind:value={dpi}
              disabled={isExporting}
            >
              <option value={72}>72 DPI · Screen</option>
              <option value={150}>150 DPI · Standard</option>
              <option value={200}>200 DPI · High</option>
              <option value={300}>300 DPI · Print</option>
            </select>
          </label>
          {#if format === 'jpeg'}
            <label class="min-w-0">
              <span class="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-ink">
                <span>JPEG quality</span><span>{Math.round(quality * 100)}%</span>
              </span>
              <input class="h-10 w-full accent-brand-700" type="range" min="0.5" max="1" step="0.05" bind:value={quality} disabled={isExporting} aria-label="JPEG quality" />
              <span class="mt-1 block text-[9px] text-muted">Higher quality creates larger files.</span>
            </label>
          {:else}
            <div class="flex items-center rounded-lg border border-line bg-surface px-3 py-2 text-[10px] leading-[1.5] text-muted">
              PNG preserves fine text and line detail without lossy compression.
            </div>
          {/if}
        </div>

        {#if isExporting}
          <div class="mt-5 rounded-xl border border-line bg-surface p-4">
            <div class="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold text-ink">
              <span>Rendering pages sequentially</span><span>{progress}%</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-canvas">
              <div class="h-full rounded-full bg-brand-600 transition-[width]" style={'width:' + progress + '%'}></div>
            </div>
            <p class="mb-0 mt-2 text-[9px] text-muted">Only one page canvas is rendered at a time to limit memory use.</p>
          </div>
        {/if}

        {#if outputs.length > 0}
          <section class="mt-6 border-t border-line pt-4" aria-label="Image downloads">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="mb-1 text-[13px] font-bold text-ink">Your images</h2>
                <p class="mb-0 text-[9px] text-muted">{outputs.length} {outputs.length === 1 ? 'image' : 'images'} · {format.toUpperCase()} · {dpi} DPI</p>
              </div>
              <button
                type="button"
                class="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-brand-700 px-3 text-[10px] font-bold text-white hover:bg-brand-800 disabled:opacity-50"
                disabled={isZipping}
                onclick={downloadAllAsZip}
              >{isZipping ? 'Preparing ZIP…' : 'Download all as ZIP'}</button>
            </div>
            <div class="grid gap-2">
              {#each outputs as output, index (output.pageNumber)}
                <div class="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3" data-image-output={output.pageNumber}>
                  <div class="min-w-0">
                    <div class="text-[11px] font-semibold text-ink">Page {output.pageNumber}</div>
                    <div class="mt-0.5 truncate text-[9px] text-muted">{output.fileName} · {(output.blob.size / 1024).toFixed(0)} KB</div>
                  </div>
                  <button
                    type="button"
                    class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-brand-700 hover:border-brand-300 hover:bg-brand-50"
                    aria-label={'Download page ' + output.pageNumber}
                    onclick={() => downloadOutput(index)}
                  >Download image</button>
                </div>
              {/each}
            </div>
          </section>
        {/if}
      </div>
    {/if}

    {#if errorMessage}
      <p class="mx-auto mb-0 mt-4 max-w-[760px] rounded-lg border border-danger-600/20 bg-danger-600/5 px-4 py-3 text-[10px] leading-[1.6] text-danger-600" role="alert">{errorMessage}</p>
    {/if}
    <p class="mb-0 mt-4 text-center text-[10px] text-muted" role="status" aria-live="polite">{statusMessage}</p>
  </div>

  <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4 text-[10px] text-muted max-[600px]:px-4">
    <span>Processing happens locally in your browser.</span>
    <span>Your source PDF is unchanged; images are new files.</span>
  </footer>
</section>

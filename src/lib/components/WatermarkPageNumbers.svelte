<script lang="ts">
  import { onDestroy } from 'svelte';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import { parsePageRange } from '$lib/pdf/split-pdf';
  import {
    formatPageNumber,
    getPdfPageGeometry,
    MAX_WATERMARK_IMAGE_BYTES,
    watermarkAndNumberPdf,
    type OverlayPosition,
    type PageNumberFormat
  } from '$lib/pdf/watermark-page-numbers';

  export let onClose: () => void;

  let sourceFile: File | null = null;
  let fileInput: HTMLInputElement;
  let imageInput: HTMLInputElement;
  let imageFile: File | null = null;
  let imagePreviewUrl = '';
  let pageCount = 0;
  let pageWidth = 595;
  let pageHeight = 842;
  let pageRotation = 0;
  let pageSelection = '';
  let includeTextWatermark = true;
  let watermarkText = 'DRAFT';
  let watermarkFontSize = 38;
  let watermarkColor = '#777777';
  let watermarkOpacity = 22;
  let watermarkRotation = -35;
  let watermarkPosition: OverlayPosition = 'center';
  let includeImageWatermark = false;
  let imageOpacity = 35;
  let imageScalePercent = 24;
  let imagePosition: OverlayPosition = 'center';
  let includePageNumbers = true;
  let pageNumberFormat: PageNumberFormat = 'page-of-total';
  let pageNumberStart = 1;
  let pageNumberFontSize = 10;
  let pageNumberColor = '#555555';
  let pageNumberPosition: OverlayPosition = 'bottom-center';
  let marginMm = 10;
  let isLoading = false;
  let isExporting = false;
  let progress = 0;
  let errorMessage = '';
  let statusMessage = 'Choose a PDF to add watermarks or page numbers.';
  let showAdvanced = false;

  $: previewPageNumber = pageCount > 0 && includePageNumbers
    ? formatPageNumber(1, pageCount, pageNumberFormat, pageNumberStart)
    : '';
  $: previewFontSize = Math.max(7, watermarkFontSize * 250 / Math.max(1, pageWidth));
  $: previewNumberSize = Math.max(7, pageNumberFontSize * 250 / Math.max(1, pageWidth));
  $: previewMarginX = Math.min(18, marginMm * 72 / 25.4 / Math.max(1, pageWidth) * 100);
  $: previewMarginY = Math.min(18, marginMm * 72 / 25.4 / Math.max(1, pageHeight) * 100);
  $: previewImageWidth = Math.min(80, imageScalePercent);

  function formatFileSize(size: number): string {
    if (size < 1_048_576) return Math.max(1, Math.round(size / 1_024)) + ' KB';
    return (size / 1_048_576).toFixed(2) + ' MB';
  }

  function setPreviewPosition(position: OverlayPosition, topOrBottom = true): string {
    const x = position.endsWith('left')
      ? 'left:' + previewMarginX + '%;'
      : position.endsWith('right')
        ? 'right:' + previewMarginX + '%;'
        : 'left:50%;';
    const y = position.startsWith('top')
      ? 'top:' + previewMarginY + '%;'
      : position.startsWith('bottom')
        ? 'bottom:' + previewMarginY + '%;'
        : 'top:50%;';
    const transform = position === 'center'
      ? 'translate(-50%,-50%)'
      : position.endsWith('center')
        ? 'translateX(-50%)'
        : 'none';
    return x + y + 'transform:' + transform + ';' + (topOrBottom ? '' : '');
  }

  function safeFileName(name: string): string {
    const baseName = name.replace(/\.pdf$/i, '');
    const safe = baseName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 75);
    return (safe || 'document') + '-watermarked.pdf';
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

  async function loadPdf(file?: File) {
    if (!file || isLoading || isExporting) return;
    isLoading = true;
    sourceFile = null;
    pageCount = 0;
    pageSelection = '';
    errorMessage = '';
    progress = 0;
    statusMessage = 'Checking the PDF locally…';
    try {
      if (file.size === 0) throw new Error('The selected PDF is empty.');
      if (file.size > 150 * 1024 * 1024) {
        throw new Error('This PDF is larger than the 150 MB local processing limit.');
      }
      if (!(await hasPdfHeader(file))) {
        throw new Error('This file does not look like a valid PDF. Choose a PDF document and try again.');
      }
      const geometry = await getPdfPageGeometry(file);
      sourceFile = file;
      pageCount = geometry.pageCount;
      pageWidth = geometry.width;
      pageHeight = geometry.height;
      pageRotation = geometry.rotation;
      pageSelection = '1-' + geometry.pageCount;
      statusMessage = file.name + ' is ready. Choose the overlays and pages to modify.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The PDF could not be opened.';
      statusMessage = 'Unable to open document.';
    } finally {
      isLoading = false;
    }
  }

  function handlePdfPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    void loadPdf(file);
  }

  function handlePdfDrop(event: DragEvent) {
    event.preventDefault();
    void loadPdf(event.dataTransfer?.files?.[0]);
  }

  async function loadImage(file?: File) {
    if (!file || isExporting) return;
    errorMessage = '';
    if (file.size === 0 || file.size > MAX_WATERMARK_IMAGE_BYTES) {
      errorMessage = 'Choose a non-empty PNG or JPEG image smaller than 15 MB.';
      return;
    }

    try {
      const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const isPng = header.length >= 8 && header[0] === 0x89 &&
        header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47 &&
        header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a;
      const isJpeg = header.length >= 3 && header[0] === 0xff &&
        header[1] === 0xd8 && header[2] === 0xff;
      if (!isPng && !isJpeg) {
        throw new Error('Use a PNG or JPEG image. WebP and other formats are not supported for PDF watermarks.');
      }
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      imageFile = file;
      imagePreviewUrl = URL.createObjectURL(file);
      includeImageWatermark = true;
      statusMessage = file.name + ' is ready as an image watermark.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The watermark image could not be read.';
    }
  }

  function handleImagePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    void loadImage(file);
  }

  function clearImage() {
    if (isExporting) return;
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = '';
    imageFile = null;
    includeImageWatermark = false;
  }

  function resetOutputs() {
    errorMessage = '';
    progress = 0;
  }

  async function exportDocument() {
    if (!sourceFile || isLoading || isExporting) return;
    if (!includeTextWatermark && !includeImageWatermark && !includePageNumbers) {
      errorMessage = 'Enable a text watermark, image watermark, or page numbering before exporting.';
      return;
    }
    if (includeTextWatermark && !watermarkText.trim()) {
      errorMessage = 'Enter the text to use as a watermark.';
      return;
    }
    if (includeImageWatermark && !imageFile) {
      errorMessage = 'Choose a PNG or JPEG image for the image watermark.';
      return;
    }

    isExporting = true;
    resetOutputs();
    statusMessage = 'Preparing a new PDF copy locally…';

    try {
      const pages = parsePageRange(pageSelection, pageCount);
      const result = await watermarkAndNumberPdf(sourceFile, {
        pages,
        marginMm,
        ...(includeTextWatermark ? {
          textWatermark: {
            text: watermarkText,
            fontSize: watermarkFontSize,
            color: watermarkColor,
            opacity: watermarkOpacity / 100,
            rotation: watermarkRotation,
            position: watermarkPosition
          }
        } : {}),
        ...(includeImageWatermark && imageFile ? {
          imageWatermark: {
            image: imageFile,
            opacity: imageOpacity / 100,
            scalePercent: imageScalePercent,
            position: imagePosition
          }
        } : {}),
        ...(includePageNumbers ? {
          pageNumbers: {
            format: pageNumberFormat,
            startNumber: pageNumberStart,
            fontSize: pageNumberFontSize,
            color: pageNumberColor,
            position: pageNumberPosition
          }
        } : {})
      }, (completed, total, pageNumber) => {
        progress = Math.round((completed / total) * 100);
        statusMessage = 'Applying overlays to page ' + pageNumber + ' (' + completed + ' of ' + total + ')…';
      });

      downloadBytes(result, safeFileName(sourceFile.name));
      statusMessage = 'Created a new PDF copy with overlays on ' + pages.length +
        (pages.length === 1 ? ' selected page.' : ' selected pages.') +
        ' Your original file is unchanged.';
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : 'The PDF could not be updated. Check the selected settings and try again.';
      statusMessage = 'PDF export failed.';
    } finally {
      isExporting = false;
    }
  }

  onDestroy(() => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  });
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="Watermark and page numbering workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">Watermark & Page Numbers</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Add text or image watermarks, number pages, preview placement, and export a separate PDF copy.</p>
    </div>
    <button type="button" class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" onclick={onClose}>← Back to tools</button>
  </header>

  <div class="grid gap-6 p-6 max-[600px]:p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
    <div class="min-w-0 space-y-5">
      <section aria-label="Source PDF" class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="m-0 text-[13px] font-bold text-ink">1. Choose a PDF</h2>
          {#if sourceFile}
            <button type="button" class="text-[10px] font-semibold text-brand-700 underline underline-offset-2 disabled:opacity-50" disabled={isLoading || isExporting} onclick={() => fileInput?.click()}>Change PDF</button>
          {/if}
        </div>
        <input bind:this={fileInput} class="sr-only" type="file" accept="application/pdf,.pdf" aria-label="Choose source PDF" onchange={handlePdfPick} />
        {#if sourceFile}
          <div class="flex flex-wrap items-center gap-3 rounded-xl border border-success-500/30 bg-success-500/5 p-3">
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-success-500/10 text-success-500" aria-hidden="true">PDF</span>
            <div class="min-w-0 flex-1">
              <p class="mb-0 truncate text-[11px] font-semibold text-ink">{sourceFile.name}</p>
              <p class="mb-0 mt-1 text-[10px] text-muted">{pageCount} pages · {formatFileSize(sourceFile.size)} · {Math.round(pageWidth)} × {Math.round(pageHeight)} pt</p>
            </div>
            <span class="text-[9px] font-semibold text-success-500">Ready</span>
          </div>
        {:else}
          <div class="rounded-xl border border-dashed border-line bg-canvas/50 px-4 py-7 text-center" ondragover={(event) => event.preventDefault()} ondrop={handlePdfDrop}>
            <p class="mb-1 text-[12px] font-semibold text-ink">{isLoading ? 'Opening PDF locally…' : 'Drop a PDF here'}</p>
            <p class="mb-3 text-[10px] text-muted">PDF files up to 150 MB. Your document stays on this device.</p>
            <button type="button" class="rounded-lg bg-brand-700 px-4 py-2 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50" disabled={isLoading} onclick={() => fileInput?.click()}>Choose PDF</button>
          </div>
        {/if}
      </section>

      <section aria-label="Page selection" class="rounded-xl border border-line p-4">
        <h2 class="mb-3 text-[13px] font-bold text-ink">2. Pages to modify</h2>
        <label class="mb-1.5 block text-[10px] font-semibold text-muted" for="watermark-page-range">Page range</label>
        <input id="watermark-page-range" class="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[12px] text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 disabled:opacity-50" bind:value={pageSelection} disabled={!sourceFile || isExporting} placeholder="1-3, 5, 7-9" />
        <p class="mb-0 mt-2 text-[10px] leading-[1.5] text-muted">Use page numbers and ascending ranges separated by commas, for example 1-3, 5. All pages remain in the output; only selected pages receive overlays.</p>
      </section>

      <section aria-label="Text watermark settings" class="rounded-xl border border-line p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="mb-0 text-[13px] font-bold text-ink">3. Text watermark</h2>
            <p class="mb-0 mt-1 text-[10px] text-muted">For labels such as DRAFT, CONFIDENTIAL or APPROVED.</p>
          </div>
          <label class="inline-flex items-center gap-2 text-[10px] font-semibold text-muted">
            <input type="checkbox" bind:checked={includeTextWatermark} disabled={!sourceFile || isExporting} />
            Enable
          </label>
        </div>
        {#if includeTextWatermark}
          <label for="watermark-text" class="mb-1.5 block text-[10px] font-semibold text-muted">Watermark text</label>
          <input id="watermark-text" class="mb-3 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[12px] text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200" bind:value={watermarkText} maxlength="120" disabled={!sourceFile || isExporting} placeholder="DRAFT" />
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="watermark-font-size" class="mb-1.5 block text-[10px] font-semibold text-muted">Font size (pt)</label>
              <input id="watermark-font-size" type="number" min="6" max="144" step="1" class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-ink" bind:value={watermarkFontSize} disabled={!sourceFile || isExporting} />
            </div>
            <div>
              <label for="watermark-color" class="mb-1.5 block text-[10px] font-semibold text-muted">Text color</label>
              <input id="watermark-color" type="color" class="h-[35px] w-full rounded-lg border border-line bg-surface p-1" bind:value={watermarkColor} disabled={!sourceFile || isExporting} />
            </div>
            <div>
              <label for="watermark-opacity" class="mb-1.5 block text-[10px] font-semibold text-muted">Opacity: {watermarkOpacity}%</label>
              <input id="watermark-opacity" type="range" min="5" max="100" step="1" class="w-full accent-brand-600" bind:value={watermarkOpacity} disabled={!sourceFile || isExporting} />
            </div>
            <div>
              <label for="watermark-rotation" class="mb-1.5 block text-[10px] font-semibold text-muted">Rotation (degrees)</label>
              <input id="watermark-rotation" type="number" min="-180" max="180" step="5" class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-ink" bind:value={watermarkRotation} disabled={!sourceFile || isExporting} />
            </div>
          </div>
          <div class="mt-3">
            <label for="watermark-position" class="mb-1.5 block text-[10px] font-semibold text-muted">Placement</label>
            <select id="watermark-position" class="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[11px] text-ink" bind:value={watermarkPosition} disabled={!sourceFile || isExporting}>
              <option value="center">Center</option>
              <option value="top-left">Top left</option>
              <option value="top-center">Top center</option>
              <option value="top-right">Top right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-center">Bottom center</option>
              <option value="bottom-right">Bottom right</option>
            </select>
          </div>
        {/if}
      </section>

      <section aria-label="Image watermark settings" class="rounded-xl border border-line p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="mb-0 text-[13px] font-bold text-ink">4. Image watermark</h2>
            <p class="mb-0 mt-1 text-[10px] text-muted">Add a logo or seal as a transparent overlay.</p>
          </div>
          <label class="inline-flex items-center gap-2 text-[10px] font-semibold text-muted">
            <input type="checkbox" bind:checked={includeImageWatermark} disabled={!sourceFile || !imageFile || isExporting} />
            Enable
          </label>
        </div>
        <input bind:this={imageInput} class="sr-only" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" aria-label="Choose watermark image" onchange={handleImagePick} />
        <div class="flex flex-wrap items-center gap-3">
          {#if imagePreviewUrl}
            <img src={imagePreviewUrl} alt="Selected watermark preview" class="h-12 max-w-24 rounded border border-line bg-canvas object-contain p-1" />
          {/if}
          <button type="button" class="rounded-lg border border-line bg-surface px-3 py-2 text-[10px] font-semibold text-muted hover:border-brand-300 hover:text-brand-700 disabled:opacity-50" disabled={!sourceFile || isExporting} onclick={() => imageInput?.click()}>{imageFile ? 'Change image' : 'Choose PNG or JPEG'}</button>
          {#if imageFile}
            <span class="min-w-0 flex-1 truncate text-[10px] text-muted">{imageFile.name}</span>
            <button type="button" class="text-[10px] font-semibold text-danger-600 underline underline-offset-2" disabled={isExporting} onclick={clearImage}>Remove</button>
          {/if}
        </div>
        {#if imageFile}
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label for="image-watermark-size" class="mb-1.5 block text-[10px] font-semibold text-muted">Maximum page width: {imageScalePercent}%</label>
              <input id="image-watermark-size" type="range" min="5" max="80" step="1" class="w-full accent-brand-600" bind:value={imageScalePercent} disabled={!includeImageWatermark || isExporting} />
            </div>
            <div>
              <label for="image-watermark-opacity" class="mb-1.5 block text-[10px] font-semibold text-muted">Opacity: {imageOpacity}%</label>
              <input id="image-watermark-opacity" type="range" min="5" max="100" step="1" class="w-full accent-brand-600" bind:value={imageOpacity} disabled={!includeImageWatermark || isExporting} />
            </div>
            <div class="col-span-2">
              <label for="image-watermark-position" class="mb-1.5 block text-[10px] font-semibold text-muted">Placement</label>
              <select id="image-watermark-position" class="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[11px] text-ink" bind:value={imagePosition} disabled={!includeImageWatermark || isExporting}>
                <option value="center">Center</option>
                <option value="top-left">Top left</option>
                <option value="top-center">Top center</option>
                <option value="top-right">Top right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-center">Bottom center</option>
                <option value="bottom-right">Bottom right</option>
              </select>
            </div>
          </div>
        {/if}
      </section>

      <section aria-label="Page numbering settings" class="rounded-xl border border-line p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="mb-0 text-[13px] font-bold text-ink">5. Page numbers</h2>
            <p class="mb-0 mt-1 text-[10px] text-muted">Number the original page positions in the selected range.</p>
          </div>
          <label class="inline-flex items-center gap-2 text-[10px] font-semibold text-muted">
            <input type="checkbox" bind:checked={includePageNumbers} disabled={!sourceFile || isExporting} />
            Enable
          </label>
        </div>
        {#if includePageNumbers}
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="page-number-format" class="mb-1.5 block text-[10px] font-semibold text-muted">Number format</label>
              <select id="page-number-format" class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-ink" bind:value={pageNumberFormat} disabled={!sourceFile || isExporting}>
                <option value="page-of-total">Page 1 of 10</option>
                <option value="slash-total">1 / 10</option>
                <option value="number">1</option>
              </select>
            </div>
            <div>
              <label for="page-number-start" class="mb-1.5 block text-[10px] font-semibold text-muted">Start numbering at</label>
              <input id="page-number-start" type="number" min="1" max="999999" class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-ink" bind:value={pageNumberStart} disabled={!sourceFile || isExporting} />
            </div>
            <div>
              <label for="page-number-size" class="mb-1.5 block text-[10px] font-semibold text-muted">Font size (pt)</label>
              <input id="page-number-size" type="number" min="6" max="48" class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-ink" bind:value={pageNumberFontSize} disabled={!sourceFile || isExporting} />
            </div>
            <div>
              <label for="page-number-color" class="mb-1.5 block text-[10px] font-semibold text-muted">Text color</label>
              <input id="page-number-color" type="color" class="h-[35px] w-full rounded-lg border border-line bg-surface p-1" bind:value={pageNumberColor} disabled={!sourceFile || isExporting} />
            </div>
            <div class="col-span-2">
              <label for="page-number-position" class="mb-1.5 block text-[10px] font-semibold text-muted">Placement</label>
              <select id="page-number-position" class="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[11px] text-ink" bind:value={pageNumberPosition} disabled={!sourceFile || isExporting}>
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-center">Bottom center</option>
                <option value="bottom-right">Bottom right</option>
                <option value="top-center">Top center</option>
              </select>
            </div>
          </div>
        {/if}
      </section>

      <section class="rounded-xl border border-line p-4" aria-label="Margins and advanced settings">
        <button type="button" class="flex w-full items-center justify-between text-left" aria-expanded={showAdvanced} onclick={() => (showAdvanced = !showAdvanced)}>
          <span class="text-[12px] font-bold text-ink">Margins & advanced settings</span>
          <span class="text-[10px] font-semibold text-brand-700">{showAdvanced ? 'Hide' : 'Show'}</span>
        </button>
        {#if showAdvanced}
          <div class="mt-3 max-w-[220px]">
            <label for="overlay-margin" class="mb-1.5 block text-[10px] font-semibold text-muted">Edge margin (mm)</label>
            <input id="overlay-margin" type="number" min="0" max="100" step="1" class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-ink" bind:value={marginMm} disabled={!sourceFile || isExporting} />
          </div>
          <p class="mb-0 mt-2 text-[10px] leading-[1.5] text-muted">The margin applies to edge-anchored overlays. Centered watermarks remain centered on each page.</p>
        {/if}
      </section>

      {#if errorMessage}
        <p class="rounded-lg border border-danger-600/20 bg-danger-600/5 px-3 py-2.5 text-[11px] leading-[1.5] text-danger-600" role="alert">{errorMessage}</p>
      {/if}
      <div class="rounded-xl border border-line bg-canvas/60 p-3">
        <div class="flex items-center justify-between gap-3">
          <p class="mb-0 text-[10px] leading-[1.5] text-muted" role="status" aria-live="polite">{statusMessage}</p>
          {#if isExporting}
            <span class="shrink-0 text-[10px] font-bold tabular-nums text-brand-700">{progress}%</span>
          {/if}
        </div>
        {#if isExporting}
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div class="h-full rounded-full bg-brand-600 transition-[width]" style={'width:' + progress + '%'}></div>
          </div>
        {/if}
      </div>
      <button type="button" class="inline-flex min-h-[42px] w-full items-center justify-center rounded-lg bg-brand-700 px-4 text-[11px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={!sourceFile || isLoading || isExporting || (!includeTextWatermark && !includeImageWatermark && !includePageNumbers)} onclick={exportDocument}>
        {isExporting ? 'Creating PDF…' : 'Apply overlays & download PDF'}
      </button>
      <p class="mb-0 text-center text-[9px] leading-[1.5] text-muted">Creates a new PDF. The original file is never overwritten or uploaded.</p>
    </div>

    <aside class="min-w-0 space-y-3 lg:sticky lg:top-5 lg:self-start" aria-label="Overlay placement preview">
      <div>
        <h2 class="mb-1 text-[13px] font-bold text-ink">Placement preview</h2>
        <p class="mb-0 text-[10px] leading-[1.5] text-muted">A scaled page guide. Overlay position, size, color and opacity update as you edit the settings.</p>
      </div>
      <div class="mx-auto flex min-h-[300px] items-center justify-center rounded-xl border border-line bg-canvas p-4">
        <div class="relative w-full max-w-[230px] overflow-hidden rounded-[2px] bg-white shadow-[0_5px_18px_rgb(0_0_0_/_0.12)]" style={'aspect-ratio:' + pageWidth + '/' + pageHeight}>
          <div class="absolute left-[9%] right-[9%] top-[12%] space-y-[5%] opacity-40" aria-hidden="true">
            <div class="h-[5px] w-[56%] rounded bg-[#c9cdd5]"></div>
            <div class="h-[3px] w-full rounded bg-[#d8dbe1]"></div>
            <div class="h-[3px] w-[92%] rounded bg-[#d8dbe1]"></div>
            <div class="h-[3px] w-[98%] rounded bg-[#d8dbe1]"></div>
            <div class="h-[3px] w-[74%] rounded bg-[#d8dbe1]"></div>
            <div class="mt-[10%] h-[3px] w-full rounded bg-[#e2e4e9]"></div>
            <div class="h-[3px] w-[85%] rounded bg-[#e2e4e9]"></div>
            <div class="h-[3px] w-[96%] rounded bg-[#e2e4e9]"></div>
          </div>
          {#if includeTextWatermark && watermarkText.trim()}
            <div class="pointer-events-none absolute z-10 whitespace-nowrap font-bold" style={setPreviewPosition(watermarkPosition) + 'font-size:' + previewFontSize + 'px;color:' + watermarkColor + ';opacity:' + (watermarkOpacity / 100) + ';transform:' + (watermarkPosition === 'center' ? 'translate(-50%,-50%)' : watermarkPosition.endsWith('center') ? 'translateX(-50%)' : 'none') + ' rotate(' + watermarkRotation + 'deg);'}>{watermarkText}</div>
          {/if}
          {#if includeImageWatermark && imagePreviewUrl}
            <div class="pointer-events-none absolute z-10 flex items-center justify-center" style={setPreviewPosition(imagePosition)}>
              <img src={imagePreviewUrl} alt="" class="block h-auto max-h-[100px] object-contain" style={'width:' + previewImageWidth + '%;opacity:' + (imageOpacity / 100)} />
            </div>
          {/if}
          {#if includePageNumbers && pageCount > 0}
            <div class="pointer-events-none absolute z-20 whitespace-nowrap font-medium" style={setPreviewPosition(pageNumberPosition) + 'font-size:' + previewNumberSize + 'px;color:' + pageNumberColor + ';opacity:.95;' + (pageNumberPosition.endsWith('center') ? 'transform:translateX(-50%);' : '')}>{previewPageNumber}</div>
          {/if}
          <span class="absolute bottom-1 right-2 text-[7px] text-[#a3a3a3]">Preview</span>
        </div>
      </div>
      {#if sourceFile}
        <div class="rounded-lg border border-line bg-surface p-3">
          <p class="mb-1 text-[10px] font-semibold text-ink">Output summary</p>
          <p class="mb-0 text-[10px] leading-[1.6] text-muted">{pageCount} original pages · selected range: {pageSelection || 'not set'}</p>
          <p class="mb-0 mt-1 text-[10px] leading-[1.6] text-muted">{pageRotation ? 'First page rotation: ' + pageRotation + '° · ' : ''}{(includeTextWatermark ? 1 : 0) + (includeImageWatermark ? 1 : 0) + (includePageNumbers ? 1 : 0)} overlay type(s) enabled</p>
        </div>
      {/if}
    </aside>
  </div>
</section>

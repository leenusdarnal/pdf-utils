<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { PDFDocument } from 'pdf-lib';
  import { createPdfDocumentTask, type PdfDocument, type PdfDocumentTask, type PdfRenderTask } from '$lib/pdf/pdfjs-client';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import {
    addPdfContentOverlay,
    MAX_CONTENT_OVERLAY_FILE_BYTES,
    MAX_CONTENT_OVERLAY_IMAGE_BYTES,
    type PdfContentOverlay
  } from '$lib/pdf/content-overlays';

  export let onClose: () => void;

  interface PageInfo {
    width: number;
    height: number;
    rotation: number;
  }

  let sourceFile: File | null = null;
  let pageInfos: PageInfo[] = [];
  let pageNumber = 1;
  let selectedPageInfo: PageInfo | undefined;
  let isRotatedPage = false;
  let canExport = false;
  let overlayType: 'text' | 'image' = 'text';
  let text = 'Your text';
  let fontSize = 24;
  let textColor = '#c62828';
  let xPercent = 10;
  let yPercent = 10;
  let imageWidthPercent = 25;
  let imageFile: File | null = null;
  let imageType: 'png' | 'jpeg' | null = null;
  let imagePreviewUrl = '';
  let fileInput: HTMLInputElement;
  let imageInput: HTMLInputElement;
  let previewCanvas: HTMLCanvasElement;
  let previewDocument: PdfDocument | null = null;
  let previewLoadingTask: PdfDocumentTask | null = null;
  let previewRenderTask: PdfRenderTask | null = null;
  let renderSequence = 0;
  let previewPageWidth = 0;
  let previewScale = 1;
  let isLoading = false;
  let isRendering = false;
  let isExporting = false;
  let outputBlob: Blob | null = null;
  let outputName = '';
  let outputSize = 0;
  let errorMessage = '';
  let statusMessage = 'Choose a PDF to place a text or image overlay on a new copy.';

  $: selectedPageInfo = pageInfos[pageNumber - 1];
  $: isRotatedPage = Boolean(selectedPageInfo && selectedPageInfo.rotation !== 0);
  $: canExport = Boolean(
    sourceFile &&
    !isLoading &&
    !isRendering &&
    !isExporting &&
    !isRotatedPage &&
    (overlayType === 'text' ? text.trim().length > 0 : imageFile && imageType)
  );

  function resetOutput() {
    outputBlob = null;
    outputName = '';
    outputSize = 0;
    errorMessage = '';
  }

  function revokeImagePreview() {
    if (!imagePreviewUrl) return;
    URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = '';
  }

  async function disposePreview() {
    renderSequence += 1;
    if (previewRenderTask) {
      try {
        previewRenderTask.cancel();
      } catch {
        // The render task may already have completed.
      }
      previewRenderTask = null;
    }
    if (previewLoadingTask) {
      const task = previewLoadingTask;
      previewLoadingTask = null;
      previewDocument = null;
      try {
        await task.destroy();
      } catch {
        // Cleanup is best-effort when PDF.js has already released the document.
      }
    } else {
      previewDocument = null;
    }
  }

  async function renderPreview() {
    if (!previewDocument || !sourceFile) return;
    await tick();
    if (!previewCanvas) return;

    const sequence = ++renderSequence;
    if (previewRenderTask) {
      try {
        previewRenderTask.cancel();
      } catch {
        // Ignore a render task that has already completed.
      }
      previewRenderTask = null;
    }

    isRendering = true;
    try {
      const page = await previewDocument.getPage(pageNumber);
      if (sequence !== renderSequence || !previewCanvas) {
        page.cleanup();
        return;
      }

      const unitViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1, 680 / unitViewport.width);
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);

      previewCanvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      previewCanvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      previewCanvas.style.width = Math.floor(viewport.width) + 'px';
      previewCanvas.style.height = Math.floor(viewport.height) + 'px';
      previewCanvas.style.maxWidth = '100%';
      previewCanvas.style.objectFit = 'contain';

      const activeTask = page.render({
        canvas: previewCanvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
      });
      previewRenderTask = activeTask;
      await activeTask.promise;

      if (sequence !== renderSequence) return;
      previewPageWidth = unitViewport.width;
      await tick();
      previewScale = previewPageWidth > 0
        ? previewCanvas.clientWidth / previewPageWidth
        : scale;
      statusMessage = 'Page ' + pageNumber + ' of ' + pageInfos.length + ' ready for preview.';
    } catch (error) {
      if (sequence !== renderSequence) return;
      const name = error instanceof Error ? error.name : '';
      if (name !== 'RenderingCancelledException') {
        errorMessage = 'This page preview could not be rendered. Try another page or reopen the PDF.';
        statusMessage = 'Preview failed.';
      }
    } finally {
      if (sequence === renderSequence) {
        previewRenderTask = null;
        isRendering = false;
      }
    }
  }

  async function loadFile(file?: File) {
    if (!file || isLoading || isExporting) return;
    isLoading = true;
    resetOutput();
    sourceFile = null;
    pageInfos = [];
    pageNumber = 1;
    await disposePreview();

    try {
      if (file.size === 0) throw new Error('Choose a non-empty PDF file.');
      if (file.size > MAX_CONTENT_OVERLAY_FILE_BYTES) {
        throw new Error('This PDF exceeds the 150 MB limit.');
      }
      if (!(await hasPdfHeader(file))) throw new Error('This file does not look like a valid PDF.');

      let parsedDocument;
      try {
        parsedDocument = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      } catch {
        throw new Error('This PDF could not be opened. It may be damaged, encrypted, or unsupported.');
      }

      const pages = parsedDocument.getPages();
      if (pages.length < 1) throw new Error('This PDF does not contain any pages.');
      if (pages.length > 500) throw new Error('This tool supports up to 500 pages per PDF.');

      pageInfos = pages.map((page) => {
        const crop = page.getCropBox();
        return {
          width: crop.width,
          height: crop.height,
          rotation: ((page.getRotation().angle % 360) + 360) % 360
        };
      });

      const task = await createPdfDocumentTask(file);
      previewLoadingTask = task;
      previewDocument = await task.promise;
      sourceFile = file;
      statusMessage = pages.length + (pages.length === 1 ? ' page loaded.' : ' pages loaded.');
      await renderPreview();
    } catch (error) {
      sourceFile = null;
      pageInfos = [];
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

  async function changePage(event: Event) {
    pageNumber = Number((event.currentTarget as HTMLSelectElement).value);
    resetOutput();
    await renderPreview();
  }

  async function handleImagePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    resetOutput();
    revokeImagePreview();

    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      imageFile = null;
      imageType = null;
      errorMessage = 'Choose a non-empty PNG or JPEG image under 25 MB.';
      return;
    }

    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isPng = header.length >= 8 &&
      header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e &&
      header[3] === 0x47 && header[4] === 0x0d && header[5] === 0x0a &&
      header[6] === 0x1a && header[7] === 0x0a;
    const isJpeg = header.length >= 3 &&
      header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;

    if (!isPng && !isJpeg) {
      imageFile = null;
      imageType = null;
      errorMessage = 'This image is not a valid PNG or JPEG file.';
      return;
    }

    imageFile = file;
    imageType = isPng ? 'png' : 'jpeg';
    imagePreviewUrl = URL.createObjectURL(file);
    errorMessage = '';
    statusMessage = 'Image ready. Adjust its position and width in the preview.';
  }

  function markOverlayChanged() {
    resetOutput();
  }

  async function exportPdf() {
    if (!sourceFile || !canExport) return;
    resetOutput();
    isExporting = true;
    statusMessage = 'Adding a new content layer to a PDF copy locally…';

    try {
      let overlay: PdfContentOverlay;
      if (overlayType === 'text') {
        overlay = {
          type: 'text',
          pageNumber,
          xPercent,
          yPercent,
          text,
          fontSize,
          color: textColor
        };
      } else {
        if (!imageFile || !imageType) throw new Error('Choose a PNG or JPEG image first.');
        overlay = {
          type: 'image',
          pageNumber,
          xPercent,
          yPercent,
          widthPercent: imageWidthPercent,
          imageType,
          imageBytes: new Uint8Array(await imageFile.arrayBuffer())
        };
      }

      const result = await addPdfContentOverlay(sourceFile, overlay);
      const bytes = new Uint8Array(result.bytes.byteLength);
      bytes.set(result.bytes);
      outputBlob = new Blob([bytes.buffer], { type: 'application/pdf' });
      const baseName = sourceFile.name
        .replace(/\.pdf$/i, '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .trim()
        .slice(0, 100) || 'document';
      outputName = baseName + '-with-overlay.pdf';
      outputSize = result.fileSize;
      statusMessage = 'Overlay exported to a new PDF. Your original file is unchanged.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The PDF could not be exported.';
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

  onDestroy(() => {
    void disposePreview();
    revokeImagePreview();
  });
</script>

<section
  class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]"
  aria-label="Text and image overlay workspace"
  ondragover={(event) => event.preventDefault()}
  ondrop={handleDrop}
>
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">Add Text &amp; Images</h1>
      <p class="mb-0 mt-1 max-w-[590px] text-[11px] leading-[1.6] text-muted">Place a new text or image layer on a page and export a separate PDF copy.</p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
      onclick={onClose}
    >← Back to tools</button>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-muted px-5 py-3 max-[600px]:px-3">
    <div class="min-w-0 text-[10px] text-muted">
      {#if sourceFile}
        <span class="font-semibold text-ink">{sourceFile.name}</span>
        <span class="ml-1">· {pageInfos.length} {pageInfos.length === 1 ? 'page' : 'pages'}</span>
      {:else}
        No PDF selected
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <input bind:this={fileInput} id="content-overlay-file-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-ink transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50"
        disabled={isLoading || isExporting}
        onclick={() => fileInput?.click()}
      >{sourceFile ? 'Change PDF' : 'Choose PDF'}</button>
    </div>
  </div>

  <div class="grid gap-5 bg-surface-muted p-5 lg:grid-cols-[minmax(0,1fr)_300px] max-[600px]:p-3">
    <div class="min-w-0">
      {#if !sourceFile && isLoading}
        <div class="flex min-h-[360px] items-center justify-center rounded-xl border border-line bg-surface text-[12px] text-muted">Opening your PDF locally…</div>
      {:else if !sourceFile}
        <div class="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-5 py-10 text-center">
          <span class="mb-3 grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-700" aria-hidden="true">PDF</span>
          <strong class="text-[13px] font-bold text-ink">Choose a PDF to begin</strong>
          <p class="mb-4 mt-1 max-w-[360px] text-[10px] leading-[1.6] text-muted">The PDF is opened locally in your browser. You can also drop a file anywhere in this workspace.</p>
          <button type="button" class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" onclick={() => fileInput?.click()}>Choose PDF</button>
        </div>
      {:else}
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="m-0 text-[12px] font-bold text-ink">Live page preview</h2>
            <p class="mb-0 mt-1 text-[10px] text-muted">The page preview shows where the new content will be placed.</p>
          </div>
          <label class="flex items-center gap-2 text-[10px] font-semibold text-muted">
            Page
            <select class="h-8 rounded-lg border border-line bg-surface px-2 text-ink" aria-label="Preview page" value={pageNumber} onchange={changePage} disabled={isExporting}>
              {#each pageInfos as info, index}
                <option value={index + 1}>Page {index + 1}</option>
              {/each}
            </select>
          </label>
        </div>
        <div class="flex min-h-[360px] items-center justify-center overflow-auto rounded-xl border border-line bg-[#e8eaf0] p-3">
          <div class="relative w-fit max-w-full bg-white shadow-md" style={'width:' + Math.min(680, Math.max(1, previewPageWidth * Math.min(1, 680 / Math.max(1, previewPageWidth)))) + 'px;'}>
            <canvas bind:this={previewCanvas} width="1" height="1" class="block h-auto max-w-full" aria-label="PDF page preview"></canvas>
            {#if overlayType === 'text' && text.trim() && !isRotatedPage}
              <div
                class="pointer-events-none absolute whitespace-pre-wrap leading-[1.2]"
                style={'left:' + xPercent + '%;bottom:' + yPercent + '%;font-size:' + (fontSize * previewScale) + 'px;color:' + textColor + ';'}
                aria-hidden="true"
              >{text}</div>
            {:else if overlayType === 'image' && imagePreviewUrl && !isRotatedPage}
              <img
                src={imagePreviewUrl}
                alt="Image overlay preview"
                class="pointer-events-none absolute h-auto object-contain"
                style={'left:' + xPercent + '%;bottom:' + yPercent + '%;width:' + imageWidthPercent + '%;'}
              />
            {/if}
          </div>
        </div>
        {#if isRendering}
          <p class="mt-2 text-[10px] text-muted" role="status">Rendering page preview…</p>
        {/if}
        {#if isRotatedPage}
          <p class="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] leading-[1.6] text-amber-900" role="status">
            This page is rotated {selectedPageInfo?.rotation}°. Text and image placement on rotated pages is not supported in this first release. Select an unrotated page to export an overlay.
          </p>
        {/if}
      {/if}
    </div>

    <aside class="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div>
        <h2 class="m-0 text-[12px] font-bold text-ink">Overlay settings</h2>
        <p class="mb-0 mt-1 text-[10px] leading-[1.6] text-muted">Coordinates are percentages of the visible page area, measured from the bottom-left corner.</p>
      </div>

      <div class="grid grid-cols-2 gap-2" role="group" aria-label="Overlay type">
        <button type="button" class={overlayType === 'text' ? 'min-h-9 rounded-lg border border-brand-500 bg-brand-50 px-2 text-[10px] font-semibold text-brand-800' : 'min-h-9 rounded-lg border border-line bg-surface px-2 text-[10px] font-semibold text-muted'} aria-pressed={overlayType === 'text'} onclick={() => { overlayType = 'text'; markOverlayChanged(); }}>Text</button>
        <button type="button" class={overlayType === 'image' ? 'min-h-9 rounded-lg border border-brand-500 bg-brand-50 px-2 text-[10px] font-semibold text-brand-800' : 'min-h-9 rounded-lg border border-line bg-surface px-2 text-[10px] font-semibold text-muted'} aria-pressed={overlayType === 'image'} onclick={() => { overlayType = 'image'; markOverlayChanged(); }}>Image</button>
      </div>

      {#if overlayType === 'text'}
        <label class="grid gap-1 text-[10px] font-semibold text-muted">
          Text to insert
          <textarea class="min-h-20 resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[11px] font-normal text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" maxlength="1000" bind:value={text} oninput={markOverlayChanged}></textarea>
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="grid gap-1 text-[10px] font-semibold text-muted">
            Font size (pt)
            <input class="h-9 w-full rounded-lg border border-line bg-surface px-2 text-[11px] text-ink" type="number" min="6" max="96" step="1" bind:value={fontSize} oninput={markOverlayChanged} />
          </label>
          <label class="grid gap-1 text-[10px] font-semibold text-muted">
            Text color
            <input class="h-9 w-full rounded-lg border border-line bg-surface p-1" type="color" aria-label="Text color" bind:value={textColor} onchange={markOverlayChanged} />
          </label>
        </div>
        <p class="m-0 text-[9px] leading-[1.5] text-muted">Uses Helvetica. Standard fonts support a limited Latin character set; unsupported characters are rejected.</p>
      {:else}
        <label class="grid gap-1 text-[10px] font-semibold text-muted">
          Image file
          <input bind:this={imageInput} class="block w-full text-[10px] text-muted file:mr-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-[10px] file:font-semibold file:text-brand-800" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onchange={handleImagePick} />
        </label>
        {#if imageFile}
          <p class="m-0 break-all text-[9px] text-muted">{imageFile.name} · {Math.max(1, Math.round(imageFile.size / 1024))} KB</p>
        {/if}
        <label class="grid gap-1 text-[10px] font-semibold text-muted">
          Image width (% of page)
          <input class="h-9 rounded-lg border border-line bg-surface px-2 text-[11px] text-ink" type="number" min="1" max="100" step="1" bind:value={imageWidthPercent} oninput={markOverlayChanged} />
        </label>
        <p class="m-0 text-[9px] leading-[1.5] text-muted">PNG and JPEG only. Image height keeps the file's original aspect ratio.</p>
      {/if}

      <div class="grid grid-cols-2 gap-2">
        <label class="grid gap-1 text-[10px] font-semibold text-muted">
          X from left (%)
          <input class="h-9 w-full rounded-lg border border-line bg-surface px-2 text-[11px] text-ink" type="number" min="0" max="100" step="1" bind:value={xPercent} oninput={markOverlayChanged} />
        </label>
        <label class="grid gap-1 text-[10px] font-semibold text-muted">
          Y from bottom (%)
          <input class="h-9 w-full rounded-lg border border-line bg-surface px-2 text-[11px] text-ink" type="number" min="0" max="100" step="1" bind:value={yPercent} oninput={markOverlayChanged} />
        </label>
      </div>

      <button
        type="button"
        class="mt-1 inline-flex min-h-10 items-center justify-center rounded-lg bg-brand-700 px-4 text-[11px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={!canExport}
        onclick={exportPdf}
      >{isExporting ? 'Exporting…' : 'Export new PDF copy'}</button>

      <p class="m-0 text-[9px] leading-[1.6] text-muted">This inserts a new content layer. It does not edit or replace existing PDF text. Your source PDF remains unchanged.</p>
    </aside>
  </div>

  <div class="border-t border-line bg-surface px-5 py-3 max-[600px]:px-3" aria-live="polite" aria-atomic="true">
    <p class="m-0 text-[10px] text-muted" role="status">{statusMessage}</p>
    {#if errorMessage}
      <p class="mb-0 mt-1 text-[10px] text-danger-600" role="alert">{errorMessage}</p>
    {/if}
    {#if outputBlob}
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success-200 bg-success-50 p-3">
        <div class="min-w-0">
          <strong class="block break-all text-[11px] text-success-900">New PDF copy ready</strong>
          <span class="text-[9px] text-success-800">{outputName} · {Math.max(1, Math.round(outputSize / 1024))} KB</span>
        </div>
        <button type="button" class="inline-flex min-h-9 items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" onclick={downloadOutput}>Download PDF</button>
      </div>
    {/if}
  </div>
</section>

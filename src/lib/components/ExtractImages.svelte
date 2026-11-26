<script lang="ts">
  import { onDestroy } from 'svelte';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import {
    extractEmbeddedImages,
    MAX_EMBEDDED_IMAGE_FILE_BYTES,
    type ExtractedPdfImage
  } from '$lib/pdf/extract-embedded-images';
  import { createStoredZip } from '$lib/pdf/zip';

  export let onClose: () => void;

  interface ImagePreview extends ExtractedPdfImage {
    previewUrl: string;
  }

  let sourceFile: File | null = null;
  let fileInput: HTMLInputElement;
  let images: ImagePreview[] = [];
  let pageCount = 0;
  let skippedImages = 0;
  let isLoading = false;
  let isExtracting = false;
  let isZipping = false;
  let progress = 0;
  let errorMessage = '';
  let statusMessage = 'Choose a PDF to extract its embedded images.';

  function clearImages() {
    for (const image of images) URL.revokeObjectURL(image.previewUrl);
    images = [];
    pageCount = 0;
    skippedImages = 0;
    progress = 0;
  }

  function clearSource() {
    if (isLoading || isExtracting || isZipping) return;
    sourceFile = null;
    clearImages();
    errorMessage = '';
    statusMessage = 'Choose a PDF to extract its embedded images.';
  }

  async function loadFile(file: File | undefined) {
    if (!file || isLoading || isExtracting || isZipping) return;
    errorMessage = '';
    clearImages();
    sourceFile = null;

    if (file.size === 0) {
      errorMessage = 'The selected PDF is empty.';
      statusMessage = 'Choose a valid PDF file.';
      return;
    }
    if (file.size > MAX_EMBEDDED_IMAGE_FILE_BYTES) {
      errorMessage = 'This PDF is larger than the 150 MB extraction limit.';
      statusMessage = 'Choose a smaller PDF file.';
      return;
    }

    isLoading = true;
    statusMessage = 'Checking the PDF locally…';
    try {
      if (!(await hasPdfHeader(file))) {
        throw new Error('This file does not look like a valid PDF. Choose a PDF document and try again.');
      }
      sourceFile = file;
      statusMessage = file.name + ' is ready. Extract embedded image objects from the document.';
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

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }

  function downloadImage(index: number) {
    const image = images[index];
    if (!image) return;
    downloadBlob(image.blob, image.fileName);
    statusMessage = 'Started download for ' + image.fileName + '.';
  }

  async function downloadAllAsZip() {
    if (images.length === 0 || isZipping) return;
    isZipping = true;
    errorMessage = '';
    statusMessage = 'Preparing an image archive locally…';
    try {
      const archive = await createStoredZip(images.map((image) => ({
        fileName: image.fileName,
        blob: image.blob
      })));
      const name = (sourceFile?.name ?? 'document').replace(/\.pdf$/i, '') || 'document';
      downloadBlob(archive, name + '-embedded-images.zip');
      statusMessage = images.length + ' embedded images added to the ZIP archive.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The ZIP archive could not be created.';
      statusMessage = 'ZIP creation failed.';
    } finally {
      isZipping = false;
    }
  }

  async function runExtraction() {
    if (!sourceFile || isLoading || isExtracting) return;
    isExtracting = true;
    clearImages();
    errorMessage = '';
    statusMessage = 'Inspecting PDF image objects locally…';

    try {
      const result = await extractEmbeddedImages(sourceFile, (update) => {
        progress = Math.round((update.completedPages / update.totalPages) * 100);
        statusMessage = 'Inspecting page ' + update.pageNumber + ' of ' + update.totalPages +
          ' · ' + update.foundImages + ' image(s) found.';
      });
      pageCount = result.pageCount;
      skippedImages = result.skippedImages;
      images = result.images.map((image) => ({
        ...image,
        previewUrl: URL.createObjectURL(image.blob)
      }));

      if (images.length === 0) {
        statusMessage = 'No supported embedded image objects were found in this PDF.';
      } else {
        statusMessage = images.length + (images.length === 1 ? ' image extracted.' : ' images extracted.') +
          (skippedImages > 0 ? ' ' + skippedImages + ' image object(s) were skipped.' : '');
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The PDF images could not be extracted.';
      statusMessage = 'Image extraction failed.';
    } finally {
      isExtracting = false;
    }
  }

  onDestroy(clearImages);
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="Extract embedded images workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">Extract Embedded Images</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Recover image objects stored in a PDF, rather than exporting screenshots of its pages.</p>
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
        <span class="ml-1">· {pageCount || 'PDF'} {pageCount === 1 ? 'page' : pageCount ? 'pages' : ''}</span>
      {:else}
        No PDF selected
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <input bind:this={fileInput} id="extract-images-pdf-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50"
        disabled={isLoading || isExtracting || isZipping}
        onclick={() => fileInput?.click()}
      >{sourceFile ? 'Change PDF' : 'Choose PDF'}</button>
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={!sourceFile || isLoading || isExtracting || isZipping}
        onclick={runExtraction}
      >{isLoading ? 'Opening…' : isExtracting ? 'Extracting…' : 'Extract images'}</button>
    </div>
  </div>

  <div
    class="min-h-[300px] bg-canvas px-6 py-6 max-[600px]:px-3"
    role="region"
    aria-label="Embedded image extraction"
    ondragover={(event) => event.preventDefault()}
    ondrop={handleDrop}
  >
    {#if !sourceFile && !isLoading}
      <div class="flex min-h-[230px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
        <span class="mb-3 grid size-[44px] place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden="true">
          <svg class="size-6" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="8.5" cy="9" r="1.4" stroke="currentColor" stroke-width="1.4"/><path d="m5 17 4.3-4.3 3.1 3.1 2.6-2.6L19 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <strong class="text-[13px] font-bold text-ink">Choose a PDF to inspect</strong>
        <p class="mb-4 mt-1 max-w-[360px] text-[10px] leading-[1.6] text-muted">Extract reusable image objects from the document. This does not export page screenshots.</p>
        <button
          type="button"
          class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          disabled={isLoading}
          onclick={() => fileInput?.click()}
        >Choose PDF</button>
        <span class="mt-3 text-[9px] text-subtle">You can also drop a PDF here. Maximum file size 150 MB.</span>
      </div>
    {:else if isLoading}
      <div class="flex min-h-[230px] items-center justify-center text-[11px] text-muted">Checking your PDF locally…</div>
    {:else}
      <div class="mx-auto max-w-[900px]">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
          <div class="min-w-0">
            <div class="truncate text-[11px] font-semibold text-ink" title={sourceFile?.name}>{sourceFile?.name}</div>
            <div class="mt-1 text-[9px] text-muted">Image objects are read locally from PDF content streams.</div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="min-h-[32px] rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted hover:bg-canvas disabled:opacity-40" disabled={isExtracting || isZipping} onclick={clearSource}>Remove PDF</button>
          </div>
        </div>

        {#if isExtracting}
          <div class="rounded-xl border border-line bg-surface p-4">
            <div class="mb-1 flex items-center justify-between text-[9px] text-muted"><span>Scanning page objects</span><span>{progress}%</span></div>
            <div class="h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-brand-600 transition-all" style={'width:' + progress + '%'}></div></div>
          </div>
        {/if}

        {#if images.length > 0}
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="mb-0 mt-0 text-[13px] font-bold text-ink">{images.length} extracted {images.length === 1 ? 'image' : 'images'}</h2>
              <p class="mb-0 mt-1 text-[9px] text-muted">{pageCount} pages inspected{skippedImages > 0 ? ' · ' + skippedImages + ' unsupported/oversized image object(s) skipped' : ''}</p>
            </div>
            <button
              type="button"
              class="min-h-[34px] rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 disabled:opacity-40"
              disabled={isZipping || isExtracting}
              onclick={downloadAllAsZip}
            >{isZipping ? 'Preparing ZIP…' : 'Download all as ZIP'}</button>
          </div>

          <div class="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1" aria-label="Extracted image files">
            {#each images as image, index (image.fileName)}
              <article class="flex min-w-0 gap-3 rounded-xl border border-line bg-surface p-3">
                <a href={image.previewUrl} target="_blank" rel="noreferrer" aria-label={'Open preview for ' + image.fileName} class="grid size-[88px] shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-canvas">
                  <img src={image.previewUrl} alt={'Extracted image from page ' + image.pageNumber} class="max-h-full max-w-full object-contain" />
                </a>
                <div class="flex min-w-0 flex-1 flex-col">
                  <div class="truncate text-[10px] font-semibold text-ink" title={image.fileName}>{image.fileName}</div>
                  <div class="mt-1 text-[9px] text-muted">Page {image.pageNumber} · {image.width} × {image.height}</div>
                  <div class="mt-0.5 text-[9px] text-subtle">{image.source === 'inline-image' ? 'Inline image' : 'Image XObject'} · PNG export</div>
                  <button type="button" class="mt-auto self-start pt-2 text-[10px] font-semibold text-brand-700 hover:underline" onclick={() => downloadImage(index)}>Download PNG</button>
                </div>
              </article>
            {/each}
          </div>
        {:else if !isExtracting && pageCount > 0}
          <div class="rounded-xl border border-line bg-surface px-5 py-8 text-center">
            <strong class="text-[12px] font-bold text-ink">No supported image objects found</strong>
            <p class="mb-0 mt-1 text-[10px] leading-[1.6] text-muted">This PDF may contain vector drawings, text, or image formats that this extractor does not currently support.</p>
          </div>
        {/if}
      </div>
    {/if}

    {#if errorMessage}
      <p class="mx-auto mb-0 mt-4 max-w-[900px] rounded-lg border border-line bg-canvas px-4 py-3 text-[10px] leading-[1.6] text-muted" role="alert">{errorMessage}</p>
    {/if}
    <p class="mb-0 mt-4 text-center text-[10px] text-muted" role="status" aria-live="polite">{statusMessage}</p>
  </div>

  <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4 text-[10px] text-muted max-[600px]:px-4">
    <span>Extraction happens locally in your browser.</span>
    <span>Decoded image resources are exported as PNG; original PDF remains unchanged.</span>
  </footer>
</section>

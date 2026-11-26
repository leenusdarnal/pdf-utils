<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    convertImagesToPdf,
    detectImageFormat,
    MAX_IMAGE_COUNT,
    MAX_IMAGE_FILE_BYTES,
    safePdfFileName,
    type ImagePdfFit,
    type ImagePdfOrientation,
    type ImagePdfPageSize,
    type SupportedImageFormat
  } from '$lib/pdf/images-to-pdf';

  export let onClose: () => void;

  interface ImageItem {
    id: string;
    file: File;
    previewUrl: string;
    format: SupportedImageFormat;
  }

  let items: ImageItem[] = [];
  let imageInput: HTMLInputElement;
  let isChecking = false;
  let isExporting = false;
  let errorMessage = '';
  let statusMessage = 'Add one or more images to create a PDF.';
  let pageSize: ImagePdfPageSize = 'a4';
  let orientation: ImagePdfOrientation = 'auto';
  let fit: ImagePdfFit = 'contain';
  let marginMm = 10;
  let outputName = 'images-to-pdf';
  let progress = 0;

  function createItemId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'image-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function formatFileSize(size: number): string {
    if (size < 1_048_576) return Math.max(1, Math.round(size / 1_024)) + ' KB';
    return (size / 1_048_576).toFixed(2) + ' MB';
  }

  function formatLabel(format: SupportedImageFormat): string {
    return format === 'jpeg' ? 'JPEG' : format.toUpperCase();
  }

  async function validateAndAdd(files: File[]) {
    if (files.length === 0 || isChecking || isExporting) return;

    isChecking = true;
    errorMessage = '';
    const accepted: ImageItem[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      if (items.length + accepted.length >= MAX_IMAGE_COUNT) {
        rejected.push(file.name + ' (the ' + MAX_IMAGE_COUNT + ' image limit was reached)');
        continue;
      }
      if (file.size === 0 || file.size > MAX_IMAGE_FILE_BYTES) {
        rejected.push(file.name + ' (empty or larger than 40 MB)');
        continue;
      }

      try {
        const format = await detectImageFormat(file);
        if (!format) {
          rejected.push(file.name);
          continue;
        }
        accepted.push({
          id: createItemId(),
          file,
          previewUrl: URL.createObjectURL(file),
          format
        });
      } catch {
        rejected.push(file.name);
      }
    }

    items = [...items, ...accepted];
    if (rejected.length > 0) {
      errorMessage = rejected.length === 1
        ? rejected[0] + ' could not be added. Use PNG, JPEG, or WebP images under 40 MB.'
        : rejected.length + ' files could not be added. Use PNG, JPEG, or WebP images under 40 MB.';
    }

    statusMessage = items.length === 0
      ? 'No supported images were added.'
      : items.length + (items.length === 1 ? ' image is ready.' : ' images are ready.') +
        ' Arrange them and choose your PDF page settings.';
    isChecking = false;
  }

  function handlePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void validateAndAdd(files);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    void validateAndAdd(Array.from(event.dataTransfer?.files ?? []));
  }

  function moveImage(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= items.length || isExporting) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    items = next;
    statusMessage = 'Image order updated.';
  }

  function removeImage(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (item) URL.revokeObjectURL(item.previewUrl);
    items = items.filter((candidate) => candidate.id !== id);
    statusMessage = items.length === 0
      ? 'Add one or more images to create a PDF.'
      : items.length + (items.length === 1 ? ' image remains.' : ' images remain.');
  }

  function clearImages() {
    for (const item of items) URL.revokeObjectURL(item.previewUrl);
    items = [];
    errorMessage = '';
    progress = 0;
    statusMessage = 'Add one or more images to create a PDF.';
  }

  function handleMarginInput(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    marginMm = value === '' ? 0 : Number(value);
  }

  async function createPdf() {
    if (items.length === 0 || isChecking || isExporting) return;

    isExporting = true;
    errorMessage = '';
    progress = 0;
    statusMessage = 'Preparing images locally…';

    try {
      const bytes = await convertImagesToPdf(
        items.map((item) => item.file),
        { pageSize, orientation, marginMm, fit },
        ({ completed, total, fileName }) => {
          progress = Math.round((completed / total) * 100);
          statusMessage = 'Adding ' + fileName + ' (' + completed + ' of ' + total + ')…';
        }
      );

      const fileName = safePdfFileName(outputName);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
      statusMessage = items.length + (items.length === 1 ? ' page created.' : ' pages created.') +
        ' Download started: ' + fileName;
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : 'The images could not be converted. Check the files and try again.';
      statusMessage = 'PDF creation failed.';
    } finally {
      isExporting = false;
    }
  }

  onDestroy(() => {
    for (const item of items) URL.revokeObjectURL(item.previewUrl);
  });
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="Images to PDF workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">Images to PDF</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Combine photos into a PDF. Reorder pages and control page layout without uploading your files.</p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
      onclick={onClose}
    >← Back to tools</button>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-5 py-3 max-[600px]:px-3">
    <div class="text-[10px] text-muted">{items.length} {items.length === 1 ? 'image' : 'images'} in PDF order</div>
    <div class="flex flex-wrap items-center gap-2">
      <input
        bind:this={imageInput}
        id="images-to-pdf-file-input"
        class="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        multiple
        onchange={handlePick}
      />
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50"
        disabled={isChecking || isExporting || items.length >= MAX_IMAGE_COUNT}
        onclick={() => imageInput?.click()}
      >Add images</button>
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={items.length === 0 || isChecking || isExporting}
        onclick={createPdf}
      >{isChecking ? 'Checking…' : isExporting ? 'Creating PDF…' : 'Create PDF'}</button>
    </div>
  </div>

  <div
    class="min-h-[290px] bg-canvas px-6 py-6 max-[600px]:px-3"
    role="region"
    aria-label="Drop images to convert"
    ondragover={(event) => event.preventDefault()}
    ondrop={handleDrop}
  >
    {#if items.length === 0}
      <div class="flex min-h-[230px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
        <span class="mb-3 grid size-[44px] place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden="true">
          <svg class="size-6" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="8.5" cy="9" r="1.4" stroke="currentColor" stroke-width="1.4"/><path d="m5 17 4.3-4.3 3.1 3.1 2.6-2.6L19 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <strong class="text-[13px] font-bold text-ink">Add images to create a PDF</strong>
        <p class="mb-4 mt-1 max-w-[350px] text-[10px] leading-[1.6] text-muted">Choose JPG, PNG, or WebP images. Each image becomes a page in the order shown below.</p>
        <button
          type="button"
          class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          disabled={isChecking || isExporting}
          onclick={() => imageInput?.click()}
        >Choose images</button>
        <span class="mt-3 text-[9px] text-subtle">You can also drop image files here. Maximum {MAX_IMAGE_COUNT} images.</span>
      </div>
    {:else}
      <div class="mx-auto grid max-w-[900px] gap-2" role="list" aria-label="Image PDF order">
        {#each items as item, index (item.id)}
          <div
            class="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-[0_2px_8px_rgb(30_40_70_/_0.03)] max-[480px]:gap-2 max-[480px]:p-2.5"
            role="listitem"
            data-image-name={item.file.name}
          >
            <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-[10px] font-bold text-brand-700">{index + 1}</span>
            <img src={item.previewUrl} alt={'Preview of ' + item.file.name} class="size-[54px] shrink-0 rounded-lg border border-line bg-canvas object-contain p-1" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-[11px] font-semibold text-ink" title={item.file.name}>{item.file.name}</div>
              <div class="mt-0.5 text-[9px] text-muted">{formatLabel(item.format)} · {formatFileSize(item.file.size)}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                class="grid size-8 place-items-center rounded-md border border-line bg-surface text-[12px] font-bold text-muted hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={'Move ' + item.file.name + ' up'}
                title="Move up"
                disabled={index === 0 || isExporting}
                onclick={() => moveImage(index, -1)}
              >↑</button>
              <button
                type="button"
                class="grid size-8 place-items-center rounded-md border border-line bg-surface text-[12px] font-bold text-muted hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={'Move ' + item.file.name + ' down'}
                title="Move down"
                disabled={index === items.length - 1 || isExporting}
                onclick={() => moveImage(index, 1)}
              >↓</button>
              <button
                type="button"
                class="grid size-8 place-items-center rounded-md border border-line bg-surface text-[11px] font-bold text-danger-600 hover:bg-canvas disabled:opacity-30"
                aria-label={'Remove ' + item.file.name}
                title="Remove image"
                disabled={isExporting}
                onclick={() => removeImage(item.id)}
              >×</button>
            </div>
          </div>
        {/each}
      </div>

      <div class="mx-auto mt-3 flex max-w-[900px] flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap gap-3">
          <button type="button" class="text-[10px] font-semibold text-brand-700 hover:underline disabled:opacity-40" disabled={isChecking || isExporting || items.length >= MAX_IMAGE_COUNT} onclick={() => imageInput?.click()}>+ Add more images</button>
          <button type="button" class="text-[10px] font-semibold text-muted hover:underline disabled:opacity-40" disabled={isExporting} onclick={clearImages}>Clear all</button>
        </div>
        <span class="text-right text-[9px] text-subtle">Use the arrows to change page order.</span>
      </div>

      <div class="mx-auto mt-6 grid max-w-[900px] grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 max-[640px]:grid-cols-1">
        <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
          Page size
          <select aria-label="Page size" bind:value={pageSize} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink">
            <option value="a4">A4</option>
            <option value="letter">US Letter</option>
            <option value="legal">US Legal</option>
            <option value="image">Fit to image (96 DPI)</option>
          </select>
        </label>
        <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
          Orientation
          <select aria-label="Orientation" bind:value={orientation} disabled={isExporting || pageSize === 'image'} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink">
            <option value="auto">Auto per image</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
          Margins (mm)
          <input aria-label="Margins (mm)" type="number" min="0" max="50" step="1" value={marginMm} oninput={handleMarginInput} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink" />
        </label>
        <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
          Image fit
          <select aria-label="Image fit" bind:value={fit} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink">
            <option value="contain">Fit inside page (keep proportions)</option>
            <option value="stretch">Fill available area (stretch)</option>
          </select>
        </label>
        <label class="col-span-2 grid gap-1.5 text-[10px] font-semibold text-ink max-[640px]:col-span-1">
          PDF file name
          <input aria-label="PDF file name" type="text" maxlength="100" bind:value={outputName} disabled={isExporting} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink" />
        </label>
        <p class="col-span-2 mb-0 text-[9px] leading-[1.6] text-muted max-[640px]:col-span-1">Fit keeps each image proportional and centres it within the page. Stretch fills the available area and can change an image's proportions. Fit to image creates a page per picture at 96 pixels per inch.</p>
      </div>
    {/if}

    {#if isExporting}
      <div class="mx-auto mt-4 max-w-[900px]">
        <div class="mb-1 flex items-center justify-between text-[9px] text-muted"><span>Building PDF</span><span>{progress}%</span></div>
        <div class="h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-brand-600 transition-all" style={'width:' + progress + '%'}></div></div>
      </div>
    {/if}

    {#if errorMessage}
      <p class="mx-auto mb-0 mt-4 max-w-[900px] rounded-lg border border-[#f0d6d6] bg-[#fff8f8] px-4 py-3 text-[10px] leading-[1.6] text-[#a44747]" role="alert">{errorMessage}</p>
    {/if}
    <p class="mb-0 mt-4 text-center text-[10px] text-muted" role="status" aria-live="polite">{statusMessage}</p>
  </div>

  <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4 text-[10px] text-muted max-[600px]:px-4">
    <span>Images are processed locally in your browser.</span>
    <span>The generated PDF is a new file; your originals are unchanged.</span>
  </footer>
</section>

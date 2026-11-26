<script lang="ts">
  import { onDestroy } from 'svelte';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import {
    COMPRESSION_PRESETS,
    MAX_COMPRESS_INPUT_BYTES,
    compressPdf,
    previewPdfCompression,
    type CompressionPreset,
    type PdfCompressionResult
  } from '$lib/pdf/compress-pdf';

  export let onClose: () => void;

  let sourceFile: File | null = null;
  let fileInput: HTMLInputElement;
  let preset: CompressionPreset = 'balanced';
  let targetSizeMb = '';
  let understoodLossy = false;
  let isChecking = false;
  let isPreviewing = false;
  let isCompressing = false;
  let errorMessage = '';
  let statusMessage = 'Choose a PDF to prepare a smaller copy.';
  let previewUrl: string | null = null;
  let result: PdfCompressionResult | null = null;
  let progress = 0;
  let progressLabel = '';

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  function resetResult() {
    result = null;
    progress = 0;
    progressLabel = '';
  }

  async function acceptFile(file: File | undefined) {
    if (!file || isChecking || isPreviewing || isCompressing) return;
    errorMessage = '';
    resetResult();
    clearPreview();
    sourceFile = null;
    understoodLossy = false;

    if (file.size === 0) {
      errorMessage = 'The selected file is empty.';
      statusMessage = 'Choose a valid PDF file.';
      return;
    }
    if (file.size > MAX_COMPRESS_INPUT_BYTES) {
      errorMessage = 'This PDF is larger than the 150 MB processing limit.';
      statusMessage = 'Choose a smaller PDF file.';
      return;
    }

    isChecking = true;
    statusMessage = 'Checking the PDF locally…';
    try {
      if (!(await hasPdfHeader(file))) {
        errorMessage = 'This file does not look like a valid PDF.';
        statusMessage = 'Choose a PDF file and try again.';
        return;
      }
      sourceFile = file;
      statusMessage = file.name + ' is ready. Choose a preset and preview the first page.';
    } catch {
      errorMessage = 'The selected PDF could not be read.';
      statusMessage = 'Choose another PDF file.';
    } finally {
      isChecking = false;
    }
  }

  function handlePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    void acceptFile(file);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    void acceptFile(event.dataTransfer?.files?.[0]);
  }

  function clearSource() {
    if (isCompressing || isPreviewing) return;
    sourceFile = null;
    understoodLossy = false;
    errorMessage = '';
    clearPreview();
    resetResult();
    statusMessage = 'Choose a PDF to prepare a smaller copy.';
  }

  function changePreset(event: Event) {
    preset = (event.currentTarget as HTMLSelectElement).value as CompressionPreset;
    clearPreview();
    resetResult();
    statusMessage = sourceFile
      ? 'Preset changed. Preview the first page before compressing.'
      : 'Choose a PDF to prepare a smaller copy.';
  }

  async function createPreview() {
    if (!sourceFile || isPreviewing || isCompressing) return;
    isPreviewing = true;
    errorMessage = '';
    statusMessage = 'Rendering a local preview of page 1…';
    try {
      const blob = await previewPdfCompression(sourceFile, preset);
      clearPreview();
      previewUrl = URL.createObjectURL(blob);
      statusMessage = 'Preview ready. Review the page quality and confirm the compression warning to continue.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The preview could not be created.';
      statusMessage = 'Preview failed.';
    } finally {
      isPreviewing = false;
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function getFileName(): string {
    const name = (sourceFile?.name ?? 'document.pdf').replace(/\.pdf$/i, '');
    const safe = name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 75);
    return (safe || 'document') + '-compressed.pdf';
  }

  async function runCompression() {
    if (!sourceFile || !previewUrl || !understoodLossy || isCompressing || isPreviewing) return;
    isCompressing = true;
    errorMessage = '';
    resetResult();
    statusMessage = 'Preparing your compressed copy locally…';

    try {
      const trimmedTarget = targetSizeMb.trim();
      const targetBytes = trimmedTarget ? Number(trimmedTarget) * 1024 * 1024 : undefined;
      const compressed = await compressPdf(sourceFile, preset, targetBytes, (update) => {
        progress = Math.round((update.completed / update.total) * 100);
        progressLabel = 'Attempt ' + update.attempt + ' of ' + update.maxAttempts +
          ' · ' + update.dpi + ' DPI · page ' + update.completed + ' of ' + update.total;
        statusMessage = 'Rendering pages locally…';
      });
      result = compressed;
      clearPreview();
      previewUrl = URL.createObjectURL(compressed.previewBlob);

      if (compressed.outputSizeBytes < compressed.originalSizeBytes) {
        const saved = ((compressed.originalSizeBytes - compressed.outputSizeBytes) /
          compressed.originalSizeBytes) * 100;
        statusMessage = 'Compression complete. The new copy is ' + saved.toFixed(1) + '% smaller.';
      } else {
        const increased = ((compressed.outputSizeBytes - compressed.originalSizeBytes) /
          compressed.originalSizeBytes) * 100;
        statusMessage = 'Compression complete, but the new copy is ' + increased.toFixed(1) +
          '% larger. You can still download it, or keep your original.';
      }
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : 'The PDF could not be compressed. Check the file and try again.';
      statusMessage = 'Compression failed.';
    } finally {
      isCompressing = false;
    }
  }

  function downloadCompressedCopy() {
    if (!result) return;
    const blob = new Blob([result.bytes as BlobPart], { type: 'application/pdf' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = getFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
  }

  onDestroy(clearPreview);
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="Compress PDF workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-ink">Compress PDF</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-muted">Create a smaller, image-based copy locally with visible quality and size reporting.</p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-muted transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
      onclick={onClose}
    >← Back to tools</button>
  </header>

  <div
    class="min-h-[290px] bg-canvas px-6 py-6 max-[600px]:px-3"
    role="region"
    aria-label="Choose a PDF to compress"
    ondragover={(event) => event.preventDefault()}
    ondrop={handleDrop}
  >
    {#if !sourceFile}
      <div class="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
        <span class="mb-3 grid size-[44px] place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden="true">
          <svg class="size-6" viewBox="0 0 24 24" fill="none"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <strong class="text-[13px] font-bold text-ink">Choose a PDF to compress</strong>
        <p class="mb-4 mt-1 max-w-[350px] text-[10px] leading-[1.6] text-muted">Your document stays on this device. Files up to 150 MB and 500 pages are supported.</p>
        <input bind:this={fileInput} id="compress-pdf-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
        <button
          type="button"
          class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          disabled={isChecking}
          onclick={() => fileInput?.click()}
        >{isChecking ? 'Checking…' : 'Choose PDF'}</button>
        <span class="mt-3 text-[9px] text-subtle">You can also drop a PDF file here.</span>
      </div>
    {:else}
      <div class="mx-auto grid max-w-[900px] gap-5">
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
          <div class="min-w-0">
            <div class="truncate text-[11px] font-semibold text-ink" title={sourceFile.name}>{sourceFile.name}</div>
            <div class="mt-1 text-[9px] text-muted">{formatBytes(sourceFile.size)} · Original file remains unchanged</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="min-h-[32px] rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted hover:bg-canvas" disabled={isCompressing || isPreviewing} onclick={() => fileInput?.click()}>Choose another</button>
            <button type="button" class="min-h-[32px] rounded-lg border border-line bg-surface px-3 text-[10px] font-semibold text-muted hover:bg-canvas" disabled={isCompressing || isPreviewing} onclick={clearSource}>Remove</button>
          </div>
        </div>

        <input bind:this={fileInput} id="compress-pdf-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />

        <div class="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 max-[640px]:grid-cols-1">
          <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
            Compression preset
            <select aria-label="Compression preset" value={preset} onchange={changePreset} disabled={isCompressing || isPreviewing} class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink">
              <option value="screen">Screen · 96 DPI</option>
              <option value="balanced">Balanced · 144 DPI</option>
              <option value="print">Print · 216 DPI</option>
            </select>
          </label>
          <label class="grid gap-1.5 text-[10px] font-semibold text-ink">
            Target size (MB, optional)
            <input aria-label="Target size in MB" type="number" min="0.1" max="500" step="0.1" value={targetSizeMb} oninput={(event) => { targetSizeMb = (event.currentTarget as HTMLInputElement).value; resetResult(); }} disabled={isCompressing || isPreviewing} placeholder="Best effort, no target" class="min-h-[36px] rounded-lg border border-line bg-surface px-3 text-[11px] font-normal text-ink" />
          </label>
          <div class="col-span-2 grid gap-2 max-[640px]:col-span-1">
            <p class="mb-0 text-[10px] font-semibold text-ink">Preset guidance</p>
            <div class="grid grid-cols-3 gap-2 max-[480px]:grid-cols-1">
              {#each Object.entries(COMPRESSION_PRESETS) as [key, value]}
                <div class="rounded-lg border border-line bg-canvas p-3">
                  <div class="text-[10px] font-bold text-ink">{value.label}</div>
                  <div class="mt-1 text-[9px] leading-[1.5] text-muted">{value.description}</div>
                  <div class="mt-2 text-[9px] text-subtle">{value.dpi} DPI · JPEG {Math.round(value.quality * 100)}%</div>
                </div>
              {/each}
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-[#e6c997] bg-[#fffaf1] p-4 text-[10px] leading-[1.65] text-[#785b2d]" role="note">
          <strong class="font-bold">Important: this compression is lossy.</strong>
          Each page is converted into a JPEG image. The output will no longer contain selectable/searchable text, hyperlinks, form fields, digital signatures, or vector content. The original PDF is never changed. Do not use this workflow for signed documents or documents that need accessible/searchable text.
        </div>

        <label class="flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-[10px] leading-[1.6] text-muted">
          <input type="checkbox" bind:checked={understoodLossy} disabled={isCompressing || isPreviewing} class="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-700)]" />
          <span>I understand this creates a flattened, image-based PDF and removes selectable text and interactive content.</span>
        </label>

        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="min-h-[36px] rounded-lg border border-line bg-surface px-4 text-[10px] font-semibold text-muted hover:bg-canvas disabled:opacity-40" disabled={isPreviewing || isCompressing} onclick={createPreview}>{isPreviewing ? 'Preparing preview…' : 'Preview first page'}</button>
          <button type="button" class="min-h-[36px] rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-40" disabled={!previewUrl || !understoodLossy || isPreviewing || isCompressing} onclick={runCompression}>{isCompressing ? 'Compressing…' : 'Compress PDF'}</button>
        </div>

        {#if previewUrl}
          <div class="rounded-xl border border-line bg-surface p-4">
            <div class="mb-2 text-[10px] font-semibold text-ink">{result ? 'Compressed first-page preview' : 'First-page quality preview'}</div>
            <div class="flex min-h-[170px] items-center justify-center rounded-lg bg-canvas p-3">
              <img src={previewUrl} alt="First page preview using the selected compression settings" class="max-h-[430px] max-w-full rounded border border-line bg-white object-contain shadow-sm" />
            </div>
            <p class="mb-0 mt-2 text-[9px] text-muted">{result ? 'Preview reflects the final settings used for the output.' : 'This is a JPEG preview at the selected preset. A target-size run may use lower settings if needed.'}</p>
          </div>
        {/if}

        {#if isCompressing}
          <div class="rounded-xl border border-line bg-surface p-4">
            <div class="mb-1 flex items-center justify-between text-[9px] text-muted"><span>{progressLabel || 'Rendering pages'}</span><span>{progress}%</span></div>
            <div class="h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-brand-600 transition-all" style={'width:' + progress + '%'}></div></div>
          </div>
        {/if}

        {#if result}
          <div class="rounded-xl border border-line bg-surface p-4">
            <h2 class="mb-3 mt-0 text-[13px] font-bold text-ink">Compression result</h2>
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-lg bg-canvas p-3"><div class="text-[9px] text-muted">Original PDF</div><div class="mt-1 text-[15px] font-bold text-ink">{formatBytes(result.originalSizeBytes)}</div></div>
              <div class="rounded-lg bg-canvas p-3"><div class="text-[9px] text-muted">New PDF</div><div class="mt-1 text-[15px] font-bold text-ink">{formatBytes(result.outputSizeBytes)}</div></div>
            </div>
            <p class="mb-0 mt-3 text-[10px] leading-[1.6] text-muted">
              {#if result.outputSizeBytes < result.originalSizeBytes}
                Saved {((result.originalSizeBytes - result.outputSizeBytes) / result.originalSizeBytes * 100).toFixed(1)}% · {formatBytes(result.originalSizeBytes - result.outputSizeBytes)} smaller.
              {:else}
                The generated file is {((result.outputSizeBytes - result.originalSizeBytes) / result.originalSizeBytes * 100).toFixed(1)}% larger than the original. Keep the original if it is more useful.
              {/if}
            </p>
            <p class="mb-0 mt-1 text-[9px] leading-[1.6] text-muted">
              {result.pageCount} pages · {result.settings.dpi} effective DPI · JPEG quality {Math.round(result.settings.quality * 100)}% · {result.attempts} attempt(s)
              {#if result.targetSizeBytes !== null}
                · {result.targetReached ? 'Target reached.' : 'Target not reached; showing the smallest tested output.'}
              {/if}
            </p>
            <button type="button" class="mt-4 min-h-[38px] rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800" onclick={downloadCompressedCopy}>Download compressed copy</button>
          </div>
        {/if}
      </div>
    {/if}

    {#if errorMessage}
      <p class="mx-auto mb-0 mt-4 max-w-[900px] rounded-lg border border-[#f0d6d6] bg-[#fff8f8] px-4 py-3 text-[10px] leading-[1.6] text-[#a44747]" role="alert">{errorMessage}</p>
    {/if}
    <p class="mb-0 mt-4 text-center text-[10px] text-muted" role="status" aria-live="polite">{statusMessage}</p>
  </div>

  <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4 text-[10px] text-muted max-[600px]:px-4">
    <span>Processing happens locally in your browser.</span>
    <span>The original PDF is never overwritten.</span>
  </footer>
</section>

<script lang="ts">
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';

  export let onClose: () => void;

  interface MergeItem {
    id: string;
    file: File;
  }

  let items: MergeItem[] = [];
  let mergeInput: HTMLInputElement;
  let isChecking = false;
  let isMerging = false;
  let errorMessage = '';
  let statusMessage = 'Add at least two PDF files to get started.';

  function createItemId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'merge-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function formatFileSize(size: number): string {
    if (size < 1_048_576) return Math.max(1, Math.round(size / 1_024)) + ' KB';
    return (size / 1_048_576).toFixed(2) + ' MB';
  }

  async function validateAndAdd(files: File[]) {
    if (files.length === 0 || isChecking || isMerging) return;

    isChecking = true;
    errorMessage = '';
    const accepted: MergeItem[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      try {
        if (await hasPdfHeader(file)) accepted.push({ id: createItemId(), file });
        else rejected.push(file.name);
      } catch {
        rejected.push(file.name);
      }
    }

    items = [...items, ...accepted];
    if (rejected.length > 0) {
      errorMessage = rejected.length === 1
        ? rejected[0] + ' is not a valid PDF and was not added.'
        : rejected.length + ' files were not valid PDFs and were not added.';
    }

    statusMessage = items.length + (items.length === 1 ? ' PDF added.' : ' PDFs added.') +
      (items.length < 2 ? ' Add at least one more PDF.' : ' Ready to merge.');
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

  function moveFile(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    items = next;
    statusMessage = 'Merge order updated.';
  }

  function removeFile(id: string) {
    items = items.filter((item) => item.id !== id);
    statusMessage = items.length < 2
      ? 'Add at least one more PDF to merge.'
      : 'File removed. ' + items.length + ' PDFs remain in the merge list.';
  }

  async function mergeAndDownload() {
    if (items.length < 2 || isMerging || isChecking) return;

    isMerging = true;
    errorMessage = '';
    statusMessage = 'Merging ' + items.length + ' PDFs locally…';

    try {
      const { mergePdfFiles } = await import('$lib/pdf/merge-pdfs');
      const mergedBytes = await mergePdfFiles(items.map((item) => item.file));
      const blob = new Blob([mergedBytes as BlobPart], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'merged-document.pdf';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
      statusMessage = 'Merged ' + items.length + ' PDFs and started the download.';
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : 'The PDFs could not be merged. Check the files and try again.';
      statusMessage = 'Merge failed.';
    } finally {
      isMerging = false;
    }
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-[#e5e8ef] bg-white shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="Merge PDFs workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-[#eceef2] px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-[#303542]">Merge PDFs</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-[#858b98]">Combine multiple PDF files into one document. Files stay on your device.</p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-[#e2e5eb] bg-white px-3 text-[11px] font-semibold text-[#555d6b] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
      onclick={onClose}
    >← Back to tools</button>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#eceef2] bg-[#fbfcfe] px-5 py-3 max-[600px]:px-3">
    <div class="text-[10px] text-[#858b98]">{items.length} {items.length === 1 ? 'PDF' : 'PDFs'} in merge order</div>
    <div class="flex flex-wrap items-center gap-2">
      <input
        bind:this={mergeInput}
        id="merge-file-input"
        class="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        multiple
        onchange={handlePick}
      />
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-[#e1e4eb] bg-white px-3 text-[10px] font-semibold text-[#586071] transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50"
        disabled={isChecking || isMerging}
        onclick={() => mergeInput?.click()}
      >Add PDFs</button>
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={items.length < 2 || isChecking || isMerging}
        onclick={mergeAndDownload}
      >{isChecking ? 'Checking…' : isMerging ? 'Merging…' : 'Merge PDFs'}</button>
    </div>
  </div>

  <div
    class="min-h-[290px] bg-[#f6f7fa] px-6 py-6 max-[600px]:px-3"
    ondragover={(event) => event.preventDefault()}
    ondrop={handleDrop}
  >
    {#if items.length === 0}
      <div class="flex min-h-[230px] flex-col items-center justify-center rounded-xl border border-dashed border-[#c9cbd7] bg-white px-5 py-8 text-center">
        <span class="mb-3 grid size-[44px] place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden="true">
          <svg class="size-6" viewBox="0 0 24 24" fill="none"><path d="M5 4h9l5 5v11H5zM14 4v5h5M8 14h8M8 17h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <strong class="text-[13px] font-bold text-[#404655]">Add PDFs to combine</strong>
        <p class="mb-4 mt-1 max-w-[330px] text-[10px] leading-[1.6] text-[#9298a4]">Choose two or more PDF files, then arrange them in the order you want them to appear.</p>
        <button
          type="button"
          class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          disabled={isChecking || isMerging}
          onclick={() => mergeInput?.click()}
        >Choose PDF files</button>
        <span class="mt-3 text-[9px] text-[#a0a5af]">You can also drop PDF files here.</span>
      </div>
    {:else}
      <div class="mx-auto grid max-w-[760px] gap-2" role="list" aria-label="PDF merge order">
        {#each items as item, index (item.id)}
          <div
            class="flex min-w-0 items-center gap-3 rounded-xl border border-[#e5e8ef] bg-white p-3 shadow-[0_2px_8px_rgb(30_40_70_/_0.03)] max-[480px]:gap-2 max-[480px]:p-2.5"
            role="listitem"
            data-merge-source={item.file.name}
          >
            <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-[10px] font-bold text-brand-700">{index + 1}</span>
            <span class="grid size-9 shrink-0 place-items-center rounded-lg border border-[#eceef2] bg-[#fbfcfe] text-[9px] font-bold text-[#7068bd]">PDF</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-[11px] font-semibold text-[#414856]" title={item.file.name}>{item.file.name}</div>
              <div class="mt-0.5 text-[9px] text-[#969ba6]">{formatFileSize(item.file.size)}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                class="grid size-8 place-items-center rounded-md border border-[#e5e7ed] bg-white text-[12px] font-bold text-[#626a78] hover:bg-[#f5f6fa] disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={'Move ' + item.file.name + ' up'}
                title="Move up"
                disabled={index === 0 || isMerging}
                onclick={() => moveFile(index, -1)}
              >↑</button>
              <button
                type="button"
                class="grid size-8 place-items-center rounded-md border border-[#e5e7ed] bg-white text-[12px] font-bold text-[#626a78] hover:bg-[#f5f6fa] disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={'Move ' + item.file.name + ' down'}
                title="Move down"
                disabled={index === items.length - 1 || isMerging}
                onclick={() => moveFile(index, 1)}
              >↓</button>
              <button
                type="button"
                class="grid size-8 place-items-center rounded-md border border-[#f0d8d8] bg-white text-[11px] font-bold text-[#b14c4c] hover:bg-[#fff6f6] disabled:opacity-30"
                aria-label={'Remove ' + item.file.name}
                title="Remove file"
                disabled={isMerging}
                onclick={() => removeFile(item.id)}
              >×</button>
            </div>
          </div>
        {/each}
      </div>
      <div class="mx-auto mt-3 flex max-w-[760px] items-center justify-between gap-3">
        <button type="button" class="text-[10px] font-semibold text-brand-700 hover:underline disabled:opacity-40" disabled={isChecking || isMerging} onclick={() => mergeInput?.click()}>+ Add more PDFs</button>
        <span class="text-right text-[9px] text-[#999eaa]">Use the arrows to change the merge order.</span>
      </div>
    {/if}

    {#if errorMessage}
      <p class="mx-auto mb-0 mt-4 max-w-[760px] rounded-lg border border-[#f0d6d6] bg-[#fff8f8] px-4 py-3 text-[10px] leading-[1.6] text-[#a44747]" role="alert">{errorMessage}</p>
    {/if}
    <p class="mb-0 mt-4 text-center text-[10px] text-[#858b98]" role="status" aria-live="polite">{statusMessage}</p>
  </div>

  <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-[#eceef2] px-6 py-4 text-[10px] text-[#8a909c] max-[600px]:px-4">
    <span>Processing happens locally in your browser.</span>
    <span>The merged PDF is a new file; your originals are unchanged.</span>
  </footer>
</section>

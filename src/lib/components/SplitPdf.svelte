<script lang="ts">
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';
  import { getPdfPageCount, splitPdfByRanges, type SplitPdfOutput } from '$lib/pdf/split-pdf';

  export let onClose: () => void;

  interface OutputRange {
    id: string;
    value: string;
  }

  let sourceFile: File | null = null;
  let pageCount = 0;
  let ranges: OutputRange[] = [];
  let outputs: SplitPdfOutput[] = [];
  let fileInput: HTMLInputElement;
  let isLoading = false;
  let isSplitting = false;
  let errorMessage = '';
  let statusMessage = 'Choose a PDF to define page ranges.';

  function createId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'range-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function resetOutputs() {
    outputs = [];
    errorMessage = '';
  }

  async function loadFile(file?: File) {
    if (!file || isLoading || isSplitting) return;
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
      ranges = [{ id: createId(), value: '1-' + count }];
      statusMessage = count + (count === 1 ? ' page loaded. Define output ranges.' : ' pages loaded. Define output ranges.');
    } catch (error) {
      sourceFile = null;
      pageCount = 0;
      ranges = [];
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

  function addRange() {
    if (!sourceFile || ranges.length >= 30) return;
    ranges = [...ranges, { id: createId(), value: '' }];
    resetOutputs();
  }

  function updateRange(id: string, value: string) {
    ranges = ranges.map((range) => range.id === id ? { ...range, value } : range);
    resetOutputs();
  }

  function removeRange(id: string) {
    if (ranges.length <= 1) return;
    ranges = ranges.filter((range) => range.id !== id);
    resetOutputs();
  }

  async function splitDocument() {
    if (!sourceFile || ranges.length === 0 || isSplitting || isLoading) return;
    isSplitting = true;
    errorMessage = '';
    outputs = [];
    statusMessage = 'Creating ' + ranges.length + (ranges.length === 1 ? ' output PDF locally…' : ' output PDFs locally…');
    try {
      const { splitPdfByRanges: createOutputs } = await import('$lib/pdf/split-pdf');
      outputs = await createOutputs(sourceFile, ranges.map((range) => range.value));
      statusMessage = outputs.length + (outputs.length === 1 ? ' output PDF is ready to download.' : ' output PDFs are ready to download.');
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'The PDF could not be split. Check the ranges and try again.';
      statusMessage = 'Split failed.';
    } finally {
      isSplitting = false;
    }
  }

  function downloadOutput(index: number) {
    const output = outputs[index];
    if (!output) return;
    const blob = new Blob([output.bytes as BlobPart], { type: 'application/pdf' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const baseName = (sourceFile?.name ?? 'document').replace(/\.pdf$/i, '') || 'document';
    anchor.href = objectUrl;
    anchor.download = baseName + '-part-' + (index + 1) + '.pdf';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
    statusMessage = 'Started download for part ' + (index + 1) + '.';
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-[#e5e8ef] bg-white shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]" aria-label="Split PDF workspace">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-[#eceef2] px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-[#303542]">Split PDF</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-[#858b98]">Create separate PDF files from page ranges. Everything stays on your device.</p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-[#e2e5eb] bg-white px-3 text-[11px] font-semibold text-[#555d6b] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
      onclick={onClose}
    >← Back to tools</button>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#eceef2] bg-[#fbfcfe] px-5 py-3 max-[600px]:px-3">
    <div class="min-w-0 text-[10px] text-[#858b98]">
      {#if sourceFile}
        <span class="font-semibold text-[#505867]">{sourceFile.name}</span>
        <span class="ml-1">· {pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
      {:else}
        No PDF selected
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <input bind:this={fileInput} id="split-file-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-[#e1e4eb] bg-white px-3 text-[10px] font-semibold text-[#586071] transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:opacity-50"
        disabled={isLoading || isSplitting}
        onclick={() => fileInput?.click()}
      >{sourceFile ? 'Change PDF' : 'Choose PDF'}</button>
      <button
        type="button"
        class="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={!sourceFile || ranges.length === 0 || isLoading || isSplitting}
        onclick={splitDocument}
      >{isLoading ? 'Opening…' : isSplitting ? 'Splitting…' : 'Split PDF'}</button>
    </div>
  </div>

  <div
    class="min-h-[290px] bg-[#f6f7fa] px-6 py-6 max-[600px]:px-3"
    role="region"
    aria-label="Split PDF page ranges"
    ondragover={(event) => event.preventDefault()}
    ondrop={handleDrop}
  >
    {#if !sourceFile && !isLoading}
      <div class="flex min-h-[230px] flex-col items-center justify-center rounded-xl border border-dashed border-[#c9cbd7] bg-white px-5 py-8 text-center">
        <span class="mb-3 grid size-[44px] place-items-center rounded-xl bg-brand-50 text-brand-600" aria-hidden="true">
          <svg class="size-6" viewBox="0 0 24 24" fill="none"><path d="M5 4h9l5 5v11H5zM14 4v5h5M8 14h8M8 17h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <strong class="text-[13px] font-bold text-[#404655]">Choose a PDF to split</strong>
        <p class="mb-4 mt-1 max-w-[330px] text-[10px] leading-[1.6] text-[#9298a4]">Add a document, then define which pages should go into each output file.</p>
        <button
          type="button"
          class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
          onclick={() => fileInput?.click()}
        >Choose PDF</button>
        <span class="mt-3 text-[9px] text-[#a0a5af]">You can also drop a PDF here.</span>
      </div>
    {:else if isLoading}
      <div class="flex min-h-[230px] items-center justify-center text-[11px] text-[#858b98]">Opening your PDF locally…</div>
    {:else}
      <div class="mx-auto max-w-[760px]">
        <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="mb-1 text-[13px] font-bold text-[#404655]">Output page ranges</h2>
            <p class="mb-0 text-[10px] leading-[1.5] text-[#9298a4]">Use a range such as 1-3 or a list such as 1, 3-5. Each row creates a separate PDF.</p>
          </div>
          <button
            type="button"
            class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-[#e1e4eb] bg-white px-3 text-[10px] font-semibold text-[#586071] hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40"
            disabled={ranges.length >= 30 || isSplitting}
            onclick={addRange}
          >+ Add output</button>
        </div>

        <div class="grid gap-2">
          {#each ranges as range, index (range.id)}
            <div class="flex min-w-0 items-center gap-3 rounded-xl border border-[#e5e8ef] bg-white p-3 max-[480px]:gap-2 max-[480px]:p-2.5" data-split-range={index + 1}>
              <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-[10px] font-bold text-brand-700">{index + 1}</span>
              <label class="min-w-0 flex-1">
                <span class="mb-1 block text-[9px] font-semibold text-[#777f8e]">Pages for output {index + 1}</span>
                <input
                  class="h-9 w-full rounded-lg border border-[#e1e4eb] bg-white px-3 text-[11px] text-[#414856] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  type="text"
                  inputmode="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="e.g. 1-3, 5"
                  aria-label={'Page range for output ' + (index + 1)}
                  value={range.value}
                  disabled={isSplitting}
                  oninput={(event) => updateRange(range.id, event.currentTarget.value)}
                />
              </label>
              <button
                type="button"
                class="grid size-8 shrink-0 place-items-center rounded-lg border border-[#f0d8d8] bg-white text-[12px] font-bold text-[#b14c4c] hover:bg-[#fff6f6] disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={'Remove output range ' + (index + 1)}
                disabled={ranges.length <= 1 || isSplitting}
                onclick={() => removeRange(range.id)}
              >×</button>
            </div>
          {/each}
        </div>

        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span class="text-[9px] text-[#9298a4]">Pages are copied in the order entered. You can reuse a page in more than one output.</span>
          <button
            type="button"
            class="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-brand-700 px-4 text-[10px] font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!sourceFile || isSplitting}
            onclick={splitDocument}
          >{isSplitting ? 'Splitting…' : 'Create output PDFs'}</button>
        </div>

        {#if outputs.length > 0}
          <section class="mt-6 border-t border-[#e5e8ef] pt-4" aria-label="Split PDF downloads">
            <h2 class="mb-3 text-[13px] font-bold text-[#404655]">Your split files</h2>
            <div class="grid gap-2">
              {#each outputs as output, index (index)}
                <div class="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e5e8ef] bg-white p-3" data-split-output={index + 1}>
                  <div class="min-w-0">
                    <div class="text-[11px] font-semibold text-[#414856]">Part {index + 1} · Pages {output.range}</div>
                    <div class="mt-0.5 text-[9px] text-[#9298a4]">{output.pageNumbers.length} {output.pageNumbers.length === 1 ? 'page' : 'pages'} · New PDF</div>
                  </div>
                  <button
                    type="button"
                    class="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-[#e1e4eb] bg-white px-3 text-[10px] font-semibold text-brand-700 hover:border-brand-300 hover:bg-brand-50"
                    aria-label={'Download part ' + (index + 1)}
                    onclick={() => downloadOutput(index)}
                  >Download PDF</button>
                </div>
              {/each}
            </div>
          </section>
        {/if}
      </div>
    {/if}

    {#if errorMessage}
      <p class="mx-auto mb-0 mt-4 max-w-[760px] rounded-lg border border-[#f0d6d6] bg-[#fff8f8] px-4 py-3 text-[10px] leading-[1.6] text-[#a44747]" role="alert">{errorMessage}</p>
    {/if}
    <p class="mb-0 mt-4 text-center text-[10px] text-[#858b98]" role="status" aria-live="polite">{statusMessage}</p>
  </div>

  <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-[#eceef2] px-6 py-4 text-[10px] text-[#8a909c] max-[600px]:px-4">
    <span>Processing happens locally in your browser.</span>
    <span>Each output is a new PDF; your original is unchanged.</span>
  </footer>
</section>

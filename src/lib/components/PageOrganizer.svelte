<script lang="ts">
  import { onMount } from 'svelte';
  import PdfThumbnail from '$lib/components/PdfThumbnail.svelte';
  import { createPdfDocumentTask } from '$lib/pdf/pdfjs-client';
  import type { PdfDocument, PdfDocumentTask } from '$lib/pdf/pdfjs-client';
  import {
    deletePages,
    duplicatePages,
    movePage,
    rotatePages,
    type OrganizablePage
  } from '$lib/pdf/page-organization';

  export let file: File;
  export let onClose: () => void;

  let pdfDocument: PdfDocument | null = null;
  let loadingTask: PdfDocumentTask | null = null;
  let pages: OrganizablePage[] = [];
  let selectedIds: string[] = [];
  let undoStack: OrganizablePage[][] = [];
  let redoStack: OrganizablePage[][] = [];
  let isLoading = true;
  let isExporting = false;
  let errorMessage = '';
  let statusMessage = 'Preparing your document…';
  let draggingPageId: string | null = null;
  let dragOverPageId: string | null = null;
  let selectedCount = 0;
  let allPagesSelected = false;

  $: selectedCount = selectedIds.length;
  $: allPagesSelected = pages.length > 0 && selectedCount === pages.length;

  onMount(() => {
    let disposed = false;

    async function loadDocument() {
      try {
        const task = await createPdfDocumentTask(file);
        if (disposed) {
          await task.destroy();
          return;
        }

        loadingTask = task;
        const document = await task.promise;
        if (disposed) return;

        pdfDocument = document;
        pages = Array.from({ length: document.numPages }, (_, index) => ({
          id: createPageId(),
          sourcePageIndex: index,
          rotationDelta: 0
        }));
        isLoading = false;
        statusMessage = document.numPages + (document.numPages === 1 ? ' page ready' : ' pages ready');
      } catch {
        if (disposed) return;
        isLoading = false;
        errorMessage = 'This PDF could not be opened. It may be damaged, unsupported, or password-protected.';
        statusMessage = 'Unable to open document';
      }
    }

    void loadDocument();

    return () => {
      disposed = true;
      if (loadingTask) void loadingTask.destroy().catch(() => undefined);
      loadingTask = null;
      pdfDocument = null;
    };
  });

  function createPageId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'page-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function clonePages(source: OrganizablePage[]): OrganizablePage[] {
    return source.map((page) => ({ ...page }));
  }

  function commitPages(nextPages: OrganizablePage[]) {
    if (nextPages === pages || nextPages.length === 0) return;
    undoStack = [...undoStack, clonePages(pages)].slice(-50);
    redoStack = [];
    pages = clonePages(nextPages);
    const currentIds = new Set(pages.map((page) => page.id));
    selectedIds = selectedIds.filter((id) => currentIds.has(id));
    errorMessage = '';
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack = [...redoStack, clonePages(pages)];
    pages = clonePages(undoStack[undoStack.length - 1]);
    undoStack = undoStack.slice(0, -1);
    const currentIds = new Set(pages.map((page) => page.id));
    selectedIds = selectedIds.filter((id) => currentIds.has(id));
    statusMessage = 'Last page change undone';
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack = [...undoStack, clonePages(pages)].slice(-50);
    pages = clonePages(redoStack[redoStack.length - 1]);
    redoStack = redoStack.slice(0, -1);
    const currentIds = new Set(pages.map((page) => page.id));
    selectedIds = selectedIds.filter((id) => currentIds.has(id));
    statusMessage = 'Page change restored';
  }

  function togglePageSelection(pageId: string) {
    selectedIds = selectedIds.includes(pageId)
      ? selectedIds.filter((id) => id !== pageId)
      : [...selectedIds, pageId];
  }

  function toggleSelectAll() {
    selectedIds = allPagesSelected ? [] : pages.map((page) => page.id);
  }

  function rotateSelected() {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    commitPages(rotatePages(pages, selectedIds));
    statusMessage = 'Rotated ' + count + (count === 1 ? ' page' : ' pages');
  }

  function rotateOne(pageId: string) {
    commitPages(rotatePages(pages, [pageId]));
    statusMessage = 'Page rotation updated';
  }

  function duplicateSelected() {
    if (selectedIds.length === 0) return;
    const originalIds = new Set(pages.map((page) => page.id));
    const nextPages = duplicatePages(pages, selectedIds, createPageId);
    const duplicateIds = nextPages.filter((page) => !originalIds.has(page.id)).map((page) => page.id);
    commitPages(nextPages);
    selectedIds = duplicateIds;
    statusMessage = 'Duplicated ' + duplicateIds.length + (duplicateIds.length === 1 ? ' page' : ' pages');
  }

  function removeSelected() {
    if (selectedIds.length === 0) return;
    if (selectedIds.length >= pages.length) {
      errorMessage = 'A PDF must contain at least one page. Select fewer pages to delete.';
      return;
    }

    const removedCount = selectedIds.length;
    commitPages(deletePages(pages, selectedIds));
    selectedIds = [];
    statusMessage = 'Removed ' + removedCount + (removedCount === 1 ? ' page' : ' pages');
  }

  function movePageBy(pageId: string, offset: number) {
    const index = pages.findIndex((page) => page.id === pageId);
    const targetIndex = index + offset;
    if (index < 0 || targetIndex < 0 || targetIndex >= pages.length) return;
    commitPages(movePage(pages, pageId, pages[targetIndex].id));
    statusMessage = 'Page order updated';
  }

  function handleDragStart(event: DragEvent, pageId: string) {
    draggingPageId = pageId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', pageId);
    }
  }

  function handleDragOver(event: DragEvent, pageId: string) {
    event.preventDefault();
    dragOverPageId = pageId;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(event: DragEvent, targetPageId: string) {
    event.preventDefault();
    const sourcePageId = event.dataTransfer?.getData('text/plain') || draggingPageId;
    if (sourcePageId) {
      commitPages(movePage(pages, sourcePageId, targetPageId));
      statusMessage = 'Page order updated';
    }
    draggingPageId = null;
    dragOverPageId = null;
  }

  function handleDragEnd() {
    draggingPageId = null;
    dragOverPageId = null;
  }

  async function exportPdf() {
    if (isExporting || pages.length === 0) return;

    const selected = new Set(selectedIds);
    const pagesToExport = selected.size > 0 ? pages.filter((page) => selected.has(page.id)) : pages;
    if (pagesToExport.length === 0) return;

    isExporting = true;
    errorMessage = '';
    statusMessage = 'Building your PDF…';

    try {
      const { PDFDocument, degrees } = await import('pdf-lib');
      const sourceDocument = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
      const outputDocument = await PDFDocument.create();

      for (const page of pagesToExport) {
        const [copiedPage] = await outputDocument.copyPages(sourceDocument, [page.sourcePageIndex]);
        if (page.rotationDelta !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          const nextRotation = (currentRotation + page.rotationDelta + 360) % 360;
          copiedPage.setRotation(degrees(nextRotation));
        }
        outputDocument.addPage(copiedPage);
      }

      const pdfBytes = await outputDocument.save();
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const baseName = file.name.replace(/\.pdf$/i, '') || 'document';
      const suffix = selected.size > 0 ? '-extracted.pdf' : '-organized.pdf';
      anchor.href = url;
      anchor.download = baseName + suffix;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);

      statusMessage = 'Downloaded ' + anchor.download;
    } catch {
      errorMessage = 'The PDF could not be exported. Try a different file or remove any unsupported encryption.';
      statusMessage = 'Export failed';
    } finally {
      isExporting = false;
    }
  }
</script>

<section class="mb-12 mt-8 overflow-hidden rounded-2xl border border-[#e5e8ef] bg-white shadow-[0_8px_30px_rgb(30_40_70_/_0.05)]">
  <header class="flex flex-wrap items-center justify-between gap-4 border-b border-[#eceef2] px-6 py-5 max-[600px]:px-4">
    <div>
      <p class="mb-1 text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">PDF WORKSPACE</p>
      <h1 class="m-0 font-display text-[23px] font-bold tracking-[-.7px] text-[#303542]">Organize pages</h1>
      <p class="mb-0 mt-1 text-[11px] leading-[1.6] text-[#858b98]">Reorder, rotate, duplicate, remove, or extract pages. Your original file stays unchanged.</p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-[#e2e5eb] bg-white px-3 text-[11px] font-semibold text-[#555d6b] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2"
      onclick={onClose}
    >← Back to tools</button>
  </header>

  <div class="flex flex-wrap items-center gap-2 border-b border-[#eceef2] bg-[#fbfcfe] px-5 py-3 max-[600px]:px-3">
    <button type="button" class="rounded-lg border border-[#e1e4eb] bg-white px-3 py-2 text-[10px] font-semibold text-[#586071] hover:bg-[#f5f6fa] disabled:cursor-not-allowed disabled:opacity-40" disabled={undoStack.length === 0} onclick={undo}>Undo</button>
    <button type="button" class="rounded-lg border border-[#e1e4eb] bg-white px-3 py-2 text-[10px] font-semibold text-[#586071] hover:bg-[#f5f6fa] disabled:cursor-not-allowed disabled:opacity-40" disabled={redoStack.length === 0} onclick={redo}>Redo</button>
    <span class="mx-1 hidden h-6 w-px bg-[#e5e8ef] sm:block"></span>
    <button type="button" class="rounded-lg border border-[#e1e4eb] bg-white px-3 py-2 text-[10px] font-semibold text-[#586071] hover:bg-[#f5f6fa] disabled:cursor-not-allowed disabled:opacity-40" disabled={pages.length === 0} aria-pressed={allPagesSelected} onclick={toggleSelectAll}>{allPagesSelected ? 'Clear selection' : 'Select all'}</button>
    <button type="button" class="rounded-lg border border-[#e1e4eb] bg-white px-3 py-2 text-[10px] font-semibold text-[#586071] hover:bg-[#f5f6fa] disabled:cursor-not-allowed disabled:opacity-40" disabled={selectedCount === 0} onclick={rotateSelected}>Rotate 90°</button>
    <button type="button" class="rounded-lg border border-[#e1e4eb] bg-white px-3 py-2 text-[10px] font-semibold text-[#586071] hover:bg-[#f5f6fa] disabled:cursor-not-allowed disabled:opacity-40" disabled={selectedCount === 0} onclick={duplicateSelected}>Duplicate</button>
    <button type="button" class="rounded-lg border border-[#f0d8d8] bg-white px-3 py-2 text-[10px] font-semibold text-[#b14c4c] hover:bg-[#fff6f6] disabled:cursor-not-allowed disabled:opacity-40" disabled={selectedCount === 0 || selectedCount >= pages.length} onclick={removeSelected}>Delete</button>
    <button type="button" class="ml-auto rounded-lg bg-brand-700 px-4 py-2 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={isLoading || isExporting || pages.length === 0} onclick={exportPdf}>{isExporting ? 'Preparing…' : selectedCount > 0 ? 'Export selected pages' : 'Download PDF'}</button>
  </div>

  <div class="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-[10px] text-[#858b98] max-[600px]:px-4">
    <span>{pages.length} {pages.length === 1 ? 'page' : 'pages'} in output · {selectedCount} selected</span>
    <span>Drag a page to reorder, or use the arrow controls</span>
  </div>

  <div class="min-h-[300px] bg-[#f6f7fa] px-6 pb-7 pt-2 max-[600px]:px-3">
    {#if isLoading}
      <div class="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
        <span class="size-7 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-700 motion-reduce:animate-none" aria-hidden="true"></span>
        <strong class="text-[12px] text-[#404655]">Opening your document</strong>
        <span class="text-[10px] text-[#9298a4]">Page previews are generated on this device.</span>
      </div>
    {:else if pdfDocument && pages.length > 0}
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" role="list" aria-label="PDF pages">
        {#each pages as page, index (page.id)}
          <div
            role="group"
            aria-label={'Page ' + (index + 1)}
            draggable="true"
            class={'min-w-0 rounded-xl border bg-white p-3 shadow-[0_2px_8px_rgb(30_40_70_/_0.04)] transition-all ' + (selectedIds.includes(page.id) ? 'border-brand-400 ring-2 ring-brand-100' : 'border-[#e5e8ef]') + (dragOverPageId === page.id ? ' border-brand-500 ring-2 ring-brand-200' : '') + (draggingPageId === page.id ? ' opacity-40' : '')}
            ondragstart={(event) => handleDragStart(event, page.id)}
            ondragover={(event) => handleDragOver(event, page.id)}
            ondrop={(event) => handleDrop(event, page.id)}
            ondragend={handleDragEnd}
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <label class="flex min-w-0 items-center gap-2 text-[10px] font-bold text-[#485061]">
                <input
                  type="checkbox"
                  class="size-3.5 accent-[#5c50c9]"
                  checked={selectedIds.includes(page.id)}
                  aria-label={'Select page ' + (index + 1)}
                  onchange={() => togglePageSelection(page.id)}
                />
                <span>Page {index + 1}</span>
              </label>
              {#if page.rotationDelta !== 0}
                <span class="rounded bg-[#f0effc] px-1.5 py-1 text-[8px] font-semibold text-brand-700">+{page.rotationDelta}°</span>
              {/if}
            </div>
            <div class="flex h-[178px] items-center justify-center overflow-hidden rounded-lg border border-[#e9ebf0] bg-[#f8f9fb] p-2">
              <PdfThumbnail document={pdfDocument} pageNumber={page.sourcePageIndex + 1} />
            </div>
            <div class="mt-3 flex items-center justify-between gap-1">
              <button
                type="button"
                class="grid size-7 place-items-center rounded-md border border-[#e5e7ed] bg-white text-[12px] font-bold text-[#626a78] hover:bg-[#f5f6fa] disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={'Move page ' + (index + 1) + ' up'}
                title="Move up"
                disabled={index === 0}
                onclick={() => movePageBy(page.id, -1)}
              >↑</button>
              <button
                type="button"
                class="grid size-7 place-items-center rounded-md border border-[#e5e7ed] bg-white text-[12px] font-bold text-[#626a78] hover:bg-[#f5f6fa] disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={'Move page ' + (index + 1) + ' down'}
                title="Move down"
                disabled={index === pages.length - 1}
                onclick={() => movePageBy(page.id, 1)}
              >↓</button>
              <button
                type="button"
                class="ml-auto rounded-md border border-[#e5e7ed] bg-white px-2 py-1.5 text-[9px] font-semibold text-[#626a78] hover:bg-[#f5f6fa]"
                aria-label={'Rotate page ' + (index + 1) + ' 90 degrees clockwise'}
                onclick={() => rotateOne(page.id)}
              >Rotate ↻</button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="flex min-h-[260px] items-center justify-center text-center text-[11px] text-[#7e8592]">No pages are available to display.</div>
    {/if}

    {#if errorMessage}
      <p class="mb-0 mt-4 rounded-lg border border-[#f0d6d6] bg-[#fff8f8] px-4 py-3 text-[10px] leading-[1.6] text-[#a44747]" role="alert">{errorMessage}</p>
    {/if}
    <p class="mb-0 mt-4 text-center text-[10px] text-[#858b98]" role="status" aria-live="polite">{statusMessage}</p>
  </div>

  <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-[#eceef2] px-6 py-4 text-[10px] text-[#8a909c] max-[600px]:px-4">
    <span>Processing happens locally in your browser.</span>
    <span>Export creates a new PDF; it never overwrites the source file.</span>
  </footer>
</section>

<script lang="ts">
  import { onMount } from 'svelte';
  import ThumbnailSidebar from '$lib/components/ThumbnailSidebar.svelte';
  import { createPdfDocumentTask } from '$lib/pdf/pdfjs-client';
  import type { PdfDocument, PdfDocumentTask, PdfPage, PdfRenderTask } from '$lib/pdf/pdfjs-client';
  import { clampPageNumber, clampZoom } from '$lib/pdf/viewer-utils';
  import { findTextMatches, type PdfTextMatch } from '$lib/pdf/pdf-search';

  export let file: File;
  export let onClose: () => void;

  const MAX_CANVAS_PIXELS = 16_000_000;

  let pdfDocument: PdfDocument | null = null;
  let loadingTask: PdfDocumentTask | null = null;
  let renderTask: PdfRenderTask | null = null;
  let canvasElement: HTMLCanvasElement;
  let viewerViewport: HTMLDivElement;
  let resizeObserver: ResizeObserver | undefined;
  let renderSequence = 0;
  let lastViewportWidth = 0;
  let destroyed = false;
  let fitToWidth = true;
  let isMobileViewport = false;
  let thumbnailsOpen = true;
  let isLoading = true;
  let isRendering = false;
  let currentPage = 1;
  let targetPage = 1;
  let totalPages = 0;
  let zoom = 1;
  let statusText = 'Preparing your document…';
  let errorMessage = '';
  let searchQuery = '';
  let searchResults: PdfTextMatch[] = [];
  let isSearching = false;
  let searchError = '';
  let searchSequence = 0;

  onMount(() => {
    const mobileViewport = window.matchMedia('(max-width: 760px)');
    const syncViewportMode = () => {
      isMobileViewport = mobileViewport.matches;
      thumbnailsOpen = !isMobileViewport;
    };
    syncViewportMode();
    mobileViewport.addEventListener('change', syncViewportMode);

    const loadDocument = async () => {
      try {
        loadingTask = await createPdfDocumentTask(file);
        if (destroyed) {
          await loadingTask.destroy();
          return;
        }

        pdfDocument = await loadingTask.promise;
        // The component may have been closed while PDF.js was resolving the document.
        // Its loading task is destroyed by onMount cleanup; do not update stale UI.
        if (destroyed) return;
        totalPages = pdfDocument.numPages;
        isLoading = false;
        statusText = `${totalPages} ${totalPages === 1 ? 'page' : 'pages'} loaded`;
        await renderPage(1, true);
      } catch {
        if (destroyed) return;
        isLoading = false;
        errorMessage = 'This PDF could not be opened. It may be damaged, unsupported, or password-protected.';
        statusText = 'Unable to open document';
      }
    };

    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width && Math.abs(width - lastViewportWidth) > 1) {
        lastViewportWidth = width;
        if (fitToWidth && pdfDocument && !destroyed) {
          void renderPage(targetPage, true);
        }
      }
    });
    if (viewerViewport) resizeObserver.observe(viewerViewport);

    void loadDocument();

    return () => {
      mobileViewport.removeEventListener('change', syncViewportMode);
      destroyed = true;
      renderSequence += 1;
      searchSequence += 1;
      resizeObserver?.disconnect();
      renderTask?.cancel();
      if (loadingTask) {
        // Destroying the loading task also releases its resolved document and worker.
        // Swallow cleanup rejection because the component is already being removed.
        void loadingTask.destroy().catch(() => undefined);
        loadingTask = null;
      }
      pdfDocument = null;
    };
  });

  async function renderPage(requestedPage: number, recalculateFit = false) {
    const document = pdfDocument;
    if (!document || destroyed) return;

    const sequence = ++renderSequence;
    const previousTask = renderTask;
    if (previousTask) {
      previousTask.cancel();
      try {
        await previousTask.promise;
      } catch {
        // A cancelled render rejects by design; the next render owns the canvas.
      }
    }
    if (destroyed || sequence !== renderSequence) return;

    isRendering = true;
    errorMessage = '';
    statusText = 'Rendering page…';
    let activeTask: PdfRenderTask | null = null;
    let pageToCleanup: PdfPage | null = null;

    try {
      const pageNumber = clampPageNumber(requestedPage, totalPages);
      targetPage = pageNumber;
      statusText = `Rendering page ${pageNumber} of ${totalPages}…`;
      const page = await document.getPage(pageNumber);
      pageToCleanup = page;
      if (destroyed || sequence !== renderSequence) {
        return;
      }

      const pageAtDefaultScale = page.getViewport({ scale: 1 });
      if (recalculateFit || fitToWidth) {
        const availableWidth = Math.max(240, (viewerViewport?.clientWidth ?? pageAtDefaultScale.width) - 52);
        zoom = clampZoom(availableWidth / pageAtDefaultScale.width);
      }

      const viewport = page.getViewport({ scale: zoom });
      const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      const pixelBudgetScale = Math.sqrt(
        MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)
      );
      const outputScale = Math.min(deviceScale, pixelBudgetScale);
      if (!canvasElement) {
        throw new Error('Canvas rendering is not available in this browser.');
      }

      canvasElement.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvasElement.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvasElement.style.width = `${Math.floor(viewport.width)}px`;
      canvasElement.style.height = `${Math.floor(viewport.height)}px`;
      activeTask = page.render({
        canvas: canvasElement,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
      });
      renderTask = activeTask;
      await activeTask.promise;

      if (!destroyed && sequence === renderSequence) {
        currentPage = pageNumber;
        targetPage = pageNumber;
        statusText = `Page ${currentPage} of ${totalPages} · ${Math.round(zoom * 100)}%`;
      }
    } catch (error) {
      if (!destroyed && sequence === renderSequence) {
        const errorName = error instanceof Error ? error.name : '';
        if (errorName !== 'RenderingCancelledException') {
          errorMessage = 'This page could not be rendered. Try another page or reopen the file.';
          statusText = 'Page rendering failed';
        }
      }
    } finally {
      pageToCleanup?.cleanup();
      if (renderTask === activeTask) renderTask = null;
      if (!destroyed && sequence === renderSequence) isRendering = false;
    }
  }

  function goToPage(pageNumber: number) {
    targetPage = clampPageNumber(pageNumber, totalPages);
    void renderPage(targetPage);
  }

  function selectThumbnailPage(pageNumber: number) {
    goToPage(pageNumber);
    if (isMobileViewport) thumbnailsOpen = false;
  }

  function changeZoom(amount: number) {
    fitToWidth = false;
    zoom = clampZoom(zoom + amount);
    void renderPage(targetPage);
  }

  function fitPageToWidth() {
    fitToWidth = true;
    void renderPage(targetPage, true);
  }

  async function searchDocument() {
    const document = pdfDocument;
    const query = searchQuery.trim();
    const sequence = ++searchSequence;
    searchResults = [];
    searchError = '';

    if (!document || !query || destroyed) {
      isSearching = false;
      return;
    }

    isSearching = true;
    try {
      const results: PdfTextMatch[] = [];
      for (let pageNumber = 1; pageNumber <= totalPages && results.length < 100; pageNumber += 1) {
        if (destroyed || sequence !== searchSequence) return;
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' ');
        results.push(...findTextMatches(pageText, query, pageNumber, 100 - results.length));
      }

      if (!destroyed && sequence === searchSequence) {
        searchResults = results.slice(0, 100);
        if (searchResults.length === 0) searchError = 'No matches found in this document.';
      }
    } catch {
      if (!destroyed && sequence === searchSequence) searchError = 'Text search could not complete for this document.';
    } finally {
      if (!destroyed && sequence === searchSequence) isSearching = false;
    }
  }

  function clearSearch() {
    searchSequence += 1;
    searchQuery = '';
    searchResults = [];
    searchError = '';
    isSearching = false;
  }

  function formatFileSize(size: number) {
    if (size < 1_048_576) return `${Math.max(1, Math.round(size / 1_024))} KB`;
    return `${(size / 1_048_576).toFixed(2)} MB`;
  }
</script>

<svelte:head>
  <title>{file.name} — PDF Utils</title>
</svelte:head>

<section class="mx-auto my-7 mb-10 flex min-h-[min(78vh,900px)] w-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_34px_rgb(29_35_51_/_0.05)] max-[760px]:my-[18px] max-[760px]:mb-[30px] max-[760px]:min-h-[74vh]" aria-label="PDF viewer">
  <header class="flex min-h-[76px] items-center justify-between gap-[18px] border-b border-[#e9ebf0] bg-white px-[18px] py-3 max-[760px]:flex-wrap max-[760px]:gap-3 max-[760px]:p-3 max-[420px]:p-[10px]">
    <div class="flex min-w-0 items-center gap-[11px] max-[760px]:basis-[calc(100%-100px)]">
      <span class="grid size-[42px] shrink-0 place-items-center rounded-lg border border-brand-200 bg-brand-50 text-[9px] font-extrabold tracking-[.3px] text-brand-600" aria-hidden="true">PDF</span>
      <div class="flex min-w-0 flex-col gap-1">
        <strong class="max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold text-[#292d38] max-[760px]:max-w-[min(58vw,360px)]" title={file.name}>{file.name}</strong>
        <span class="text-[10px] text-subtle">{formatFileSize(file.size)} · {totalPages > 0 ? `${totalPages} pages` : 'Local document'}</span>
      </div>
    </div>

    <div class="flex items-center justify-center gap-[14px] max-[760px]:order-3 max-[760px]:w-full max-[760px]:justify-between max-[760px]:gap-[7px] max-[760px]:border-t max-[760px]:border-[#f0f1f4] max-[760px]:pt-[10px]" aria-label="PDF controls">
      <button
      type="button"
      class="hidden min-h-[34px] items-center justify-center rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 max-[760px]:inline-flex"
      aria-label={thumbnailsOpen ? 'Hide pages' : 'Show pages'}
      aria-expanded={thumbnailsOpen}
      aria-controls="pdf-thumbnails"
      onclick={() => (thumbnailsOpen = !thumbnailsOpen)}
    >
      {thumbnailsOpen ? 'Hide pages' : 'Show pages'}
    </button>
    <div class="flex items-center gap-[7px] max-[420px]:gap-[3px]" aria-label="Page navigation">
        <button type="button" class="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line bg-white p-0 text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Previous page" title="Previous page" disabled={isLoading || targetPage <= 1} onclick={() => goToPage(targetPage - 1)}>
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>
        </button>
        <span class="flex min-w-[52px] items-center justify-center gap-1.5 text-[11px] text-[#7c8290]"><strong class="font-semibold text-[#303541] [font-variant-numeric:tabular-nums]">{totalPages ? currentPage : '—'}</strong><span>/</span>{totalPages || '—'}</span>
        <button type="button" class="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line bg-white p-0 text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Next page" title="Next page" disabled={isLoading || targetPage >= totalPages} onclick={() => goToPage(targetPage + 1)}>
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7" /></svg>
        </button>
      </div>

      <span class="h-6 w-px bg-[#e7e9ee]" aria-hidden="true"></span>

      <div class="flex items-center gap-[7px] max-[420px]:gap-[3px]" aria-label="Zoom controls">
        <button type="button" class="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line bg-white p-0 text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Zoom out" title="Zoom out" disabled={isLoading || zoom <= 0.5} onclick={() => changeZoom(-0.25)}>
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <span class="min-w-[43px] text-center text-[10px] text-[#6d7380] [font-variant-numeric:tabular-nums]" aria-live="off">{Math.round(zoom * 100)}%</span>
        <button type="button" class="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line bg-white p-0 text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" aria-label="Zoom in" title="Zoom in" disabled={isLoading || zoom >= 3} onclick={() => changeZoom(0.25)}>
          <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" class={`inline-flex min-h-[30px] items-center justify-center rounded-lg border border-line bg-white px-[9px] text-[10px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf] max-[420px]:px-[7px] ${fitToWidth ? "border-brand-200 bg-brand-50 text-brand-600" : ""}` } aria-pressed={fitToWidth} disabled={isLoading} onclick={fitPageToWidth}>Fit width</button>
      </div>
    </div>

    <button type="button" class="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf] max-[760px]:ml-auto max-[420px]:min-h-8" aria-label="Close document" onclick={onClose}>
      <svg class="size-4 shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      <span>Close</span>
    </button>
  </header>

  <form class="flex flex-wrap items-center gap-[9px] border-b border-[#e9ebf0] bg-white px-4 py-3 max-[480px]:p-[10px]" onsubmit={(event) => { event.preventDefault(); void searchDocument(); }}>
    <label class="text-[11px] font-bold text-[#535a68] max-[480px]:w-full" for="pdf-search-input">Find in document</label>
    <div class="flex min-w-[min(100%,260px)] flex-1 items-center gap-[7px] max-[480px]:min-w-0">
      <input class="h-[34px] min-w-0 flex-1 rounded-lg border border-[#e0e3ea] bg-[#fbfcfe] px-[10px] text-[12px] text-[#303541] outline-none placeholder:text-[#8a909c] focus-visible:border-brand-300 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-1 disabled:bg-[#f6f7f9] disabled:text-[#9da2ad]" id="pdf-search-input" type="search" value={searchQuery} placeholder="Search text…" autocomplete="off" disabled={isLoading || !pdfDocument} oninput={(event) => (searchQuery = (event.currentTarget as HTMLInputElement).value)} />
      <button type="submit" class="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" disabled={isLoading || isSearching || !searchQuery.trim()}>Find</button>
      {#if searchQuery}<button type="button" class="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" onclick={clearSearch} aria-label="Clear search">Clear</button>{/if}
    </div>
  </form>
  {#if isSearching || searchResults.length > 0 || searchError}
    <section class="max-h-[250px] overflow-auto border-b border-[#e9ebf0] bg-[#fbfbfd]" aria-label="Search results" aria-live="polite">
      {#if isSearching}
        <p class="m-0 px-4 py-[10px] text-[11px] text-[#858b98]">Searching document text…</p>
      {:else if searchResults.length > 0}
        <p class="m-0 px-4 py-[10px] text-[11px] text-[#858b98]">{searchResults.length === 100 ? "100+ matches (showing first 100)" : `${searchResults.length} ${searchResults.length === 1 ? "match" : "matches"} found`}</p>
        <ol class="grid list-none gap-0.5 px-2 pb-2">
          {#each searchResults as result, index (`${result.pageNumber}-${result.index}-${index}`)}
            <li><button type="button" class="flex w-full items-start gap-3 rounded-lg border border-transparent bg-transparent px-2 py-[9px] text-left text-[#515765] hover:border-brand-100 hover:bg-brand-50 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-1 max-[480px]:gap-[7px] max-[480px]:px-[5px] max-[480px]:py-2" onclick={() => goToPage(result.pageNumber)}>
              <span class="w-[54px] shrink-0 text-[10px] font-bold text-brand-600 max-[480px]:w-12">Page {result.pageNumber}</span>
              <span class="min-w-0 text-[11px] leading-[1.5] text-[#6d7380] [overflow-wrap:anywhere]">{result.snippet.slice(0, result.matchStart)}<mark class="rounded-sm bg-brand-100 px-px text-brand-900">{result.matchText}</mark>{result.snippet.slice(result.matchStart + result.matchText.length)}</span>
            </button></li>
          {/each}
        </ol>
      {:else}
        <p class="m-0 px-4 py-[10px] text-[11px] text-[#858b98]" role="status">{searchError}</p>
      {/if}
    </section>
  {/if}
  <div class="flex min-h-[35px] items-center justify-center gap-2 border-b border-[#e9ebf0] bg-[#fbfbfd] text-[10px] text-subtle [font-variant-numeric:tabular-nums]" role="status" aria-live="polite" aria-atomic="true">
    {#if isLoading}
      <span class="size-[15px] animate-spin rounded-full border-2 border-brand-100 border-t-brand-600 motion-reduce:animate-none" aria-hidden="true"></span>
    {/if}
    {statusText}
  </div>

  {#if errorMessage}
    <div class="flex min-h-[320px] flex-1 flex-col items-center justify-center px-5 py-9 text-center" role="alert">
      <strong class="text-[14px] font-bold text-[#343946]">Unable to display this document</strong>
      <p class="mb-[18px] mt-2 max-w-[420px] text-[12px] leading-[1.6] text-[#7d8491]">{errorMessage}</p>
      <button type="button" class="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-[7px] rounded-lg border border-line bg-white px-[10px] text-[11px] font-semibold text-[#454b59] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#f8f9fb] disabled:text-[#b2b6bf]" onclick={onClose}>Return to tools</button>
    </div>
  {:else}
    <div class="flex min-h-[520px] min-w-0 flex-1 max-[760px]:min-h-[460px]">
      {#if pdfDocument && totalPages > 0}
        <div
          id="pdf-thumbnails"
          style:display={isMobileViewport && !thumbnailsOpen ? 'none' : 'contents'}
          aria-hidden={isMobileViewport && !thumbnailsOpen}
        >
          <ThumbnailSidebar
            document={pdfDocument}
            {totalPages}
            {currentPage}
            onSelectPage={selectThumbnailPage}
          />
        </div>
      {/if}
      <div class="flex min-h-[520px] min-w-0 flex-1 flex-col items-center overflow-auto overscroll-contain bg-[#eef0f4] p-[26px] max-h-[78vh] max-[760px]:min-h-[460px] max-[760px]:max-h-[70vh] max-[760px]:items-start max-[760px]:p-4 max-[420px]:min-h-[390px] max-[420px]:p-[10px]" bind:this={viewerViewport} role="region" aria-label="Document page area">
        {#if isLoading}
          <div class="m-auto flex min-h-[180px] flex-col items-center justify-center gap-2 text-center text-[#5e6471]">
            <span class="size-7 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-600 motion-reduce:animate-none" aria-hidden="true"></span>
            <strong class="mt-1.5 text-[13px] font-bold text-[#343946]">Opening your PDF</strong>
            <p class="m-0 text-[11px] text-[#89909d]">Your document is being processed on this device.</p>
          </div>
        {/if}
        <div class={`my-auto flex-none bg-white shadow-[0_4px_18px_rgb(29_35_51_/_0.13)] ${isRendering ? "opacity-80" : ""}` } >
          <canvas bind:this={canvasElement} class="block max-w-none bg-white" aria-label={`Page ${currentPage} of ${totalPages || 'document'}`}></canvas>
        </div>
      </div>
    </div>
  {/if}
</section>
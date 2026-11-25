<script lang="ts">
  import { onMount } from 'svelte';
  import { createPdfDocumentTask } from '$lib/pdf/pdfjs-client';
  import type { PdfDocument, PdfDocumentTask, PdfPage, PdfRenderTask } from '$lib/pdf/pdfjs-client';
  import { clampPageNumber, clampZoom } from '$lib/pdf/viewer-utils';

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
  let isLoading = true;
  let isRendering = false;
  let currentPage = 1;
  let targetPage = 1;
  let totalPages = 0;
  let zoom = 1;
  let statusText = 'Preparing your document…';
  let errorMessage = '';

  onMount(() => {
    const loadDocument = async () => {
      try {
        loadingTask = await createPdfDocumentTask(file);
        if (destroyed) {
          await loadingTask.destroy();
          return;
        }

        pdfDocument = await loadingTask.promise;
        if (destroyed) return;
        totalPages = loadedDocument.numPages;
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
      destroyed = true;
      renderSequence += 1;
      resizeObserver?.disconnect();
      renderTask?.cancel();
      if (loadingTask) {
        void loadingTask.destroy();
      } else if (pdfDocument) {
        void pdfDocument.destroy();
      }
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

  function changeZoom(amount: number) {
    fitToWidth = false;
    zoom = clampZoom(zoom + amount);
    void renderPage(targetPage);
  }

  function fitPageToWidth() {
    fitToWidth = true;
    void renderPage(targetPage, true);
  }

  function formatFileSize(size: number) {
    if (size < 1_048_576) return `${Math.max(1, Math.round(size / 1_024))} KB`;
    return `${(size / 1_048_576).toFixed(2)} MB`;
  }
</script>

<svelte:head>
  <title>{file.name} — PDF Utils</title>
</svelte:head>

<section class="viewer-shell" aria-label="PDF viewer">
  <header class="viewer-toolbar">
    <div class="viewer-file-info">
      <span class="viewer-file-icon" aria-hidden="true">PDF</span>
      <div class="viewer-file-meta">
        <strong title={file.name}>{file.name}</strong>
        <span>{formatFileSize(file.size)} · {totalPages > 0 ? `${totalPages} pages` : 'Local document'}</span>
      </div>
    </div>

    <div class="viewer-controls" aria-label="PDF controls">
      <div class="viewer-control-group" aria-label="Page navigation">
        <button type="button" class="viewer-button icon-button" aria-label="Previous page" title="Previous page" disabled={isLoading || targetPage <= 1} onclick={() => goToPage(targetPage - 1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>
        </button>
        <span class="viewer-page-count"><strong>{totalPages ? currentPage : '—'}</strong><span>/</span>{totalPages || '—'}</span>
        <button type="button" class="viewer-button icon-button" aria-label="Next page" title="Next page" disabled={isLoading || targetPage >= totalPages} onclick={() => goToPage(targetPage + 1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7" /></svg>
        </button>
      </div>

      <span class="viewer-toolbar-divider" aria-hidden="true"></span>

      <div class="viewer-control-group" aria-label="Zoom controls">
        <button type="button" class="viewer-button icon-button" aria-label="Zoom out" title="Zoom out" disabled={isLoading || zoom <= 0.5} onclick={() => changeZoom(-0.25)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <span class="viewer-zoom-value" aria-live="off">{Math.round(zoom * 100)}%</span>
        <button type="button" class="viewer-button icon-button" aria-label="Zoom in" title="Zoom in" disabled={isLoading || zoom >= 3} onclick={() => changeZoom(0.25)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" class:active={fitToWidth} class="viewer-button fit-button" aria-pressed={fitToWidth} disabled={isLoading} onclick={fitPageToWidth}>Fit width</button>
      </div>
    </div>

    <button type="button" class="viewer-button close-button" aria-label="Close document" onclick={onClose}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      <span>Close</span>
    </button>
  </header>

  <div class="viewer-status" role="status" aria-live="polite" aria-atomic="true">
    {#if isLoading}
      <span class="viewer-spinner" aria-hidden="true"></span>
    {/if}
    {statusText}
  </div>

  {#if errorMessage}
    <div class="viewer-error" role="alert">
      <strong>Unable to display this document</strong>
      <p>{errorMessage}</p>
      <button type="button" class="viewer-button" onclick={onClose}>Return to tools</button>
    </div>
  {:else}
    <div class="viewer-stage" bind:this={viewerViewport} role="region" aria-label="Document page area" tabindex="0">
      {#if isLoading}
        <div class="viewer-loading-card">
          <span class="viewer-spinner large" aria-hidden="true"></span>
          <strong>Opening your PDF</strong>
          <p>Your document is being processed on this device.</p>
        </div>
      {/if}
      <div class="viewer-canvas-wrap" class:rendering={isRendering}>
        <canvas bind:this={canvasElement} class="viewer-canvas" aria-label={`Page ${currentPage} of ${totalPages || 'document'}`}></canvas>
      </div>
    </div>
  {/if}
</section>
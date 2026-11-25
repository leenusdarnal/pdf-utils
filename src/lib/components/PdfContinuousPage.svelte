<script lang="ts">
  import { onMount } from 'svelte';
  import { createPdfTextLayerTask } from '$lib/pdf/pdfjs-client';
  import type { PdfDocument, PdfPage, PdfRenderTask, PdfTextLayerTask } from '$lib/pdf/pdfjs-client';

  export let pdfDocument: PdfDocument;
  export let pageNumber: number;
  export let zoom: number;
  export let scrollRoot: HTMLElement;
  export let onVisiblePage: (page: number) => void = () => undefined;

  const MAX_CANVAS_PIXELS = 16_000_000;

  let pageElement: HTMLDivElement;
  let pageFrame: HTMLDivElement;
  let canvasElement: HTMLCanvasElement;
  let textLayerElement: HTMLDivElement;
  let page: PdfPage | null = null;
  let renderTask: PdfRenderTask | null = null;
  let textLayerTask: PdfTextLayerTask | null = null;
  let loadObserver: IntersectionObserver | null = null;
  let focusObserver: IntersectionObserver | null = null;
  let baseWidth = 612;
  let baseHeight = 792;
  let isLoading = true;
  let isNearViewport = false;
  let hasRendered = false;
  let renderError = '';
  let destroyed = false;
  let renderSequence = 0;
  let lastZoom = zoom;

  $: pageWidth = Math.max(1, Math.ceil(baseWidth * zoom));
  $: pageHeight = Math.max(1, Math.ceil(baseHeight * zoom));

  $: if (page && lastZoom !== zoom) {
    lastZoom = zoom;
    if (pageFrame) {
      pageFrame.style.width = `${pageWidth}px`;
      pageFrame.style.height = `${pageHeight}px`;
    }
    if (isNearViewport) void renderPage();
  }

  onMount(() => {
    let disposed = false;

    const loadPage = async () => {
      try {
        const loadedPage = await pdfDocument.getPage(pageNumber);
        if (disposed) {
          loadedPage.cleanup();
          return;
        }
        page = loadedPage;
        const baseViewport = loadedPage.getViewport({ scale: 1 });
        baseWidth = baseViewport.width;
        baseHeight = baseViewport.height;
        isLoading = false;
        if (isNearViewport) void renderPage();
      } catch {
        if (!disposed) {
          isLoading = false;
          renderError = 'This page could not be loaded.';
        }
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      isNearViewport = true;
      void loadPage();
      return () => {
        disposed = true;
        cleanup();
      };
    }

    loadObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          isNearViewport = true;
          if (page && !hasRendered) void renderPage();
        } else {
          isNearViewport = false;
          unloadPage();
        }
      },
      { root: scrollRoot, rootMargin: '900px 0px', threshold: 0 }
    );
    loadObserver.observe(pageElement);

    focusObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onVisiblePage(pageNumber);
        }
      },
      { root: scrollRoot, rootMargin: '-40% 0px -40% 0px', threshold: 0 }
    );
    focusObserver.observe(pageElement);

    void loadPage();

    return () => {
      disposed = true;
      cleanup();
    };
  });

  async function renderPage() {
    if (!page || !canvasElement || !textLayerElement || destroyed || !isNearViewport) return;

    const sequence = ++renderSequence;
    const previousTask = renderTask;
    renderTask = null;
    previousTask?.cancel();
    if (previousTask) {
      try {
        await previousTask.promise;
      } catch {
        // A cancelled PDF.js render rejects by design.
      }
    }
    if (destroyed || sequence !== renderSequence || !isNearViewport) return;

    const previousTextTask = textLayerTask;
    textLayerTask = null;
    previousTextTask?.cancel();
    textLayerElement.replaceChildren();
    renderError = '';

    let activeTask: PdfRenderTask | null = null;
    try {
      const viewport = page.getViewport({ scale: zoom });
      const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      const pixelBudgetScale = Math.sqrt(
        MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)
      );
      const outputScale = Math.min(deviceScale, pixelBudgetScale);

      pageFrame.style.width = `${Math.ceil(viewport.width)}px`;
      pageFrame.style.height = `${Math.ceil(viewport.height)}px`;
      canvasElement.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvasElement.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvasElement.style.width = `${Math.ceil(viewport.width)}px`;
      canvasElement.style.height = `${Math.ceil(viewport.height)}px`;

      activeTask = page.render({
        canvas: canvasElement,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
      });
      renderTask = activeTask;
      await activeTask.promise;

      if (destroyed || sequence !== renderSequence || !isNearViewport) return;

      textLayerElement.style.width = `${Math.ceil(viewport.width)}px`;
      textLayerElement.style.height = `${Math.ceil(viewport.height)}px`;
      const nextTextTask = await createPdfTextLayerTask(page, textLayerElement, viewport);
      if (destroyed || sequence !== renderSequence || !isNearViewport) {
        nextTextTask.cancel();
        return;
      }

      textLayerTask = nextTextTask;
      await nextTextTask.promise;
      if (textLayerTask === nextTextTask) textLayerTask = null;
      hasRendered = true;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      if (!destroyed && sequence === renderSequence && errorName !== 'RenderingCancelledException') {
        renderError = 'This page could not be rendered.';
      }
    } finally {
      if (renderTask === activeTask) renderTask = null;
    }
  }

  function unloadPage() {
    renderSequence += 1;
    renderTask?.cancel();
    renderTask = null;
    textLayerTask?.cancel();
    textLayerTask = null;
    if (canvasElement) {
      canvasElement.width = 0;
      canvasElement.height = 0;
      canvasElement.style.width = '0px';
      canvasElement.style.height = '0px';
    }
    textLayerElement?.replaceChildren();
    hasRendered = false;
  }

  function cleanup() {
    destroyed = true;
    loadObserver?.disconnect();
    focusObserver?.disconnect();
    unloadPage();
    page?.cleanup();
    page = null;
  }
</script>

<div
  bind:this={pageElement}
  data-pdf-continuous-page={pageNumber}
  class="flex w-full shrink-0 justify-center"
  aria-label={`PDF page ${pageNumber}`}
>
  <div
    bind:this={pageFrame}
    class="relative flex-none overflow-hidden bg-white shadow-[0_4px_18px_rgb(29_35_51_/_0.13)]"
    style={`width:${pageWidth}px;height:${pageHeight}px;`}
  >
    {#if isLoading}
      <div class="absolute inset-0 grid place-items-center bg-white text-[11px] text-[#9298a4]">Loading page {pageNumber}…</div>
    {:else if renderError}
      <div class="absolute inset-0 grid place-items-center bg-white px-4 text-center text-[11px] text-[#a44747]" role="alert">{renderError}</div>
    {/if}
    <canvas
      bind:this={canvasElement}
      class="relative z-0 block max-w-none bg-white"
      aria-label={`Page ${pageNumber} of PDF`}
    ></canvas>
    <div
      bind:this={textLayerElement}
      class="textLayer absolute left-0 top-0 z-10 select-text"
      role="group"
      aria-label={`Selectable text for page ${pageNumber}`}
    ></div>
    {#if !hasRendered && !isLoading && !renderError}
      <span class="sr-only">Page {pageNumber} preview is loading</span>
    {/if}
  </div>
</div>

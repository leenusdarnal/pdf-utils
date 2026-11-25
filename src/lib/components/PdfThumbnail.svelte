<script lang="ts">
  import { onMount } from 'svelte';
  import type { PdfDocument, PdfPage, PdfRenderTask } from '$lib/pdf/pdfjs-client';

  export let document: PdfDocument;
  export let pageNumber: number;

  let canvasElement: HTMLCanvasElement;
  let page: PdfPage | null = null;
  let renderTask: PdfRenderTask | null = null;
  let disposed = false;
  let failed = false;

  onMount(() => {
    void renderThumbnail();

    return () => {
      disposed = true;
      renderTask?.cancel();
      page?.cleanup();
    };
  });

  async function renderThumbnail() {
    try {
      const thumbnailPage = await document.getPage(pageNumber);
      page = thumbnailPage;

      if (disposed) {
        thumbnailPage.cleanup();
        return;
      }

      const originalViewport = thumbnailPage.getViewport({ scale: 1 });
      const scale = Math.min(88 / originalViewport.width, 88 / originalViewport.height);
      const viewport = thumbnailPage.getViewport({ scale });

      if (!canvasElement || disposed) return;

      canvasElement.width = Math.max(1, Math.floor(viewport.width));
      canvasElement.height = Math.max(1, Math.floor(viewport.height));
      canvasElement.style.width = `${Math.floor(viewport.width)}px`;
      canvasElement.style.height = `${Math.floor(viewport.height)}px`;

      renderTask = thumbnailPage.render({ canvas: canvasElement, viewport });
      await renderTask.promise;
    } catch {
      if (!disposed) failed = true;
    } finally {
      page?.cleanup();
      renderTask = null;
    }
  }
</script>

{#if failed}
  <span class="thumbnail-fallback" aria-hidden="true">Preview unavailable</span>
{:else}
  <canvas bind:this={canvasElement} aria-hidden="true"></canvas>
{/if}

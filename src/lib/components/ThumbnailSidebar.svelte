<script lang="ts">
  import { onMount } from 'svelte';
  import PdfThumbnail from '$lib/components/PdfThumbnail.svelte';
  import type { PdfDocument } from '$lib/pdf/pdfjs-client';
  import { getVisiblePageRange } from '$lib/pdf/viewer-utils';

  export let document: PdfDocument;
  export let totalPages: number;
  export let currentPage: number;
  export let onSelectPage: (pageNumber: number) => void;

  const ITEM_HEIGHT = 124;
  const OVERSCAN = 3;

  let viewport: HTMLDivElement;
  let scrollTop = 0;
  let viewportHeight = 480;

  $: visibleRange = getVisiblePageRange(
    totalPages,
    scrollTop,
    viewportHeight,
    ITEM_HEIGHT,
    OVERSCAN
  );
  $: visiblePages =
    visibleRange.startPage === 0
      ? []
      : Array.from(
          { length: visibleRange.endPage - visibleRange.startPage + 1 },
          (_, index) => visibleRange.startPage + index
        );

  // Keep the selected page in view when the main toolbar changes pages.
  $: if (viewport && currentPage > 0) {
    const pageTop = (currentPage - 1) * ITEM_HEIGHT;
    if (pageTop < viewport.scrollTop) {
      viewport.scrollTop = pageTop;
    } else if (pageTop + ITEM_HEIGHT > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = pageTop + ITEM_HEIGHT - viewport.clientHeight;
    }
  }

  onMount(() => {
    const updateViewport = () => {
      scrollTop = viewport.scrollTop;
      viewportHeight = viewport.clientHeight;
    };

    updateViewport();
    viewport.addEventListener('scroll', updateViewport, { passive: true });
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(viewport);

    return () => {
      viewport.removeEventListener('scroll', updateViewport);
      resizeObserver.disconnect();
    };
  });
</script>

<aside class="thumbnail-sidebar" aria-label="Page navigation">
  <div class="thumbnail-sidebar-heading">
    <strong>Pages</strong>
    <span>{totalPages}</span>
  </div>
  <div
    class="thumbnail-viewport"
    bind:this={viewport}
    role="region"
    tabindex="0"
    aria-label="PDF page thumbnails"
  >
    <div class="thumbnail-spacer" style={`height: ${totalPages * ITEM_HEIGHT}px`}>
      {#each visiblePages as pageNumber (pageNumber)}
        <div
          class="thumbnail-slot"
          style={`transform: translateY(${(pageNumber - 1) * ITEM_HEIGHT}px)`}
        >
          <button
            type="button"
            class="thumbnail-button"
            class:active={pageNumber === currentPage}
            aria-label={`Go to page ${pageNumber}`}
            aria-current={pageNumber === currentPage ? 'page' : undefined}
            onclick={() => onSelectPage(pageNumber)}
          >
            <span class="thumbnail-preview">
              <PdfThumbnail {document} {pageNumber} />
            </span>
            <span class="thumbnail-page-number">Page {pageNumber}</span>
          </button>
        </div>
      {/each}
    </div>
  </div>
</aside>

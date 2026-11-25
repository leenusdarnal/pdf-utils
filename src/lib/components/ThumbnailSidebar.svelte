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

<aside class="flex w-[164px] min-w-0 shrink-0 flex-col border-r border-[#e5e7ed] bg-[#f8f9fb] max-[760px]:w-[116px] max-[420px]:w-[88px]" aria-label="Page navigation">
  <div class="flex shrink-0 items-center justify-between border-b border-[#e8eaf0] px-[14px] py-[13px] text-[10px] text-[#535a68] max-[760px]:px-2.5 max-[760px]:py-2.5">
    <strong class="text-[11px] font-bold text-[#343946]">Pages</strong>
    <span class="text-subtle [font-variant-numeric:tabular-nums]">{totalPages}</span>
  </div>
  <div
    class="relative min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable]"
    bind:this={viewport}
    role="region"
    tabindex="0"
    aria-label="PDF page thumbnails"
  >
    <div class="relative w-full" style={`height: ${totalPages * ITEM_HEIGHT}px`}>
      {#each visiblePages as pageNumber (pageNumber)}
        <div
          class="absolute inset-x-0 top-0 h-[124px] px-[9px] py-[3px] max-[760px]:px-[5px] max-[420px]:p-[3px]"
          style={`transform: translateY(${(pageNumber - 1) * ITEM_HEIGHT}px)`}
        >
          <button
            type="button"
            class={`flex h-[118px] w-full flex-col items-center justify-center gap-1 rounded-lg border border-transparent bg-transparent px-[7px] py-[5px] text-[#727987] transition-colors hover:border-[#e0def3] hover:bg-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-1 max-[760px]:px-1 max-[420px]:p-[3px] ${pageNumber === currentPage ? "border-brand-200 bg-brand-100 text-brand-600" : ""}` }
            aria-label={`Go to page ${pageNumber}`}
            aria-current={pageNumber === currentPage ? 'page' : undefined}
            onclick={() => onSelectPage(pageNumber)}
          >
            <span class="flex h-[88px] w-full items-center justify-center overflow-hidden rounded border border-[#e5e7ed] bg-white max-[760px]:h-[84px]">
              <PdfThumbnail {document} {pageNumber} />
            </span>
            <span class="text-[9px] leading-[13px]">Page {pageNumber}</span>
          </button>
        </div>
      {/each}
    </div>
  </div>
</aside>

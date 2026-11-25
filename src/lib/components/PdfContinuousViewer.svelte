<script lang="ts">
  import { onMount, tick } from 'svelte';
  import PdfContinuousPage from '$lib/components/PdfContinuousPage.svelte';
  import type { PdfDocument } from '$lib/pdf/pdfjs-client';

  export let pdfDocument: PdfDocument;
  export let totalPages: number;
  export let zoom: number;
  export let scrollRoot: HTMLElement;
  export let initialPage = 1;
  export let onPageChange: (pageNumber: number) => void = () => undefined;

  let pageList: HTMLDivElement;
  $: pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);

  onMount(async () => {
    await tick();
    scrollToPage(initialPage, false);
  });

  export function scrollToPage(pageNumber: number, smooth = true) {
    const target = Math.max(1, Math.min(totalPages, Math.round(pageNumber)));
    const page = pageList?.querySelector<HTMLElement>(`[data-pdf-continuous-page="${target}"]`);
    page?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'start'
    });
  }
</script>

<div bind:this={pageList} class="flex w-full min-w-0 flex-col gap-6 pb-6">
  {#each pageNumbers as pageNumber (pageNumber)}
    <PdfContinuousPage
      {pdfDocument}
      {pageNumber}
      {zoom}
      {scrollRoot}
      onVisiblePage={onPageChange}
    />
  {/each}
</div>

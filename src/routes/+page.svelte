<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import PdfViewer from '$lib/components/PdfViewer.svelte';
  import PageOrganizer from '$lib/components/PageOrganizer.svelte';
  import MergePdf from '$lib/components/MergePdf.svelte';
  import SplitPdf from '$lib/components/SplitPdf.svelte';
  import PdfToImages from '$lib/components/PdfToImages.svelte';
  import ImagesToPdf from '$lib/components/ImagesToPdf.svelte';
  import CompressPdf from '$lib/components/CompressPdf.svelte';
  import ExtractImages from '$lib/components/ExtractImages.svelte';
  import PdfTextExport from '$lib/components/PdfTextExport.svelte';
  import SearchableOcr from '$lib/components/SearchableOcr.svelte';
  import WatermarkPageNumbers from '$lib/components/WatermarkPageNumbers.svelte';
  import NUpPdf from '$lib/components/NUpPdf.svelte';
  import RepairPdf from '$lib/components/RepairPdf.svelte';
  import ComparePdfs from '$lib/components/ComparePdfs.svelte';
  import TextImageOverlay from '$lib/components/TextImageOverlay.svelte';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';

  let isDragging = false;
  let isValidating = false;
  let selectedFile: File | null = null;
  let organizeFile: File | null = null;
  let mergeMode = false;
  let splitMode = false;
  let imageMode = false;
  let imagesToPdfMode = false;
  let compressMode = false;
  let extractImagesMode = false;
  let textExportMode = false;
  let searchableOcrMode = false;
  let watermarkPageNumbersMode = false;
  let nUpMode = false;
  let compareMode = false;
  let repairMode = false;
  let textImageOverlayMode = false;
  let isDarkMode = false;
  let appReady = false;
  let organizerInput: HTMLInputElement;
  let fileError = '';

  let systemThemeQuery: MediaQueryList | null = null;

  function syncSystemTheme(event: MediaQueryListEvent) {
    applyTheme(event.matches ? 'dark' : 'light', false);
  }

  function applyTheme(theme: 'light' | 'dark', persist = true) {
    isDarkMode = theme === 'dark';
    document.documentElement.dataset.theme = theme;
    if (persist) {
      systemThemeQuery?.removeEventListener('change', syncSystemTheme);
      systemThemeQuery = null;
      try {
        localStorage.setItem('pdf-utils-theme', theme);
      } catch {
        // The current session theme still works when storage is unavailable.
      }
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      isDarkMode ? '#10131b' : '#f7f8fa'
    );
  }

  onMount(() => {
    let savedTheme: string | null = null;
    let systemPreference: MediaQueryList | null = null;
    try {
      savedTheme = localStorage.getItem('pdf-utils-theme');
      systemPreference = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    } catch {
      // Continue with the browser default when storage or media queries are unavailable.
    }

    if (savedTheme === 'light' || savedTheme === 'dark') {
      applyTheme(savedTheme, false);
    } else {
      applyTheme(systemPreference?.matches ? 'dark' : 'light', false);
      if (systemPreference) {
        systemThemeQuery = systemPreference;
        systemPreference.addEventListener('change', syncSystemTheme);
      }
    }
    appReady = true;

    return () => {
      systemThemeQuery?.removeEventListener('change', syncSystemTheme);
      systemThemeQuery = null;
    };
  });

  function toggleTheme() {
    applyTheme(isDarkMode ? 'light' : 'dark');
  }

  async function acceptFile(file: File | undefined) {
    if (!file || isValidating) return;

    fileError = '';
    isValidating = true;
    try {
      const isPdf = await hasPdfHeader(file);
      if (!isPdf) {
        fileError = 'This file does not look like a valid PDF. Choose a PDF document and try again.';
        return;
      }
      selectedFile = file;
    } catch {
      fileError = 'The selected file could not be read. Please try another PDF.';
    } finally {
      isValidating = false;
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    void acceptFile(event.dataTransfer?.files?.[0]);
  }

  function handlePick(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    void acceptFile(file);
  }

  async function handleOrganizerPick(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file || isValidating) return;

    fileError = '';
    isValidating = true;
    try {
      const isPdf = await hasPdfHeader(file);
      if (!isPdf) {
        fileError = 'This file does not look like a valid PDF. Choose a PDF document and try again.';
        return;
      }
      organizeFile = file;
    } catch {
      fileError = 'The selected file could not be read. Please try another PDF.';
    } finally {
      isValidating = false;
    }
  }

  function closeDocument() {
    selectedFile = null;
    fileError = '';
  }
</script>

<svelte:head>
  <title>PDF Utils — Your documents, handled locally</title>
  <meta name="description" content="A lightweight, privacy-first workspace for everyday PDF tasks. Your files stay on your device." />
</svelte:head>

<div class="mx-auto w-full max-w-[1440px] px-[7.1%] max-[760px]:px-[5%]">
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="flex h-[88px] items-center gap-[52px] border-b border-[#e9ebef] max-[760px]:h-[70px] max-[760px]:gap-[22px] max-[480px]:gap-[15px]">
    <a class="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap font-display text-[22px] font-extrabold leading-none tracking-[-1.1px] no-underline max-[480px]:text-[19px]" href={`${base}/`} aria-label="PDF Utils home">
      <span class="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-brand-700 text-white max-[480px]:size-[30px]" aria-hidden="true">
        <svg class="size-[21px]" viewBox="0 0 24 24" fill="none"><path d="M6.5 3.75h7l4 4v12.5H6.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 3.75v4h4M8.75 13h6.5M8.75 16h4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </span>
      <span>pdf<span class="font-medium text-[#8c91a0]">utils</span></span>
    </a>
    {#if !selectedFile && !organizeFile && !mergeMode && !splitMode && !imageMode && !imagesToPdfMode && !compressMode && !extractImagesMode && !textExportMode && !searchableOcrMode && !watermarkPageNumbersMode && !nUpMode && !compareMode && !repairMode && !textImageOverlayMode}
      <nav class="ml-auto flex h-full items-center gap-[30px] max-[760px]:gap-[17px]" aria-label="Main navigation">
        <a class="relative inline-flex h-full items-center text-[13px] font-semibold text-ink no-underline after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-0.5 after:bg-brand-700 max-[760px]:text-[11px]" href="#tools">Tools</a>
        <a class="inline-flex h-full items-center text-[13px] font-semibold text-muted no-underline transition-colors hover:text-brand-700 max-[760px]:text-[11px] max-[480px]:hidden" href="#how-it-works">How it works</a>
      </nav>
    {/if}
    <div class="ml-auto flex items-center gap-2 rounded-full border border-[#e2e5ea] bg-white px-[13px] py-[9px] text-[11px] font-semibold text-[#626977] max-[760px]:px-[10px] max-[760px]:py-2 max-[760px]:text-[0px] max-[480px]:hidden"><span class="size-1.5 rounded-full bg-success-500 max-[760px]:size-[7px]"></span> Files stay on your device</div>
    <button
      type="button"
      class="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[#e2e5ea] bg-white text-[#535b69] transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2 max-[480px]:size-9"
      aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDarkMode}
      title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      onclick={toggleTheme}
    >
      {#if isDarkMode}
        <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      {:else}
        <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.8 8.8 0 1 0 20.2 15.1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      {/if}
    </button>
  </header>

  <main id="main-content" tabindex="-1" data-app-ready={appReady}>
    {#if selectedFile}
      <PdfViewer file={selectedFile} onClose={closeDocument} />
    {:else if organizeFile}
      <PageOrganizer file={organizeFile} onClose={() => (organizeFile = null)} />
    {:else if mergeMode}
      <MergePdf onClose={() => (mergeMode = false)} />
    {:else if splitMode}
      <SplitPdf onClose={() => (splitMode = false)} />
    {:else if imageMode}
      <PdfToImages onClose={() => (imageMode = false)} />
    {:else if imagesToPdfMode}
      <ImagesToPdf onClose={() => (imagesToPdfMode = false)} />
    {:else if compressMode}
      <CompressPdf onClose={() => (compressMode = false)} />
    {:else if extractImagesMode}
      <ExtractImages onClose={() => (extractImagesMode = false)} />
    {:else if textExportMode}
      <PdfTextExport onClose={() => (textExportMode = false)} />
    {:else if searchableOcrMode}
      <SearchableOcr onClose={() => (searchableOcrMode = false)} />
    {:else if watermarkPageNumbersMode}
      <WatermarkPageNumbers onClose={() => (watermarkPageNumbersMode = false)} />
    {:else if nUpMode}
      <NUpPdf onClose={() => (nUpMode = false)} />
    {:else if compareMode}
      <ComparePdfs onClose={() => (compareMode = false)} />
    {:else if repairMode}
      <RepairPdf onClose={() => (repairMode = false)} />
    {:else if textImageOverlayMode}
      <TextImageOverlay onClose={() => (textImageOverlayMode = false)} />
    {:else}
      <section class="py-[77px] text-center max-[760px]:pb-[54px] max-[760px]:pt-[61px] max-[480px]:pt-[49px]">
        <div class="inline-flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[1.7px] text-brand-600 max-[480px]:text-[8px] max-[480px]:tracking-[1.2px]"><span class="h-px w-[22px] bg-brand-300"></span> A calmer way to work with PDFs</div>
        <h1 class="mx-auto mb-4 mt-5 font-display text-[clamp(42px,5.2vw,66px)] font-extrabold leading-[1.08] tracking-[-3.4px] max-[760px]:tracking-[-2px] max-[480px]:text-[43px]">Your documents.<br /><span class="text-brand-600">Handled locally.</span></h1>
        <p class="mx-auto max-w-[500px] text-[15px] leading-[1.8] text-muted max-[760px]:max-w-[410px] max-[760px]:text-[13px] max-[480px]:text-[12px]">Everything you need to view, organize, and refine PDFs — without sending your files to a server.</p>

        <div
          class={`relative mx-auto mt-[34px] min-h-[244px] max-w-[590px] rounded-[14px] border border-dashed border-[#c9cbd7] bg-white/80 px-5 pb-[19px] pt-[27px] transition-colors focus-within:outline focus-within:outline-[3px] focus-within:outline-brand-200 focus-within:outline-offset-[3px] max-[760px]:min-h-[230px] max-[480px]:px-[14px] max-[480px]:pb-[17px] max-[480px]:pt-[23px] ${isDragging ? "border-brand-700 bg-brand-50" : ""}` }
          role="region"
          aria-label="Choose a PDF to open"
          ondragover={(event) => { event.preventDefault(); isDragging = true; }}
          ondragleave={() => (isDragging = false)}
          ondrop={handleDrop}
        >
          <input id="file-input" class="sr-only" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
          <input class="sr-only" type="file" accept="application/pdf,.pdf" bind:this={organizerInput} onchange={handleOrganizerPick} />
          <div class="mx-auto mb-3 grid size-[43px] place-items-center rounded-xl border border-brand-200 bg-brand-50 text-brand-600" aria-hidden="true">
            <svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v4A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          {#if isValidating}
            <div class="mb-1.5 text-[15px] font-bold text-[#30333c]">Checking your PDF…</div>
            <div class="text-[12px] text-subtle">The file is checked locally on your device.</div>
          {:else}
            <div class="mb-1.5 text-[15px] font-bold text-[#30333c]">Drop a PDF to get started</div>
            <div class="text-[12px] text-subtle">or <label for="file-input" class="cursor-pointer font-bold text-brand-700 underline underline-offset-[3px]">choose a file</label> from your device</div>
          {/if}
          {#if fileError}
            <p class="mx-auto mt-[14px] max-w-[440px] text-[12px] leading-[1.55] text-danger-600" role="alert">{fileError}</p>
          {/if}
          <div class="mt-[27px] border-t border-[#eef0f3] pt-[15px] text-[10px] text-[#969ba6]"><span class="align-[-1px] text-[14px] text-[#6cba94]">⌑</span> Private by design <span class="mx-2">·</span> No account required</div>
        </div>
        <p class="mt-[15px] text-[11px] text-[#999eaa]">PDF viewer and tools are being built in the open. <a class="font-semibold text-brand-600 no-underline hover:underline" href="https://github.com/leenusdarnal/pdf-utils" target="_blank" rel="noreferrer">View the project on GitHub ↗</a></p>
      </section>

      <section class="border-t border-[#e9ebef] pb-[65px] pt-10" id="tools">
        <div class="mb-[25px] flex items-end justify-between max-[760px]:items-start max-[760px]:gap-[15px] max-[480px]:flex-col">
          <div>
            <div class="mb-[9px] text-[9px] font-bold uppercase tracking-[1.6px] text-brand-600">THE TOOLKIT</div>
            <h2 class="font-display text-[23px] font-bold leading-[1.3] tracking-[-.8px] max-[480px]:text-[21px]">One workspace. Useful tools.</h2>
          </div>
          <span class="rounded-[7px] border border-[#e5e3f7] bg-brand-50 px-[10px] py-[7px] text-[10px] font-semibold text-brand-600 max-[760px]:text-[9px]">Viewer MVP in progress</span>
        </div>
        <div class="grid grid-cols-2 gap-[13px] max-[760px]:grid-cols-1">
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-brand-100 text-brand-600"><svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="M5 3.5h9l5 5v12H5zM14 3.5v5h5M8 13h8M8 16h6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg></span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">View & read</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Open and navigate your documents.</p></div>
            <span class="ml-auto self-start whitespace-nowrap text-[9px] text-[#9a9eaa] max-[480px]:hidden">Available</span>
          </article>
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#eaf4ff] text-[#4f8fce]"><svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="M4 5.5h6v6H4zM14 5.5h6v6h-6zM4 15.5h6v4H4zM14 15.5h6v4h-6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Organize pages</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Reorder, rotate, duplicate, delete, and extract pages.</p></div>
            <button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" onclick={() => organizerInput?.click()}>Open tool</button>
          </article>
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#eef4ff] text-[#4f8fce]" aria-hidden="true">
              <svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="M8 7H4V3M4 7l5-5m7 15h4v4m0-4-5 5M5 12h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Merge PDFs</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Combine multiple files in your chosen order.</p></div>
            <button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open merge tool" onclick={() => (mergeMode = true)}>Open tool</button>
          </article>
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#fff2e9] text-[#cc8052]" aria-hidden="true">
              <svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="M5 4v16M19 4v16M5 8h5m4 0h5M5 16h5m4 0h5M10 6l2 2-2 2m4 4-2 2 2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Split PDF</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Create separate files from custom page ranges.</p></div>
            <button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open split tool" onclick={() => (splitMode = true)}>Open tool</button>
          </article>
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#fff5e5] text-[#c18a36]"><svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="m4 17 9.8-9.8 3 3L7 20H4zM14.5 6.5l2-2a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Annotate</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Highlight, add notes, and mark up pages.</p></div>
            <span class="ml-auto self-start whitespace-nowrap text-[9px] text-[#9a9eaa] max-[480px]:hidden">Planned</span>
          </article>
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#eef4ff] text-[#4f8fce] text-[10px] font-bold">TXT</span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Add text &amp; images</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Place a new text or image layer on a page and export a copy.</p></div>
            <button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open text and image overlay tool" onclick={() => (textImageOverlayMode = true)}>Open tool</button>
          </article>
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#e9f8f1] text-[#39a17d]"><svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="M12 3.5v11m0 0 4-4m-4 4-4-4M5 15.5v3A2 2 0 0 0 7 20.5h10a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">PDF to images</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Export pages as PNG or JPEG with resolution controls.</p></div>
            <button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open PDF to images tool" onclick={() => (imageMode = true)}>Open tool</button>
          </article>
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#eef4ff] text-[#4f8fce]" aria-hidden="true"><svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Images to PDF</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Combine JPG, PNG, or WebP images with page layout controls.</p></div>
            <button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open images to PDF tool" onclick={() => (imagesToPdfMode = true)}>Open tool</button>
          </article>
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#fff2e9] text-[#c77c4f]" aria-hidden="true"><svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M7 4v6m10-6v6M5 13h14v7H5zM8 16h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Compress PDF</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Create a smaller image-based copy with size and quality controls.</p></div>
            <button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open compress PDF tool" onclick={() => (compressMode = true)}>Open tool</button>
          </article>
          <article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]">
            <span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#e9f8f1] text-[#39a17d]" aria-hidden="true"><svg class="size-[22px]" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v14H4zM8 9h.01M4 15l5-4 3 3 3-2 5 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Extract embedded images</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Recover image objects from PDF content, not page screenshots.</p></div>
            <button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open extract embedded images tool" onclick={() => (extractImagesMode = true)}>Open tool</button>
          </article>
<article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]"><span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#eef4ff] text-[#4f8fce]">TXT</span><div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">PDF to Text &amp; Markdown</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Export selectable text with page boundaries as TXT or Markdown.</p></div><button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white" aria-label="Open PDF text export tool" onclick={() => (textExportMode = true)}>Open tool</button></article>
<article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]"><span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#e9f8f1] text-[#39a17d] font-bold text-[11px]">OCR</span><div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Searchable OCR</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Recognize English text in scanned PDFs and add a searchable layer.</p></div><button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open searchable OCR tool" onclick={() => (searchableOcrMode = true)}>Open tool</button></article>
<article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]"><span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#fff2e9] text-[#c77c4f] text-[11px] font-bold">WM</span><div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Watermark &amp; Page Numbers</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Stamp pages with styled text and page-number formats.</p></div><button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open watermark and page numbers tool" onclick={() => (watermarkPageNumbersMode = true)}>Open tool</button></article>
<article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]"><span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#eef4ff] text-[#4f8fce] text-[11px] font-bold">N-UP</span><div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">N-up PDF layout</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Arrange 2, 4, 6 or more PDF pages on each print-ready sheet.</p></div><button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open N-up layout tool" onclick={() => (nUpMode = true)}>Open tool</button></article>
<article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]"><span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#e9f8f1] text-[#39a17d] text-[11px] font-bold">DIFF</span><div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Compare PDFs</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Compare page text, rendered appearance, and page-count changes locally.</p></div><button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open PDF comparison tool" onclick={() => (compareMode = true)}>Open tool</button></article>
<article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]"><span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#fff2e9] text-[#c77c4f] text-[11px] font-bold">FIX</span><div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Repair PDF</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Rebuild supported PDF structure and verify page content remains unchanged.</p></div><button type="button" class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-brand-200 focus-visible:outline-offset-2" aria-label="Open PDF repair tool" onclick={() => (repairMode = true)}>Open tool</button></article>
<article class="flex min-h-[102px] items-center gap-[14px] rounded-[11px] border border-[#e8eaf0] bg-white p-[19px] max-[480px]:gap-3 max-[480px]:p-[15px]"><span class="grid size-[42px] shrink-0 place-items-center rounded-[11px] bg-[#e9f8f1] text-[#39a17d] text-[11px] font-bold">UNLOCK</span><div class="min-w-0"><h3 class="mb-[5px] text-[13px] font-bold">Unlock PDF</h3><p class="mb-0 text-[11px] leading-[1.5] text-[#878d99]">Remove a known password locally and download an unlocked, image-based copy.</p></div><a class="ml-auto shrink-0 rounded-lg bg-brand-700 px-3 py-2 text-[10px] font-bold text-white no-underline transition-colors hover:bg-brand-800" href="./unlock-pdf" aria-label="Open PDF password removal tool">Open tool</a></article>
        </div>
      </section>

      <section class="mb-[50px] flex items-center gap-[17px] rounded-xl border border-[#e7e8f1] bg-[#f1f0fa] px-6 py-[22px] max-[760px]:flex-wrap max-[760px]:items-start max-[760px]:p-[18px]" id="how-it-works">
        <div class="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#e4e1fa] text-brand-600" aria-hidden="true"><svg class="size-[21px]" viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div>
        <div class="min-w-0"><h2 class="mb-1 font-display text-[14px] font-bold">Private by default</h2><p class="mb-0 text-[11px] leading-[1.6] text-[#7f8491]">PDF Utils processes your chosen document in your browser. Files are not uploaded as part of the viewer workflow.</p></div>
        <a class="ml-auto whitespace-nowrap text-[11px] font-bold text-brand-600 no-underline hover:underline max-[760px]:ml-[57px]" href="https://github.com/leenusdarnal/pdf-utils" target="_blank" rel="noreferrer">Explore the code <span class="ml-[5px]">↗</span></a>
      </section>
    {/if}
  </main>

  <footer class="flex justify-between border-t border-[#e9ebef] py-5 pb-[25px] text-[10px] text-[#a0a4ae] max-[480px]:flex-wrap max-[480px]:gap-3"><span>© 2026 PDF Utils</span><span>Built for useful, everyday document work.</span></footer>
</div>
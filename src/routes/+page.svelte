<script lang="ts">
  import PdfViewer from '$lib/components/PdfViewer.svelte';
  import { hasPdfHeader } from '$lib/pdf/viewer-utils';

  let isDragging = false;
  let isValidating = false;
  let selectedFile: File | null = null;
  let fileError = '';

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

  function closeDocument() {
    selectedFile = null;
    fileError = '';
  }
</script>

<svelte:head>
  <title>PDF Utils — Your documents, handled locally</title>
  <meta name="description" content="A lightweight, privacy-first workspace for everyday PDF tasks. Your files stay on your device." />
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="PDF Utils home">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6.5 3.75h7l4 4v12.5H6.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 3.75v4h4M8.75 13h6.5M8.75 16h4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </span>
      <span>pdf<span class="brand-light">utils</span></span>
    </a>
    {#if !selectedFile}
      <nav class="top-nav" aria-label="Main navigation">
        <a class="nav-active" href="#tools">Tools</a>
        <a href="#how-it-works">How it works</a>
      </nav>
    {/if}
    <div class="privacy-pill"><span></span> Files stay on your device</div>
  </header>

  <main>
    {#if selectedFile}
      <PdfViewer file={selectedFile} onClose={closeDocument} />
    {:else}
      <section class="hero">
        <div class="eyebrow"><span class="eyebrow-line"></span> A calmer way to work with PDFs</div>
        <h1>Your documents.<br /><span>Handled locally.</span></h1>
        <p class="hero-copy">Everything you need to view, organize, and refine PDFs — without sending your files to a server.</p>

        <div
          class:dragging={isDragging}
          class="dropzone"
          ondragover={(event) => { event.preventDefault(); isDragging = true; }}
          ondragleave={() => (isDragging = false)}
          ondrop={handleDrop}
        >
          <input id="file-input" class="visually-hidden" type="file" accept="application/pdf,.pdf" onchange={handlePick} />
          <div class="upload-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v4A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          {#if isValidating}
            <div class="drop-title">Checking your PDF…</div>
            <div class="drop-subtitle">The file is checked locally on your device.</div>
          {:else}
            <div class="drop-title">Drop a PDF to get started</div>
            <div class="drop-subtitle">or <label for="file-input" class="browse-link">choose a file</label> from your device</div>
          {/if}
          {#if fileError}
            <p class="upload-error" role="alert">{fileError}</p>
          {/if}
          <div class="drop-footer"><span class="lock-icon">⌑</span> Private by design <span class="dot-separator">·</span> No account required</div>
        </div>
        <p class="hero-note">PDF viewer and tools are being built in the open. <a href="https://github.com/leenusdarnal/pdf-utils" target="_blank" rel="noreferrer">View the project on GitHub ↗</a></p>
      </section>

      <section class="tools-section" id="tools">
        <div class="section-heading">
          <div>
            <div class="section-kicker">THE TOOLKIT</div>
            <h2>One workspace. Useful tools.</h2>
          </div>
          <span class="coming-soon">Viewer MVP in progress</span>
        </div>
        <div class="tool-grid">
          <article class="tool-card">
            <span class="tool-icon purple"><svg viewBox="0 0 24 24" fill="none"><path d="M5 3.5h9l5 5v12H5zM14 3.5v5h5M8 13h8M8 16h6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg></span>
            <div><h3>View & read</h3><p>Open and navigate your documents.</p></div>
            <span class="tool-status">Available</span>
          </article>
          <article class="tool-card">
            <span class="tool-icon blue"><svg viewBox="0 0 24 24" fill="none"><path d="M4 5.5h6v6H4zM14 5.5h6v6h-6zM4 15.5h6v4H4zM14 15.5h6v4h-6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>
            <div><h3>Organize pages</h3><p>Merge, split, rotate, and reorder pages.</p></div>
            <span class="tool-status">Planned</span>
          </article>
          <article class="tool-card">
            <span class="tool-icon amber"><svg viewBox="0 0 24 24" fill="none"><path d="m4 17 9.8-9.8 3 3L7 20H4zM14.5 6.5l2-2a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>
            <div><h3>Annotate</h3><p>Highlight, add notes, and mark up pages.</p></div>
            <span class="tool-status">Planned</span>
          </article>
          <article class="tool-card">
            <span class="tool-icon green"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5v11m0 0 4-4m-4 4-4-4M5 15.5v3A2 2 0 0 0 7 20.5h10a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            <div><h3>Convert & export</h3><p>Move between PDF and common image formats.</p></div>
            <span class="tool-status">Planned</span>
          </article>
        </div>
      </section>

      <section class="local-section" id="how-it-works">
        <div class="local-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div>
        <div><h2>Private by default</h2><p>PDF Utils processes your chosen document in your browser. Files are not uploaded as part of the viewer workflow.</p></div>
        <a href="https://github.com/leenusdarnal/pdf-utils" target="_blank" rel="noreferrer">Explore the code <span>↗</span></a>
      </section>
    {/if}
  </main>

  <footer><span>© 2026 PDF Utils</span><span>Built for useful, everyday document work.</span></footer>
</div>
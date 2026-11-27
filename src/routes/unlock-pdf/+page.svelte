<script lang="ts">
  import { base } from '$app/paths';
  import { PDFDocument } from 'pdf-lib';
  import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const MAX_PAGE_PIXELS = 16_000_000;
  let sourceFile: File | null = null;
  let password = '';
  let busy = false;
  let progress = '';
  let error = '';
  let output: Blob | null = null;
  let outputName = '';

  function chooseFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    sourceFile = input.files?.[0] ?? null;
    input.value = '';
    output = null;
    error = '';
    progress = '';
  }

  async function unlock() {
    if (!sourceFile || busy) return;
    if (sourceFile.size > MAX_FILE_BYTES) {
      error = 'This tool supports PDFs up to 100 MB.';
      return;
    }
    busy = true;
    error = '';
    output = null;
    progress = 'Opening PDF locally…';
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(await sourceFile.arrayBuffer()),
        password
      });
      const source = await loadingTask.promise;
      const rebuilt = await PDFDocument.create();

      for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
        progress = `Rendering page ${pageNumber} of ${source.numPages}…`;
        const page = await source.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1.5, Math.sqrt(MAX_PAGE_PIXELS / (baseViewport.width * baseViewport.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser could not create a canvas for PDF rendering.');
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const png = await new Promise<Uint8Array>((resolve, reject) => {
          canvas.toBlob(async (blob) => {
            if (!blob) return reject(new Error('Could not render a PDF page.'));
            try {
              resolve(new Uint8Array(await blob.arrayBuffer()));
            } catch (reason) {
              reject(reason);
            }
          }, 'image/png');
        });
        const embedded = await rebuilt.embedPng(png);
        const outputPage = rebuilt.addPage([viewport.width, viewport.height]);
        outputPage.drawImage(embedded, { x: 0, y: 0, width: viewport.width, height: viewport.height });
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }

      const bytes = await rebuilt.save();
      output = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      outputName = sourceFile.name.replace(/\.pdf$/i, '') + '-unlocked.pdf';
      progress = 'Unlocked copy ready. Note: pages are flattened images.';
    } catch (reason) {
      const exception = reason as { name?: string; message?: string };
      if (exception?.name === 'PasswordException') {
        error = 'The password was incorrect, or this PDF uses encryption that this browser cannot open.';
      } else {
        error = exception?.message || 'This PDF could not be unlocked. The original file is unchanged.';
      }
      progress = '';
    } finally {
      busy = false;
      password = '';
    }
  }

  function download() {
    if (!output) return;
    const url = URL.createObjectURL(output);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = outputName;
    anchor.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head>
  <title>Unlock PDF — PDF Utils</title>
  <meta name="description" content="Remove PDF password protection locally when you know the password. Files stay on your device." />
</svelte:head>

<main class="mx-auto w-full max-w-3xl px-5 py-12">
  <a class="text-sm font-semibold text-brand-700 hover:underline" href={`${base}/`}>← All PDF tools</a>
  <section class="mt-6 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-9" aria-labelledby="unlock-title">
    <p class="text-xs font-bold uppercase tracking-widest text-brand-600">PDF SECURITY</p>
    <h1 id="unlock-title" class="mt-2 text-3xl font-bold tracking-tight text-ink">Unlock PDF</h1>
    <p class="mt-3 max-w-xl text-sm leading-6 text-muted">Remove password protection from a PDF using its existing password. Processing happens in your browser; your file is not uploaded.</p>

    <label class="mt-7 block text-sm font-semibold text-ink" for="unlock-file">Choose a password-protected PDF</label>
    <input id="unlock-file" class="mt-2 block w-full rounded-lg border border-line bg-surface p-3 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold" type="file" accept="application/pdf,.pdf" onchange={chooseFile} disabled={busy} />

    <label class="mt-5 block text-sm font-semibold text-ink" for="unlock-password">PDF password</label>
    <input id="unlock-password" class="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-3 text-sm text-ink" type="password" autocomplete="current-password" bind:value={password} placeholder="Enter the password" disabled={busy} />

    <button class="mt-5 w-full rounded-lg bg-brand-700 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50" type="button" onclick={unlock} disabled={!sourceFile || !password || busy}>
      {busy ? 'Unlocking…' : 'Unlock PDF'}
    </button>

    {#if progress}
      <p class="mt-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-800" role="status">{progress}</p>
    {/if}
    {#if error}
      <p class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>
    {/if}
    {#if output}
      <button class="mt-4 w-full rounded-lg border border-brand-700 px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50" type="button" onclick={download}>Download unlocked PDF</button>
    {/if}

    <aside class="mt-7 rounded-lg border border-line bg-surface-muted p-4 text-xs leading-5 text-muted">
      <strong class="text-ink">Please note:</strong> This creates a new PDF by rendering each page as an image. Text selection, links, forms, bookmarks, and other interactive elements are not preserved. Use only with documents you are authorized to unlock. The source file is never modified.
    </aside>
  </section>
</main>

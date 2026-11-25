# PDF Viewer MVP Design

**Date:** 2026-11-25  
**Status:** Approved by direct continuation request

## Intent

Turn the foundation's PDF file picker into a useful local PDF viewer. The main workflow is: choose or drop a PDF, validate it, render the first page, and let the user move through pages and adjust zoom without uploading the document.

## Goals

- Accept local PDFs through the existing file picker and drag/drop area.
- Verify the PDF header before passing the bytes to the parser; do not trust the filename or MIME type alone.
- Render pages with Mozilla PDF.js using its display API and bundled worker.
- Provide previous/next navigation, a page number indicator, zoom out/in, a fit-width mode, and a close-document action.
- Show readable loading, empty, invalid-file, and rendering-error states.
- Keep all document processing in the browser and release PDF.js resources when the viewer closes.

## Non-goals for this slice

- Full-text search, selectable text layer, thumbnails, annotations, printing, page operations, password prompt, and document metadata panel.
- Editing or modifying the original PDF.
- Server uploads, accounts, storage, or analytics.

## Approaches considered

1. **Embed Mozilla's generic viewer:** feature-rich, but brings a large viewer UI and styling surface that duplicates our product design.
2. **Use a third-party Svelte PDF wrapper:** quicker initial wiring, but adds another dependency and an abstraction we do not need for a focused canvas viewer.
3. **Use PDF.js display API behind a small browser adapter and Svelte component (chosen):** small integration surface, explicit lifecycle, product-owned controls, and no document upload.

## Architecture and decisions

- Add pdfjs-dist 6.5.438 as a runtime dependency, verified against the npm registry on 2026-11-25. The registry reports Apache-2.0. Its published engine requirement is Node.js 22.13.0 or newer (or Node.js 24+), which is reflected in package.json and .nvmrc.
- Keep PDF.js loading/worker configuration in `src/lib/pdf/pdfjs-client.ts`; dynamically import the display API in the browser and configure GlobalWorkerOptions.workerSrc to the Vite-emitted pdf.worker.mjs asset.
- Read the selected File locally into a Uint8Array and pass the bytes to getDocument({ data }).
- Keep file signature validation and pure page/zoom bounds helpers in src/lib/pdf/ so they can be tested without a DOM.
- Keep rendering, navigation, and PDF resource lifecycle in src/lib/components/PdfViewer.svelte.
- Render one page to a canvas at a bounded device-pixel ratio and a 16-megapixel backing-bitmap budget; cancel an in-flight render before starting another and destroy the loading task on teardown.
- Keep the workspace fluid on narrow screens; the canvas lives inside an overflow container and never expands the page layout.
- Use explicit accessible names, disabled states, and a polite status/error region for assistive technology.
- Do not fetch external fonts, CMaps, analytics, or file-processing services for the MVP.

## Constraints and risks

- PDF parsing is resource-intensive and PDFs are untrusted input. Show errors without leaking document contents into logs.
- Large files consume memory because the browser file is read into memory; the UI must avoid unnecessary copies and provide a clear close action.
- Browser canvas size limits vary. Bound rendering pixel ratio and handle canvas/render failures gracefully.
- PDF.js worker and display versions must match; bundle the worker from the installed package rather than using a CDN.
- SvelteKit route filenames beginning with + are reserved for route conventions. Tests must live outside src/routes/.

## Acceptance criteria

- A valid local PDF opens without a network request containing its bytes.
- Invalid/non-PDF files are rejected with an understandable message.
- The first page is rendered and page controls navigate within valid bounds.
- Zoom cannot move outside the documented min/max.
- Closing the document releases PDF.js loading/rendering resources and returns to the home screen.
- CI runs Svelte/type checks, unit tests, and a production build.
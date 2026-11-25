# PDF Utils

A lightweight, privacy-first browser workspace for viewing, editing, organizing, and converting PDF documents.

## Product principles

- **Local-first:** PDF bytes stay in the browser for core workflows; no server upload is used by the viewer.
- **Lightweight:** dependencies are added only when they provide clear product value.
- **Composable:** PDF rendering and document operations are isolated behind small adapters.
- **Accessible:** controls have meaningful labels, focus states, and readable status/error feedback.
- **Reliable:** document limitations and potentially lossy operations are disclosed.
- **Progressive:** build a useful viewer first, then add editing and document utilities in small phases.

## Current implementation

The PDF workspace is browser-first and runs its document operations locally. CI runs Svelte/type checks, unit tests, and Playwright Chromium browser regression tests before the production build. Cross-browser and manual accessibility checks remain part of the verification checklist. It currently includes:

- Select or drop a local PDF file.
- Check for a PDF signature in the first 1,024 bytes before parsing.
- Open the document with PDF.js in the browser using its matching, bundled worker.
- Read PDFs in a continuous vertical scroll view by default, with pages loaded near the viewport on demand, a selectable PDF.js text layer, and a live current-page indicator. Previous/next and thumbnail selection remain available as quick jumps. The Page tools switch opens the existing single-page annotation workspace.
- Navigate with a virtualized page-thumbnail sidebar; only nearby thumbnail canvases are mounted. On mobile, the page rail collapses by default, can be shown on demand, and collapses after page selection.
- Search extracted page text locally, review highlighted snippets, and jump to matching pages.
- Inspect local document information including title, author, subject, creator, producer, PDF version, page count, and file size.
- Zoom from 50% to 300%, fit to width, and close the document.
- Show loading and readable error states; cancel and clean up PDF.js work on close.
- Bound each rendered page canvas to a 16-megapixel budget and a maximum device scale of 2.
- Organize a PDF by reordering, rotating, duplicating, and deleting pages; export the arranged document or selected pages as a new PDF.
- Merge two or more PDFs locally. The user can add files, change their merge order, remove files, and download a newly combined PDF.
- Add text highlights from selected PDF text, add/select/move/edit/delete text notes, and draw freehand, rectangle, and arrow annotations. Annotation overlays use normalized page coordinates and map through PDF.js viewport transforms for zoom and page rotation. Undo/redo is available while the document remains open. Annotation changes stay in memory and are not yet written into the source PDF.

**Not implemented yet:** annotation persistence after closing the document and annotation export; splitting a PDF into multiple independently downloadable ranges, compression, watermarking, page numbering, and image conversion. The organizer can extract selected pages into one new PDF, but a multi-range split workflow is still pending. The document-information panel reads metadata locally but does not edit it. Printing opens the original PDF in the browser’s native PDF viewer; it does not print the current annotations or create an annotated copy. Playwright covers the main Chromium workflows; cross-browser, manual accessibility, large-file, and malformed-PDF checks remain.

## Planned capabilities

| Area | Planned scope |
| --- | --- |
| View | Text layer, search, page navigation, zoom, fit modes, document info, print |
| Organize | Merge PDFs, reorder/rotate/duplicate/delete pages, extract selected pages (implemented); multi-range splitting remains planned |
| Edit | Text highlights and notes (implemented); text/image editing, shapes, freehand drawing, comments, persistence, and PDF export remain planned |
| Transform | Compress, flatten where appropriate, watermark, page numbering |
| Convert | Images to PDF; PDF pages to PNG/JPEG; assess office-document conversion later |
| Secure | Password handling where browser libraries support it; redaction only with true content removal and verification |
| Quality | Validate PDFs, inspect metadata, compare file size, optimize output |

Redaction must never be implemented as a visual overlay. Features will be gated by browser support, document fidelity, and security testing.

## Architecture

The application uses SvelteKit, Svelte 5, TypeScript, Tailwind CSS v4, and Vite. Tailwind is integrated through `@tailwindcss/vite`; shared palette and typography tokens live in `src/routes/app.css`, while component styling uses utility classes. The visual system follows the principles in *Refactoring UI*: clear hierarchy, deliberate spacing, restrained color, readable type, and minimal decorative borders.

- **PDF.js adapter:** `src/lib/pdf/pdfjs-client.ts` loads PDF.js only in the browser and configures the worker from the same pinned package.
- **Viewer component:** `src/lib/components/PdfViewer.svelte` owns the main page state, canvas rendering, navigation, zoom, local document metadata display, and render cleanup.
- **Thumbnail navigation:** `ThumbnailSidebar.svelte` virtualizes the page list; `PdfThumbnail.svelte` renders only the visible preview canvases.
- **Validation and control helpers:** `src/lib/pdf/viewer-utils.ts` checks the PDF signature, clamps page/zoom values, and calculates the bounded thumbnail window.
- **Document operations:** `src/lib/pdf/merge-pdfs.ts` merges input PDFs through `pdf-lib`; `PageOrganizer.svelte` currently owns the page-order preview and selected-page export flow. Keep binary manipulation in service modules rather than UI components.
- **Annotation model:** `src/lib/annotations/annotations.ts` defines validated highlight, text-note, freehand, rectangle, and arrow types plus a bounded undo/redo history. Coordinates are normalized to the unrotated page bounds and remain independent of screen pixels.
- **Persistence:** no persistence by default; optional IndexedDB drafts only when the workflow requires recovery and includes clear-data controls.
- **Workers:** expensive operations should move off the main thread where supported, with progress and cancellation.

### Technical constraints

1. Keep parsing and binary manipulation out of UI components.
2. Anchor annotations to normalized page coordinates, not screen pixels.
3. Treat every PDF as untrusted input; do not render extracted text as unsafe HTML.
4. Keep file bytes and extracted document content out of logs, telemetry, issues, and remote storage.
5. Prefer native vector/text PDF content over rasterizing entire pages.
6. Never claim secure redaction unless the underlying content is removed and the result is independently verified.
7. Review third-party licenses before copying or adapting reference code.

## Development

**Requirements:** Node.js 22.13.0 or newer (PDF.js 6.5.438 requirement).

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm test
npm run test:e2e
npm run check
npm run build
```

End-to-end browser coverage uses Playwright with Chromium. CI installs the browser and runs regression checks for PDF import/rendering, continuous scrolling, search, zoom, mobile layout, annotations, multi-file merge order, and merged output page order before the production build.

Update [PROJECT_PLAN.md](./PROJECT_PLAN.md) with implementation status. The phased viewer design and task plan are under `docs/superpowers/`.

## GitHub Pages

The site is configured for GitHub Pages at:

`https://leenusdarnal.github.io/pdf-utils/`

GitHub Actions builds the app as a static SvelteKit site and deploys it from `main`. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The `github-pages` deployment environment must allow the `main` branch. The workflow also supports manual runs through **Actions → Deploy to GitHub Pages → Run workflow**. The build receives the repository subpath from GitHub Pages, so local development continues to use the root path. PDF files remain in the browser; GitHub Pages serves only the application.

## License

The project license is not selected yet. Do not assume the repository is licensed for reuse. The `pdfjs-dist` dependency is distributed under Apache-2.0; retain its notices when distributing it.
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

The viewer foundation is merged into `main`. CI now runs Svelte/type checks, unit tests, and Playwright Chromium browser regression tests before the production build, including selectable-text and annotation workflow assertions. Cross-browser and manual accessibility checks remain part of the verification checklist. It currently includes:

- Select or drop a local PDF file.
- Check for a PDF signature in the first 1,024 bytes before parsing.
- Open the document with PDF.js in the browser using its matching, bundled worker.
- Render one full-size page at a time with previous/next navigation and a selectable PDF.js text layer over the canvas.
- Navigate with a virtualized page-thumbnail sidebar; only nearby thumbnail canvases are mounted. On mobile, the page rail collapses by default, can be shown on demand, and collapses after page selection.
- Search extracted page text locally, review highlighted snippets, and jump to matching pages.
- Inspect local document information including title, author, subject, creator, producer, PDF version, page count, and file size.
- Zoom from 50% to 300%, fit to width, and close the document.
- Show loading and readable error states; cancel and clean up PDF.js work on close.
- Bound the canvas backing bitmap to a 16-megapixel budget and a maximum device scale of 2.
- Add text highlights from selected PDF text, and add, select, move, edit, and delete text notes. Annotation overlays are stored in normalized page coordinates and mapped through PDF.js viewport transforms for zoom and page rotation; undo/redo is available while the document remains open. Changes stay in memory and do not modify the source PDF.

**Not implemented yet:** freehand and shape annotation tools, persistence after closing the document, and PDF annotation export; page editing, merging/splitting, compression, watermarking, and conversion. The document-information panel reads metadata locally but does not edit it. Printing opens the original PDF in the browser’s native PDF viewer; it does not print the current canvas or create a modified copy. Playwright covers the main Chromium viewer flows; cross-browser, manual accessibility, large-file, and malformed-PDF checks remain.

## Planned capabilities

| Area | Planned scope |
| --- | --- |
| View | Text layer, search, page navigation, zoom, fit modes, document info, print |
| Organize | Merge, split/extract pages, reorder, rotate, delete pages |
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
- **Document operations:** planned service layer around `pdf-lib` for merge, split, page reorder/rotation, metadata, and export.
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

End-to-end browser coverage uses Playwright with Chromium. CI installs the browser and runs regression checks for PDF import/rendering, navigation, search, zoom, invalid-file feedback, and mobile layout before the production build.

Update [PROJECT_PLAN.md](./PROJECT_PLAN.md) with implementation status. The phased viewer design and task plan are under `docs/superpowers/`.

## GitHub Pages

The site is configured for GitHub Pages at:

`https://leenusdarnal.github.io/pdf-utils/`

GitHub Actions builds the app as a static SvelteKit site and deploys it from `main`. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The `github-pages` deployment environment must allow the `main` branch. The workflow also supports manual runs through **Actions → Deploy to GitHub Pages → Run workflow**. The build receives the repository subpath from GitHub Pages, so local development continues to use the root path. PDF files remain in the browser; GitHub Pages serves only the application.

## License

The project license is not selected yet. Do not assume the repository is licensed for reuse. The `pdfjs-dist` dependency is distributed under Apache-2.0; retain its notices when distributing it.
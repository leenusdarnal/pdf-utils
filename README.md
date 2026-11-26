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
- Export selectable PDF text as plain TXT or Markdown, with page boundaries and a bounded preview. Text extraction follows PDF.js reading order; scanned pages without a text layer can be processed with the English Searchable OCR tool.
- Create a searchable PDF copy with browser-local English OCR for scanned pages. It processes at most 150 MB and 100 pages per document, leaves pages with an existing text layer unchanged, and adds invisible word-positioned text to the output. Handwriting, low-resolution scans, and non-English content may be inaccurate or unsupported; editing a signed PDF may invalidate its signature.
- Add visible text watermarks and page numbers to a new PDF copy. Select page ranges, set text, color, opacity, font size, horizontal/diagonal orientation, page-number format and position, and edge margins. Placement accounts for each page's crop box and display rotation; the original is unchanged.
- Arrange selected PDF pages into print-ready N-up sheets with 2, 4, 6, 9, 16, or custom 2–16 page grids. Choose A4/A3/Letter/Legal paper, portrait/landscape orientation, margins, page gaps, custom page ranges, and forward/reverse order. Page artwork is embedded as PDF content rather than rasterized; the source file is unchanged.
- Attempt a conservative local PDF structure rebuild for supported files by rewriting the cross-reference table and trailer. Reopen the output and verify page count, dimensions, rotation, selectable text, and bounded rendered appearance for every page before download. Signed PDFs and files that fail parsing or preservation checks are rejected; this is not general recovery of missing or corrupted page content.
- Compare two local PDFs page by page. Detect selectable-text changes, rendered-pixel differences, page-size changes, and pages added or removed; show a per-page report and short text excerpts without uploading or modifying either source file. A comparison is not a semantic equivalence or authenticity check.
- Inspect local document information including title, author, subject, creator, producer, PDF version, page count, and file size.
- Zoom from 50% to 300%, fit to width, and close the document.
- Show loading and readable error states; cancel and clean up PDF.js work on close.
- Bound each rendered page canvas to a 16-megapixel budget and a maximum device scale of 2.
- Organize a PDF by reordering, rotating, duplicating, and deleting pages; export the arranged document or selected pages as a new PDF.
- Merge two or more PDFs locally. The user can add files, change their merge order, remove files, and download a newly combined PDF.
- Split one PDF into multiple new files using page expressions such as `1-3` or `1, 3-5`. Each output is generated locally and can be downloaded separately.
- Convert PNG, JPEG, and WebP images into a new PDF locally. Reorder/remove images, choose A4/Letter/Legal or image-sized pages, set automatic or fixed orientation and margins, and fit images proportionally or stretch them to the available area.
- Export PDF pages as PNG/JPEG with selectable ranges, DPI/quality controls, individual downloads, and a local ZIP archive.
- Extract embedded image XObjects and inline image resources from PDF content streams (not page screenshots). Supported decoded RGB, RGBA, and grayscale image data is re-encoded as PNG; each image includes its source page and dimensions, can be downloaded separately or as a ZIP, and skipped objects are counted. Original files are unchanged.
- Create a smaller, image-based PDF copy locally using Screen, Balanced, or Print presets; preview the first page, optionally request a best-effort target size, and compare original/output sizes. This process is lossy and removes selectable text, links, forms, signatures, and vector content; the original is never modified.
- Add text highlights from selected PDF text, add/select/move/edit/delete text notes, and draw freehand, rectangle, and arrow annotations. Annotation overlays use normalized page coordinates and map through PDF.js viewport transforms for zoom and page rotation. Undo/redo is available while the document remains open. Export annotations into a new PDF copy as vector/text overlays; the source PDF remains untouched and page count/rotation are preserved. Optional draft recovery can be enabled per document: annotation data is saved in this browser's IndexedDB and can be restored or discarded when the same file is reopened. The PDF itself is never stored; drafts are limited to 12 documents, expire after 30 days, and can be removed by switching local saving off or discarding a pending draft.

**Not implemented yet:** broader annotation rotation/resize regression coverage, multilingual OCR, and other advanced editing features. Annotation export creates content overlays rather than interactive PDF annotation objects. Multi-range PDF splitting is implemented. The document-information panel reads metadata locally but does not edit it. Printing opens the original PDF in the browser’s native PDF viewer; it does not print the current annotations or create an annotated copy. Playwright covers the main Chromium workflows; cross-browser, manual accessibility, large-file, and malformed-PDF checks remain.

## Planned capabilities

| Area | Planned scope |
| --- | --- |
| View | Text layer, search, page navigation, zoom, fit modes, document info, print, and local TXT/Markdown text export |
| Organize | Merge PDFs, split by custom page ranges into separate files, reorder/rotate/duplicate/delete pages, and extract selected pages |
| Edit | Highlights, notes, freehand/shape drawing, and vector/text export to a new PDF copy are implemented; local draft recovery and editing existing PDF text/images remain planned |
| Transform | Lossy raster-based compression and visible watermark/page-number overlays and vector-based N-up sheet layouts are implemented locally |
| Convert | Images to PDF, PDF pages to PNG/JPEG, and supported embedded-image object extraction are implemented locally; assess office-document conversion later |
| Secure | Password handling where browser libraries support it; redaction only with true content removal and verification |
| Quality | Validate PDFs, inspect metadata, compare file size, optimize output |

Redaction must never be implemented as a visual overlay. Features will be gated by browser support, document fidelity, and security testing.

## Architecture

The application uses SvelteKit, Svelte 5, TypeScript, Tailwind CSS v4, and Vite. Tailwind is integrated through `@tailwindcss/vite`; shared palette and typography tokens live in `src/routes/app.css`, while component styling uses utility classes. The visual system follows the principles in *Refactoring UI*: clear hierarchy, deliberate spacing, restrained color, readable type, and minimal decorative borders.

- **PDF.js adapter:** `src/lib/pdf/pdfjs-client.ts` loads PDF.js only in the browser and configures the worker from the same pinned package.
- **Searchable OCR:** `src/lib/pdf/ocr-pdf.ts` renders only scanned pages with PDF.js, recognizes English words using Tesseract.js, maps word boxes back into PDF coordinates, and adds an invisible text layer to a new PDF copy. The worker, WebAssembly core, and English language model are copied from pinned npm packages into the static build; document bytes are not sent to an OCR service.
- **Watermarks and page numbers:** `src/lib/pdf/watermark-page-numbers-service.ts` adds visible text overlays to selected pages in a new PDF copy. Its geometry helper maps displayed-page coordinates through each page's crop box and rotation so overlay placement follows the visual page rather than a fixed media-box coordinate.
- **N-up layout:** `src/lib/pdf/n-up-pdf.ts` embeds the selected source pages into A4, A3, Letter, or Legal sheets using vector PDF page content. It calculates a contain-fit placement for each cell, applies page rotations, preserves reading order, and supports custom margins and gutters; interactive page annotations and form-level features are not copied.
- **PDF comparison:** `src/lib/pdf/compare-pdfs.ts` pairs pages by index, extracts selectable text, and compares bounded PDF.js renderings at a shared scale. It reports text, pixel, page-size, added-page, and removed-page changes without sending document bytes to a server; it does not prove semantic equivalence.
- **PDF repair:** `src/lib/pdf/repair-pdf.ts` conservatively reserializes supported PDFs with a classic cross-reference table. It refuses populated signature byte ranges and returns a copy only after PDF.js/pdf-lib reopen it and every page's geometry, selectable text, and bounded rendering match. It does not reconstruct missing streams or guarantee preservation of bookmarks, attachments, accessibility tags, or interactive objects.
- **Viewer component:** `src/lib/components/PdfViewer.svelte` owns the main page state, canvas rendering, navigation, zoom, local document metadata display, and render cleanup.
- **Thumbnail navigation:** `ThumbnailSidebar.svelte` virtualizes the page list; `PdfThumbnail.svelte` renders only the visible preview canvases.
- **Validation and control helpers:** `src/lib/pdf/viewer-utils.ts` checks the PDF signature, clamps page/zoom values, and calculates the bounded thumbnail window.
- **Document operations:** `src/lib/pdf/merge-pdfs.ts` merges input PDFs, while `src/lib/pdf/split-pdf.ts` parses validated page ranges and creates independent outputs through `pdf-lib`; `PageOrganizer.svelte` owns the page-order preview and selected-page export flow. Keep binary manipulation in service modules rather than UI components.
- **Image conversion:** `src/lib/pdf/images-to-pdf.ts` validates PNG/JPEG/WebP signatures, calculates page geometry and image placement, decodes WebP locally when needed, and creates the PDF with `pdf-lib`; `ImagesToPdf.svelte` manages the local image queue and page-order controls.
- **Embedded image extraction:** `src/lib/pdf/extract-embedded-images.ts` inspects PDF.js image-paint operators, resolves page-local and shared image objects, reads inline image data, converts supported decoded pixels to PNG, and applies per-image/aggregate limits; `ExtractImages.svelte` provides previews and individual/ZIP downloads.
- **Compression:** `src/lib/pdf/compress-pdf.ts` renders source pages sequentially through PDF.js and embeds bounded JPEG page images into a new `pdf-lib` document. This preserves page count and visual layout, not searchable text or interactive content; the UI requires acknowledgement and reports actual size change.
- **Annotation model:** `src/lib/annotations/annotations.ts` defines validated highlight, text-note, freehand, rectangle, and arrow types plus a bounded undo/redo history. Coordinates are normalized to the unrotated page bounds and remain independent of screen pixels.
- **Annotation draft recovery:** `src/lib/annotations/annotation-drafts.ts` stores annotation-only snapshots in IndexedDB after explicit opt-in. A SHA-256 key combines file metadata with bounded samples from the beginning, middle, and end of the selected file; the original PDF bytes are never stored. Drafts are validated, limited by count/size, expired after 30 days, and can be restored or discarded in the viewer.
- **Annotation export:** `src/lib/pdf/export-annotations.ts` validates annotation data and adds highlights, text-note callouts, freehand paths, rectangles, and arrows as vector/text page content in a new `pdf-lib` copy. It maps through each page crop box, preserves page rotation and page count, and enforces input/page/annotation limits.
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

End-to-end browser coverage uses Playwright with Chromium. CI installs the browser and runs regression checks for PDF import/rendering, continuous scrolling, search, zoom, mobile layout, annotations, multi-file merge order, split-range validation, split-output page count/order, N-up page-layout export, and PDF text/visual comparison before the production build.

Update [PROJECT_PLAN.md](./PROJECT_PLAN.md) with implementation status. The phased viewer design and task plan are under `docs/superpowers/`.

## GitHub Pages

The site is configured for GitHub Pages at:

`https://leenusdarnal.github.io/pdf-utils/`

GitHub Actions builds the app as a static SvelteKit site and deploys it from `main`. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The `github-pages` deployment environment must allow the `main` branch. The workflow also supports manual runs through **Actions → Deploy to GitHub Pages → Run workflow**. The build receives the repository subpath from GitHub Pages, so local development continues to use the root path. PDF files remain in the browser; GitHub Pages serves only the application.

## License

The project license is not selected yet. Do not assume the repository is licensed for reuse. The `pdfjs-dist` dependency is distributed under Apache-2.0; retain its notices when distributing it. Tesseract.js and tesseract.js-core are Apache-2.0; the English trained-data package is MIT.
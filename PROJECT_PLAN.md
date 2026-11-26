# Project Plan and Implementation Tracker

Last updated: 2026-11-26

## Product goal

Build a lightweight, privacy-first PDF workspace that handles everyday viewing, page organization, annotation, conversion, and optimization in the browser. Local processing is the default; remote upload is not part of the MVP.

## Scope and priorities

| Priority | Capability | MVP decision | Notes |
| --- | --- | --- | --- |
| P0 | Appearance | Yes | Light/dark theme toggle, follows system preference until the user chooses, and saves the preference locally |
| P0 | PDF viewer | Yes | Local rendering, continuous vertical scroll with lazy page rendering, scroll-aware page navigation, zoom, fit width, selectable text, virtualized thumbnails, mobile thumbnail toggle, local text search, read-only metadata, and native-browser printing are implemented; wider browser/accessibility QA remains |
| P0 | File import/export | Yes | Local file picker/drop and signature validation are implemented; organized, extracted, merged, and range-split PDF outputs download locally without overwriting source files |
| P1 | Page organization | Yes | Merge PDFs, split by custom page ranges, extract selected pages, reorder, rotate, duplicate, and delete |
| P1 | Basic annotations | Yes | Highlight, text note, freehand, rectangle/arrow; persisted as editable app state before export |
| P1 | Annotation export | Yes | Prefer vector/native content; test fidelity and clearly disclose limitations |
| P1 | PDF to images | Yes | Export selected/all pages as PNG/JPEG with 72/150/200/300 DPI, JPEG quality, individual downloads, and local ZIP; render one page canvas at a time |
| P1 | Images to PDF | Yes | Convert/reorder PNG, JPEG, and WebP locally; supports A4/Letter/Legal or image-sized pages, auto/fixed orientation, margins, and contain/stretch fitting |
| P1 | Compression | Yes | Local raster-based copy with Screen/Balanced/Print presets, first-page quality preview, optional best-effort target size, before/after reporting, explicit loss warning, and untouched original |
| P1 | Extract images | Yes | Recover supported image XObjects and inline images from PDF content streams; export decoded resources as PNG and report unsupported/skipped objects |
| P2 | Editing tools | Later | Text/image insertion, signatures, stamps, crop, forms, flattening; distinguish overlays from editing existing content |
| P2 | Watermark/page numbers | Later | Deterministic placement and preview |
| P2 | N-up layout | Later | Place 2, 4, 6 or more pages per sheet with print-ready output |
| P2 | OCR and text extraction | Later | Searchable OCR, PDF-to-text, and PDF-to-Markdown; evaluate browser/local runtimes and language coverage |
| P2 | Compare and repair | Later | Compare pages/content and attempt safe repair of malformed PDFs |
| P2 | Office conversion | Research only | Assess fidelity, local processing options, licensing, bundle size, and hosting costs before selecting an approach |
| P3 | AI document tools | Research only | Summarization, translation, and Chat with PDF; privacy, cost, consent, and remote processing must be explicit |
| P3 | Secure redaction | Separate security-gated project | Must remove underlying text/image content, sanitize, and independently verify output; no overlay-only redaction |
| P3 | Batch workflows | Later | Queue multiple files and save reusable multi-tool workflows with clear per-file status |

## Architecture decisions

| Topic | Direction | Reason / guardrail |
| --- | --- | --- |
| Framework | SvelteKit + TypeScript | Fits the planned app and supports a lean component architecture |
| PDF rendering | PDF.js behind a viewer adapter | Keep rendering details out of page components |
| PDF manipulation | pdf-lib behind operation services | Use for supported structural edits and document generation |
| Annotation coordinates | Normalized page-relative coordinates | Preserves placement through zoom, rotation, and viewport resize |
| State | Small typed stores/state modules | Avoid a heavyweight global state library until required |
| Persistence | No persistence by default; optional IndexedDB drafts | Explicit local recovery with quota handling and clear-data controls |
| Background work | Web Workers for expensive tasks when supported | Keep the UI responsive; expose progress and cancellation |
| Telemetry | No document content or bytes in telemetry | Privacy-first behavior; make any analytics opt-in and minimal |
| Hosting | Static/browser-first deployment where possible | Avoid server-side file retention and processing costs |

## Technical boundaries

- Keep PDF.js and pdf-lib usage behind adapters/services so libraries can be replaced or upgraded safely. The first PDF.js adapter is src/lib/pdf/pdfjs-client.ts.
- Do not put parsing, conversion, or large binary work in UI components.
- Use object URLs carefully and revoke them when no longer needed.
- Treat every PDF as untrusted input; set sensible file-size/page-count warnings and handle malformed documents.
- Do not render PDF text through unsafe HTML.
- Keep user files out of logs, telemetry, issue reports, and remote storage.
- Use cancellable operations and clear progress/error states for long-running tasks.
- Avoid rasterizing whole documents as the default annotation export path.
- Redaction is not in MVP. A black rectangle over content is not redaction.
- Review third-party license terms and notices before copying or adapting source code.

## Delivery tracker

Status values: `not-started`, `in-progress`, `blocked`, `done`, `deferred`.

| ID | Phase | Deliverable | Status | Acceptance criteria |
| --- | --- | --- | --- | --- |
| FND-01 | Foundation | Confirm app architecture and dependency policy | done | Decisions documented here; no application dependencies added prematurely |
| FND-02 | Foundation | Create SvelteKit + TypeScript scaffold | done | Scaffold and pinned PDF.js dependency are committed; latest CI clean install and production build passed |
| FND-03 | Foundation | Establish formatting, lint, typecheck, and test scripts | done | Unit tests, Svelte/type checks, and production build pass in latest CI; formatting gate is not currently part of CI |
| FND-04 | Foundation | Build responsive app shell and design tokens | in-progress | Responsive landing page, viewer shell, Tailwind design tokens, mobile thumbnail controls, and persistent light/dark theme are implemented; manual cross-browser accessibility review remains |
| FND-05 | Foundation | Add CI workflow and contribution guidance | done | GitHub Actions CI and setup instructions are present; latest full run is green |
| FND-06 | Foundation | GitHub Pages static deployment | done | GitHub Actions deployment from main is green and the live app returns HTTP 200 |
| THEME-01 | Foundation | Light and dark appearance | done | Accessible theme toggle; stored preference persists across reloads, follows system preference until the user chooses, and covers the landing page and existing tools |
| VIEW-01 | Viewer | File picker and drag/drop import | done | Local signature validation and invalid-file feedback are implemented; helper tests pass in CI |
| VIEW-02 | Viewer | PDF.js rendering adapter | in-progress | PDF.js v6.5.438 renders page canvases with an aligned selectable text layer; Playwright verifies DOM text selection, while real-world and cross-browser fixture coverage remains |
| VIEW-03 | Viewer | Navigation and zoom controls | in-progress | Continuous scroll is the default reader; the current-page indicator tracks scroll, previous/next and thumbnails jump to pages, and Page tools retains single-page editing; keyboard-only and cross-browser checks remain |
| VIEW-04 | Viewer | Thumbnails and page virtualization | in-progress | Thumbnail sidebar supports page selection, virtualization, and mobile collapse/expand; Playwright covers mobile selection and panel behavior; large-document performance checks remain |
| VIEW-05 | Viewer | Text extraction and document search | in-progress | PDF.js text content powers both the selectable text layer and local search; Playwright verifies text selection and searchable fixture navigation, while broader real-world coverage remains |
| VIEW-06 | Viewer | Print and document information | done | Read-only metadata panel shows common info, page count, and size; Print opens the original local PDF in a separate browser-native PDF viewer for whole-document printing |
| OPS-01 | Page operations | Merge PDFs | done | Select two or more local PDFs, validate file signatures, edit merge order, remove inputs, and download a combined PDF; unit and Playwright tests verify page count and output order |
| OPS-02 | Page operations | Split and extract pages | done | Validate page-range expressions (single pages and ascending ranges), create one independent PDF per output range, and download outputs separately; unit and browser tests verify bounds, ordering, page count, and output content |
| OPS-03 | Page operations | Reorder, rotate, duplicate, and delete pages | in-progress | Page operations, selection, undo/redo, and export are implemented in the organizer; browser-level export fidelity checks remain |
| ANN-01 | Annotation | Typed annotation schema and history | done | Validated highlight, text-note, freehand, rectangle, and arrow types use normalized page-relative coordinates; bounded undo/redo history and validation are covered by unit tests |
| ANN-02 | Annotation | Highlight and text notes | done | UI supports selection-based highlights and add/select/move/edit/delete text notes; normalized viewport transforms and Playwright zoom/rotation coverage pass |
| ANN-03 | Annotation | Freehand and shape tools | in-progress | Freehand, rectangle, and arrow drawing plus shape movement are available with normalized coordinates and undo/redo; persistence, export, and broader rotation/resize checks remain |
| ANN-04 | Annotation | Annotation export | not-started | Text/vector fidelity tested; limitations disclosed |
| OPT-01 | Optimization | Compression workflow | done | Local raster-based copy with Screen/Balanced/Print presets, optional target-size retries, first-page JPEG preview, before/after size report, explicit consent and loss disclosure; original PDF remains untouched |
| CON-01 | Conversion | Images to PDF | done | Validate PNG/JPEG/WebP signatures; add/remove/reorder images; export one image per page with A4/Letter/Legal or image-sized pages, orientation, 0–50 mm margins, contain/stretch fitting, progress, and output naming; service unit and browser download/page-layout tests pass |
| CON-02 | Conversion | PDF to images | done | Export selected/all pages as PNG/JPEG at 72/150/200/300 DPI; JPEG quality control; individual downloads and ZIP; render sequentially and release canvases to control memory |
| CON-03 | Conversion | Extract embedded images | in-progress | Walk PDF.js image-paint operators, resolve page/document image objects asynchronously, extract inline image data, de-duplicate referenced XObjects, export decoded RGB/RGBA/grayscale pixels as PNG, and report unsupported objects; source format preservation and rare masks/groups remain limitations |
| EDIT-01 | Editing | Text and image insertion, signatures, stamps | deferred | Add/move/resize overlays with clear distinction from editing original PDF text; preview and export fidelity tested |
| EDIT-02 | Editing | Crop and page-size adjustment | deferred | Set crop/page boxes and output size with preview; preserve content placement and handle rotation |
| EDIT-03 | Editing | Forms and flattening | deferred | Fill supported interactive fields; flatten only on explicit user action and explain loss of interactivity |
| TRN-01 | Transform | Watermark and page numbers | deferred | Preview and exported placement match; support ranges, margins, positioning, and style |
| TRN-02 | Transform | N-up pages per sheet | deferred | Support 2-up, 4-up, 6-up and configurable layouts with print-ready output and page order tests |
| OCR-01 | OCR and extraction | Searchable OCR | deferred | OCR scanned pages into searchable text; document supported languages, local processing, accuracy limits, and progress/cancel behavior |
| OCR-02 | OCR and extraction | PDF to text and Markdown | deferred | Extract text in reading order with page breaks and clearly documented layout limitations |
| DOC-01 | Document quality | Compare PDFs | deferred | Compare page count, text and visual differences; show aligned page-level results and avoid claiming semantic equivalence |
| DOC-02 | Document quality | Repair malformed PDFs | deferred | Detect supported failure classes, preserve original, and validate repaired output by reopening it |
| CON-04 | Conversion | Office document conversion | deferred | Research browser/local options, fidelity, licensing, runtime size, and privacy before committing to implementation |
| AI-01 | AI document tools | Summarize, translate, and ask questions | deferred | Explicitly disclose any remote processing; obtain consent, protect document content, and provide source/page references where possible |
| SEC-01 | Security | Redaction research and threat model | deferred | No release until underlying content removal, sanitization, and independent verification tests pass; never treat a drawn overlay as redaction |
| SEC-02 | Security | Password protection and authorized unlocking | deferred | Use supported PDF encryption; clearly distinguish opening password from permissions and never bypass unknown credentials |
| SEC-03 | Security | Metadata and bookmark management | deferred | Inspect/edit metadata and bookmarks; verify changes in reopened output |
| FLOW-01 | Workflows | Batch processing and reusable workflows | deferred | Queue multiple files, show per-file progress/errors, and allow repeatable local tool sequences without uploading files |
| QLT-01 | Quality | Accessibility audit | not-started | Keyboard-only core workflow; semantic labels and contrast checks |
| QLT-02 | Quality | Performance and large-file testing | not-started | Defined fixture set and baseline measurements |
| QLT-03 | Quality | Browser compatibility matrix | not-started | Current Chromium, Firefox, and Safari tested where available |
| QLT-04 | Quality | PDF regression fixtures | not-started | Test text, images, rotation, page boxes, encryption, malformed files |

## Definition of done

A feature is complete only when:

1. Its primary workflow works with representative real PDFs and clear empty/loading/error states.
2. Keyboard and touch interaction are considered; controls have accessible names and focus states.
3. Processing remains local unless an explicitly documented feature says otherwise.
4. Large or malformed inputs fail safely without freezing the application.
5. Output is downloaded and reopened in at least one independent PDF viewer for fidelity-sensitive operations.
6. Unit or integration tests cover core behavior, and CI is green.
7. README/help text accurately states limitations and does not imply unsupported security guarantees.

## Initial implementation sequence

1. Scaffold the app and CI with minimal dependencies.
2. Create the design system and app shell around the core document workspace.
3. Implement file import and PDF.js viewer adapter.
4. Add navigation, zoom, thumbnails, search, print, and robust error handling.
5. Add page operations using an isolated PDF operation service.
6. Add annotation model and editor UI, then export and fidelity tests.
7. Add PDF-to-images, images-to-PDF, embedded-image extraction, and compression as the next everyday utility set.
8. Add editing and page-layout tools (text/image overlays, signatures, crop, forms, watermarks, page numbering, N-up).
9. Evaluate OCR, text/Markdown extraction, comparison, repair, and Office conversion with local-first and fidelity benchmarks.
10. Gate AI, redaction, password, and batch workflow features on privacy, security, and correctness reviews.

## Change control

- Update this tracker in the same pull request that changes project scope or completes a tracked deliverable.
- Keep pull requests small and phase-focused; avoid introducing future-phase dependencies early.
- Record significant architecture changes in an Architecture Decision Record under `docs/adr/`.
- Re-check bundle size and privacy implications whenever a dependency or remote service is proposed.
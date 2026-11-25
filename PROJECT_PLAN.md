# Project Plan and Implementation Tracker

Last updated: 2026-11-25

## Product goal

Build a lightweight, privacy-first PDF workspace that handles everyday viewing, page organization, annotation, conversion, and optimization in the browser. Local processing is the default; remote upload is not part of the MVP.

## Scope and priorities

| Priority | Capability | MVP decision | Notes |
| --- | --- | --- | --- |
| P0 | PDF viewer | Yes | Local rendering, page navigation, zoom, fit width, selectable text, virtualized thumbnails, mobile thumbnail toggle, local text search, read-only metadata, and native-browser printing are implemented; wider browser/accessibility QA remains |
| P0 | File import/export | Yes | Local file picker/drop and signature validation are implemented; download/export remains pending |
| P1 | Page organization | Yes | Merge, split/extract, reorder, rotate, delete |
| P1 | Basic annotations | Yes | Highlight, text note, freehand, rectangle/arrow; persisted as editable app state before export |
| P1 | Annotation export | Yes | Prefer vector/native content; test fidelity and clearly disclose limitations |
| P2 | Compression | Later | Benchmark quality/size tradeoffs; avoid destructive defaults |
| P2 | Image conversion | Later | Images to PDF and PDF pages to PNG/JPEG |
| P2 | Watermark/page numbers | Later | Deterministic placement and preview |
| P3 | Secure redaction | Separate security-gated project | Must remove underlying text/image content, sanitize, and verify output; no overlay-only redaction |
| P3 | Office conversion | Research only | Likely requires external runtime/service; assess privacy and hosting costs first |

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
| FND-04 | Foundation | Build responsive app shell and design tokens | in-progress | Responsive landing page, viewer shell, Tailwind design tokens, and mobile thumbnail controls are implemented; manual cross-browser accessibility review remains |
| FND-05 | Foundation | Add CI workflow and contribution guidance | done | GitHub Actions CI and setup instructions are present; latest full run is green |
| FND-06 | Foundation | GitHub Pages static deployment | done | GitHub Actions deployment from main is green and the live app returns HTTP 200 |
| VIEW-01 | Viewer | File picker and drag/drop import | done | Local signature validation and invalid-file feedback are implemented; helper tests pass in CI |
| VIEW-02 | Viewer | PDF.js rendering adapter | in-progress | PDF.js v6.5.438 renders page canvases with an aligned selectable text layer; Playwright verifies DOM text selection, while real-world and cross-browser fixture coverage remains |
| VIEW-03 | Viewer | Navigation and zoom controls | in-progress | Previous/next, 50–300% zoom, fit width, and close controls are implemented and covered by Playwright; keyboard-only and cross-browser checks remain |
| VIEW-04 | Viewer | Thumbnails and page virtualization | in-progress | Thumbnail sidebar supports page selection, virtualization, and mobile collapse/expand; Playwright covers mobile selection and panel behavior; large-document performance checks remain |
| VIEW-05 | Viewer | Text extraction and document search | in-progress | PDF.js text content powers both the selectable text layer and local search; Playwright verifies text selection and searchable fixture navigation, while broader real-world coverage remains |
| VIEW-06 | Viewer | Print and document information | done | Read-only metadata panel shows common info, page count, and size; Print opens the original local PDF in a separate browser-native PDF viewer for whole-document printing |
| OPS-01 | Page operations | Merge PDFs | not-started | Merge order preview; valid downloadable output |
| OPS-02 | Page operations | Split and extract pages | not-started | Page ranges validated; each output downloads correctly |
| OPS-03 | Page operations | Reorder, rotate, and delete pages | not-started | Preview matches exported page order/orientation |
| ANN-01 | Annotation | Typed annotation schema and history | done | Validated highlight, text-note, freehand, rectangle, and arrow types use normalized page-relative coordinates; bounded undo/redo history and validation are covered by unit tests |
| ANN-02 | Annotation | Highlight and text notes | in-progress | UI supports selection-based highlights and add/select/move/edit/delete text notes; normalized viewport transforms and automated zoom/rotation tests are being verified |
| ANN-03 | Annotation | Freehand and shape tools | not-started | Pointer/touch support; stable alignment through resize |
| ANN-04 | Annotation | Annotation export | not-started | Text/vector fidelity tested; limitations disclosed |
| OPT-01 | Optimization | Compression workflow | deferred | Benchmark file size and visual quality before setting defaults |
| CON-01 | Conversion | Images to PDF | deferred | Mixed image dimensions supported; output page sizes predictable |
| CON-02 | Conversion | PDF to images | deferred | Export selected/all pages at chosen format and resolution |
| TRN-01 | Transform | Watermark and page numbers | deferred | Preview and exported placement match |
| SEC-01 | Security | Redaction research and threat model | deferred | No release until content-removal and independent verification tests pass |
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

## Change control

- Update this tracker in the same pull request that changes project scope or completes a tracked deliverable.
- Keep pull requests small and phase-focused; avoid introducing future-phase dependencies early.
- Record significant architecture changes in an Architecture Decision Record under `docs/adr/`.
- Re-check bundle size and privacy implications whenever a dependency or remote service is proposed.
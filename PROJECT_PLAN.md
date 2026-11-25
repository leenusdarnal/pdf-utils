# Project Plan and Implementation Tracker

Last updated: 2026-11-25

## Product goal

Build a lightweight, privacy-first PDF workspace that handles everyday viewing, page organization, annotation, conversion, and optimization in the browser. Local processing is the default; remote upload is not part of the MVP.

## Scope and priorities

| Priority | Capability | MVP decision | Notes |
| --- | --- | --- | --- |
| P0 | PDF viewer | Yes | Rendering, page navigation, zoom, fit modes, thumbnails, text search, print |
| P0 | File import/export | Yes | Drag/drop, file picker, validation, download, clear error handling |
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

- Keep PDF.js and pdf-lib usage behind adapters/services so libraries can be replaced or upgraded safely.
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
| FND-02 | Foundation | Create SvelteKit + TypeScript scaffold | not-started | Clean install/build; strict TypeScript; minimal dependency set |
| FND-03 | Foundation | Establish formatting, lint, typecheck, and test scripts | not-started | CI runs checks on pull requests and main |
| FND-04 | Foundation | Build responsive app shell and design tokens | not-started | Accessible navigation, consistent spacing/type/color, mobile and desktop layouts |
| FND-05 | Foundation | Add CI workflow and contribution guidance | not-started | CI green; README setup steps verified |
| VIEW-01 | Viewer | File picker and drag/drop import | not-started | Valid PDFs open; invalid/empty files show actionable errors |
| VIEW-02 | Viewer | PDF.js rendering adapter | not-started | Multi-page documents render reliably; loading/error states |
| VIEW-03 | Viewer | Navigation and zoom controls | not-started | Page jump, previous/next, zoom, fit width/page |
| VIEW-04 | Viewer | Thumbnails and page virtualization | not-started | Large documents do not mount every full-size page at once |
| VIEW-05 | Viewer | Text layer and document search | not-started | Search results navigate to matching page and highlight results |
| VIEW-06 | Viewer | Print and document information | not-started | Print action works; basic metadata/page count shown |
| OPS-01 | Page operations | Merge PDFs | not-started | Merge order preview; valid downloadable output |
| OPS-02 | Page operations | Split and extract pages | not-started | Page ranges validated; each output downloads correctly |
| OPS-03 | Page operations | Reorder, rotate, and delete pages | not-started | Preview matches exported page order/orientation |
| ANN-01 | Annotation | Typed annotation schema and history | not-started | Page-relative coordinates; undo/redo tests |
| ANN-02 | Annotation | Highlight and text notes | not-started | Add, select, move, edit, delete; zoom/rotation alignment |
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
# PDF Utils

A lightweight, privacy-first collection of browser-based PDF tools for viewing, editing, organizing, and converting documents.

## Product direction

PDF Utils should make common document tasks fast and approachable while keeping files on the user's device by default. The application will prioritize a focused interface, predictable document handling, and a small dependency footprint.

### Principles

- **Local-first:** process documents in the browser wherever practical; do not upload user files by default.
- **Lightweight:** add dependencies only when they provide clear product value.
- **Composable:** keep PDF rendering, editing, file operations, and export behind small adapters.
- **Accessible:** support keyboard navigation, readable controls, meaningful labels, and responsive layouts.
- **Reliable:** preserve document fidelity where possible and clearly communicate any lossy operation.
- **Progressive:** deliver a useful viewer first, then add editing and utility workflows incrementally.

## Planned capabilities

| Area | Initial scope |
| --- | --- |
| View | Open PDFs, page navigation, zoom, fit-to-width/page, thumbnails, search, document info, print |
| Organize | Merge, split/extract pages, reorder, rotate, delete pages |
| Edit | Text/image annotations, highlights, shapes, freehand drawing, comments, undo/redo |
| Transform | Compress, flatten where appropriate, watermark, page numbering |
| Convert | Images to PDF; PDF pages to images; investigate office-document conversion as a later capability |
| Secure | Password-protected PDF handling where browser libraries support it; redact only with true content removal and verification |
| Quality | Validate PDF, inspect metadata, compare file size, optimize output |

Feature availability will be gated by browser support, library capabilities, document fidelity, and security testing. Redaction must never be implemented as a visual overlay.

## Architecture direction

The proposed implementation is a SvelteKit + TypeScript application with browser-side PDF processing.

- **Viewer adapter:** PDF.js for rendering, text extraction, search, and page viewport information.
- **Document operations:** a small service layer around `pdf-lib` for merge, split, page reorder/rotation, metadata, and export.
- **Annotation model:** typed, page-relative annotation data independent of canvas pixels.
- **Annotation renderer:** DOM/canvas overlays positioned using the viewer's page viewport; drawing coordinates must remain correct under zoom, rotation, and resize.
- **Export pipeline:** prefer native PDF vector/text annotations when feasible; use rasterization only as an explicit fallback because it can reduce fidelity and accessibility.
- **Persistence:** session-first by default; optional IndexedDB for local drafts and recovery, with quota/error handling and a visible clear-data control.
- **Workers:** move CPU-heavy operations off the main thread where supported, with cancellation and progress reporting.
- **File handling:** validate MIME type and PDF signatures, handle malformed/large files gracefully, and avoid sending document bytes to analytics or remote services.

### Important constraints

1. Use a single source of truth for document state and page transforms.
2. Keep annotations anchored in normalized page coordinates, not screen coordinates.
3. Test export fidelity for text, vectors, images, page boxes, rotation, and metadata.
4. Treat PDF parsing as untrusted input; keep dependencies patched and avoid unsafe HTML rendering.
5. Never claim a file is securely redacted unless the underlying content is actually removed and the output is independently verified.
6. Do not copy code from reference projects without reviewing their licenses and notices.

## Proposed delivery phases

1. **Foundation:** project scaffold, design tokens, app shell, routing, CI, lint/type checks, architecture notes.
2. **Viewer MVP:** import/drop, render, thumbnails, navigation, zoom, search, print, error states.
3. **Page operations:** merge, split, extract, reorder, rotate, delete, download.
4. **Annotation MVP:** highlight, text note, shapes, freehand, undo/redo, local draft recovery, export.
5. **Optimization and conversion:** compression, images-to-PDF, PDF-to-images, watermark, page numbers.
6. **Hardening:** accessibility, large-file performance, browser compatibility, security review, automated regression fixtures.

## Development status

The repository currently contains the initial product and architecture plan only. Implementation status is tracked in [PROJECT_PLAN.md](./PROJECT_PLAN.md).

## Development

The exact framework and package versions will be selected in the foundation phase. Keep the application browser-first and avoid adding server-side document storage unless a clearly justified feature requires it.

## License

To be decided before public release. Until then, do not assume the project is licensed for reuse.
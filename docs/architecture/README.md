# Architecture Overview

## Runtime model

```text
User interface (SvelteKit routes and components)
  ├── Document workspace state
  ├── Viewer adapter
  │     └── PDF.js
  ├── Document operation services
  │     └── pdf-lib
  ├── Annotation model and tools
  ├── Local draft repository (optional IndexedDB)
  └── Export/download pipeline
```

UI components should coordinate workflows, not own PDF parsing or binary manipulation. Adapters isolate third-party library APIs and make the core behavior testable. The current viewer dynamically imports PDF.js from the browser lifecycle and uses the worker asset bundled from the same pinned package.

## Core modules

- `lib/pdf/`: PDF.js browser adapter (`pdfjs-client.ts`), file-signature/control helpers, and future metadata/page models.
- `lib/operations/`: merge, split, extract, reorder, rotate, delete, metadata, export.
- `lib/annotations/`: normalized annotation types, coordinate transforms, history, rendering, serialization.
- `lib/storage/`: optional local draft persistence and quota/error handling.
- `lib/workers/`: worker entry points for expensive tasks.
- `lib/components/`: reusable controls and document workspace UI.

These are target boundaries, not a requirement to create empty folders before they are needed.

## Annotation coordinate contract

Store geometry in normalized page coordinates (0..1) relative to the unrotated PDF page coordinate system, with a documented origin convention. Convert to viewport pixels only at render time using PDF.js viewport transforms. Test 0/90/180/270-degree rotation, zoom, device pixel ratio, and container resize.

## Data lifecycle

1. User selects or drops a file.
2. Validate file type/signature and apply practical size warnings.
3. Load the document locally through the PDF.js adapter; avoid object URLs unless a later workflow specifically needs one.
4. Render the current page locally. The first viewer iteration intentionally keeps only one page canvas mounted at a time.
5. Export a new output file without silently modifying the source.
6. Release worker, PDF.js, canvas, and object URL resources when the document closes.

Optional draft persistence must be explicit, local-only, quota-aware, and clearable by the user.

## Security and privacy

- Treat PDFs and extracted strings as untrusted input.
- Never inject extracted PDF text as HTML.
- Keep file bytes and extracted document content out of telemetry and logs.
- Validate page ranges, annotation geometry, and operation inputs.
- Avoid remote services for core workflows.
- Document encryption/password handling limitations accurately.
- Do not ship a redaction feature until content removal, sanitization, and independent output verification are implemented and tested.
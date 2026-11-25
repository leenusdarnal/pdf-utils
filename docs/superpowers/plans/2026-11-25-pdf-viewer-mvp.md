# PDF Viewer MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working local PDF viewer with page rendering, navigation, zoom, and accessible loading/error states.

**Architecture:** Use PDF.js 6.5.438 display API through a browser-only Svelte component, with the worker emitted as a Vite asset. Keep PDF signature validation and pure viewer-control helpers isolated and covered by Vitest.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, PDF.js (pdfjs-dist@6.5.438), Vitest, Vite.

**Spec:** docs/superpowers/specs/2026-11-25-pdf-viewer-mvp-design.md

## Global Constraints

- PDF files are processed locally in the browser; do not upload document bytes.
- Use the PDF.js 6.5.438 worker from the same installed package version as the display API.
- Verify the PDF header; do not rely only on MIME type or file extension.
- Render only the current page in this MVP and bound device-pixel-ratio scaling.
- Cancel in-flight rendering and destroy the document/loading task when the viewer is removed.
- Keep tests outside src/routes/; SvelteKit reserves route files beginning with +.
- Do not add wrapper packages, remote fonts, analytics, or server-side PDF processing.

## Review Focus

1. **Malformed or mislabeled files:** reject a file without a %PDF- header in the first 1,024 bytes and show a user-readable error.
2. **Zero-byte or very small files:** avoid array-buffer/parser calls and show invalid-file feedback.
3. **Out-of-range page values:** previous/next controls never navigate before page 1 or after the last page.
4. **Rapid page/zoom changes or close while rendering:** cancel and ignore stale work; do not let an old render overwrite the current page or recreate errors after close.
5. **High-DPI and narrow viewports:** cap backing-canvas scale and keep the page inside a horizontally scrollable viewer region.

---

### Task 1: Repair the failing foundation check and establish viewer test contracts

**Files:**
- Delete: src/routes/+page.test.ts
- Create: src/lib/pdf/viewer-utils.test.ts
- Create: docs/superpowers/specs/2026-11-25-pdf-viewer-mvp-design.md
- Create: docs/superpowers/plans/2026-11-25-pdf-viewer-mvp.md

**Interfaces:**
- Produces test contracts for hasPdfHeader(file: Blob): Promise<boolean>, clampPageNumber(page: number, totalPages: number): number, and clampZoom(scale: number): number.

- [x] **Step 1: Add tests** for a valid PDF header even when MIME is generic, invalid bytes despite a .pdf suffix, a header within the first 1,024 bytes, page clamping (below/above range), and zoom clamping (below 0.5/above 3).
- [x] **Step 2: Run the checks** on the test-only commit and confirm the expected missing-module failures; the SvelteKit route-name failure must be gone.
- [x] **Step 3: Implement** only the minimal helpers in src/lib/pdf/viewer-utils.ts.
- [ ] **Step 4: Run** npm test and npm run check; both must pass.
- [x] **Step 5: Commit** as test: cover PDF viewer file and control utilities followed by feat: add PDF viewer validation helpers.

### Task 2: Add the PDF.js browser viewer component

**Files:**
- Modify: package.json
- Create: src/lib/components/PdfViewer.svelte
- Modify: src/routes/app.css

**Interfaces:**
- Consumes: hasPdfHeader, clampPageNumber, and clampZoom from Task 1.
- Produces: PdfViewer component with file: File and onClose: () => void props.

- [x] **Step 1: Add** pdfjs-dist@6.5.438 as a production dependency.
- [x] **Step 2: Implement** browser-only loading with getDocument({ data }) and GlobalWorkerOptions.workerSrc pointed at pdf.worker.mjs?url.
- [x] **Step 3: Implement** single-page canvas rendering with bounded output scale, page navigation, zoom in/out, fit width, loading/error status, and close.
- [x] **Step 4: Implement** cancellation and cleanup for render tasks, loading tasks, and loaded documents.
- [x] **Step 5: Style** toolbar and scrollable page surface for mobile and desktop; add keyboard-accessible control labels and focus styling.
- [ ] **Step 6: Run** npm run check, npm test, and npm run build.

### Task 3: Connect import flow to the viewer

**Files:**
- Modify: src/routes/+page.svelte
- Modify: src/routes/app.css

**Interfaces:**
- Consumes: PdfViewer(file, onClose) from Task 2 and the file validation helper from Task 1.

- [x] **Step 1: Replace** placeholder file acceptance with asynchronous signature validation and clear error feedback.
- [x] **Step 2: Connect** valid file selection/drop to the viewer and preserve the filename and size in the viewer header.
- [x] **Step 3: Ensure** closing the viewer returns to the landing page and resets the file input so the same file can be selected again.
- [ ] **Step 4: Run** npm run check, npm test, and npm run build.

### Task 4: Final verification and tracker update

**Files:**
- Modify: PROJECT_PLAN.md
- Modify: README.md

- [x] **Step 1:** Update foundation and viewer tracker statuses based on actual CI results.
- [x] **Step 2:** Document current viewer limitations and controls.
- [x] **Step 3:** Review all changed files for privacy, accessibility, resource cleanup, and dependency scope.
- [ ] **Step 4:** Verify the latest GitHub Actions run is green; do not claim success without its completed result.

## Execution Notes

- Work on feat/app-foundation so the open PR remains the review point.
- Use the Vitest tests as the RED/GREEN contract for helper behavior.
- Run CI after the test-only commit, then again after implementation.
- The first CI test-only run confirmed the expected RED state (the new helper module was missing) and the earlier SvelteKit route-file naming error was removed. The helpers and viewer implementation have since been committed, but a completed green run on the latest head has not yet been observed.
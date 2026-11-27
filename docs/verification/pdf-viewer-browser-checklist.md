# PDF Viewer Browser Verification

Use this checklist against a production build or preview server before marking the viewer MVP complete. Playwright covers repeatable Chromium workflows; the manual cross-browser, accessibility, privacy, and unusual-file checks below remain necessary.

## Test setup

- [ ] Run `npm ci`, `npm run check`, `npm test`, and `npm run build`.
- [ ] Run the production preview and open it in current desktop Chrome/Firefox and mobile-width emulation.
- [ ] Prepare a valid multi-page PDF, a one-page PDF, a zero-byte file, a non-PDF renamed to `.pdf`, and a malformed/truncated PDF.
- [ ] Use only non-sensitive sample documents.

## Import and validation

- [ ] Select a PDF through the file picker; the viewer opens and shows its filename.
- [ ] Drag and drop a PDF; it opens equivalently to file-picker import.
- [ ] Cancel the picker or drop no file; the landing page remains stable.
- [ ] Select a non-PDF renamed to `.pdf`; readable validation feedback appears and no viewer opens.
- [ ] Select a zero-byte file; readable feedback appears without a stuck loading state.
- [ ] Select an unreadable/malformed PDF; an error is shown and the user can close it or choose another file.
- [ ] After closing, select the same file again; import works.

## Viewer controls and rendering

- [ ] First and last page boundaries disable or safely constrain previous/next navigation.
- [ ] Page indicator updates correctly across a multi-page document.
- [ ] Zoom in/out respects the documented minimum and maximum; fit-width works after resizing.
- [ ] Rapidly change pages and zoom while rendering; stale renders do not replace the latest page.
- [ ] Close while a page is rendering; no stale error or canvas appears after returning to the landing page.
- [ ] Test a large page and high-DPI viewport; rendering stays within the scale cap and the page remains reachable by scrolling.
- [ ] Verify selectable text appears over the rendered canvas, aligns at multiple zoom levels, and can be selected/copied.
- [ ] Change page and zoom rapidly; confirm old text-layer spans are cleared and not left selectable on a new page.
- [ ] Test narrow/mobile width; toolbar controls remain reachable and the page does not force the whole app horizontally off-screen.
- [ ] Use Print and confirm the original full PDF opens in a separate browser-native PDF viewer, with all pages available to the browser's Print control.
- [ ] On mobile, the thumbnail rail starts collapsed, opens with Show pages, and collapses after selecting a thumbnail.

## Performance and large documents

- [ ] Run the synthetic 120-page fixture in Chromium; confirm the first and final pages render when brought near the viewport.
- [ ] Confirm no more than six page canvases remain active near either end of the document and off-screen canvases are released.
- [ ] Record fixture size, upload-to-first-render time, distant-page render time, viewport, browser version, and CI run link; compare timings only against the same runner class.
- [ ] Repeat with representative real PDFs and inspect browser memory during long scroll sessions.

## PDF regression fixture coverage

- [ ] Generate a valid multi-page PDF with selectable text and an embedded PNG; verify the image is rendered and text remains selectable.
- [ ] Verify a page rotated 90° with a non-default crop box renders with the expected rotated aspect ratio and searchable text.
- [ ] Verify a valid password-protected PDF produces a clear, safe error when no password prompt/authorized unlock workflow is implemented.
- [ ] Verify a PDF with a valid header but truncated/missing page objects produces a recoverable error and the user can return to tools.
- [ ] Keep generated fixtures deterministic and record the expected page geometry, rotation, and text in the fixture guide.
- [ ] Repeat relevant cases with representative PDFs from independent sources; synthetic fixtures do not replace real-world coverage.

## Cross-browser compatibility

- [ ] Run the full Playwright regression suite in current Chromium.
- [ ] Run the compatibility smoke suite in current Firefox; then manually verify file import, keyboard navigation, search, zoom, and printing in desktop Firefox.
- [ ] Run the compatibility smoke suite in Playwright WebKit. Treat this as WebKit-engine coverage only, not as proof that Safari works.
- [ ] Open the deployed or production-preview build in actual Safari on macOS and iOS; verify PDF import, selectable text, continuous scrolling, search, zoom, printing, and theme persistence.
- [ ] On mobile Chrome and Safari, verify touch targets, thumbnail open/close behavior, portrait/landscape rotation, and absence of horizontal overflow.
- [ ] Record exact browser/OS versions, viewport or device, pass/fail, and issue links. Do not mark the matrix complete from CI smoke results alone.

## Text and image content overlays

- [ ] Open an unrotated source PDF and confirm the page preview is rendered locally.
- [ ] Add text, change its position, size, and color, then export a new copy; reopen it and confirm both original and inserted text are present.
- [ ] Add PNG and JPEG images; verify preview sizing/aspect ratio and confirm embedded pixels in the exported PDF.
- [ ] Try positions and sizes near every page edge; content outside the visible crop box must be rejected without changing the source.
- [ ] Select a rotated page; confirm the tool explains that rotation is not yet supported and blocks export.
- [ ] Confirm the source PDF bytes remain unchanged and no document/image bytes are sent over the network.
- [ ] Inspect exported text and image placement in an independent desktop PDF reader, including a page with a non-zero crop-box origin.

## Annotation tools

- [ ] Select PDF text and create a highlight; verify multi-line selections retain each line rectangle.
- [ ] Select a highlight, move it, and verify it stays inside the page bounds; undo and redo both creation and movement.
- [ ] Draw rectangle and arrow annotations; verify their positions remain aligned after zoom and page rotation, and undo/redo works.
- [ ] Place a text note on the page, save it, reopen it, edit the text, and delete it.
- [ ] Move a text note by dragging its marker; confirm it stays aligned after zoom and on pages with 90/180/270-degree rotation.
- [ ] Navigate away from a page and back; annotations remain on their original page while the document stays open.
- [ ] Close the document and reopen it; confirm annotations are not persisted and the source PDF remains unchanged.
- [ ] Confirm annotations are not included in Print/export yet; do not present them as edits to the original PDF.

## Document information

- [ ] Open Document info and verify filename, file size, page count, PDF version, title, author, subject, creator, and producer where present.
- [ ] Confirm missing optional metadata is described as unavailable/not specified rather than blocking the document from opening.
- [ ] Close and reopen the information panel; it must not modify document bytes or upload metadata.

## Accessibility and privacy

- [ ] From a fresh page load, the first Tab stop is the visible-on-focus “Skip to main content” link; activating it moves focus to the main landmark.
- [ ] Complete file selection and all viewer controls using keyboard only; focus is visible.
- [ ] Screen-reader labels identify the file input, page controls, zoom controls, and close action.
- [ ] Loading and error states are announced or exposed through appropriate status/alert semantics.
- [ ] Verify in browser DevTools Network that opening and navigating a local PDF does not upload document bytes.
- [ ] Check console for uncaught errors and verify object URLs, render tasks, and PDF resources are cleaned up on close.

## Record results

Record browser/version, viewport, sample fixture names, pass/fail, and any issue links in the PR. Do not mark this checklist complete based solely on CI passing.

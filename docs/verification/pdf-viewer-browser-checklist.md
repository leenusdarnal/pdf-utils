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
- [ ] Test narrow/mobile width; toolbar controls remain reachable and the page does not force the whole app horizontally off-screen.
- [ ] Use Print and confirm the original full PDF opens in a separate browser-native PDF viewer, with all pages available to the browser's Print control.
- [ ] On mobile, the thumbnail rail starts collapsed, opens with Show pages, and collapses after selecting a thumbnail.

## Document information

- [ ] Open Document info and verify filename, file size, page count, PDF version, title, author, subject, creator, and producer where present.
- [ ] Confirm missing optional metadata is described as unavailable/not specified rather than blocking the document from opening.
- [ ] Close and reopen the information panel; it must not modify document bytes or upload metadata.

## Accessibility and privacy

- [ ] Complete file selection and all viewer controls using keyboard only; focus is visible.
- [ ] Screen-reader labels identify the file input, page controls, zoom controls, and close action.
- [ ] Loading and error states are announced or exposed through appropriate status/alert semantics.
- [ ] Verify in browser DevTools Network that opening and navigating a local PDF does not upload document bytes.
- [ ] Check console for uncaught errors and verify object URLs, render tasks, and PDF resources are cleaned up on close.

## Record results

Record browser/version, viewport, sample fixture names, pass/fail, and any issue links in the PR. Do not mark this checklist complete based solely on CI passing.

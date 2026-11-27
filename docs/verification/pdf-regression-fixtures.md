# PDF Regression Fixture Set

These fixtures are generated deterministically during Playwright tests so the repository does not need opaque binary samples for every structural case.

| Fixture builder | PDF characteristics | Expected regression |
| --- | --- | --- |
| `createImageAndPageBoxesPdf` | Selectable text, embedded red PNG, two pages, custom media/crop box, second page rotated 90° | Text-layer content is extractable; rendered canvas contains the expected image pixels; rotated page keeps the crop-box aspect ratio |
| `createPasswordProtectedPdf` | Valid PDF 1.4 with the Standard Security Handler revision 2 (40-bit RC4); test user password `user-secret` | PDF parsing identifies the file as encrypted; viewer displays its safe password-protected error because password entry/authorized unlocking is not implemented |
| `createTruncatedPdf` | PDF header and partial catalog/page tree, but missing page object and cross-reference/trailer completion | Import passes header screening, parsing fails safely, and the user can return to the tool landing page |

## Fixture integrity

The encrypted sample is generated in code with a deterministic file ID and test-only credentials. RC4 is included solely to create a tiny legacy encrypted fixture for regression testing; it is not an application encryption implementation and must not be reused for protecting user documents.

The test suite validates the encrypted fixture with pdf-lib's encrypted-file rejection before exercising the viewer. The malformed fixture intentionally tests parser recovery/error handling, not repair or restoration of lost content.

## Coverage limits

These generated files cover selected structural cases. They do not establish compatibility with every PDF version, encryption revision, embedded font, color space, image codec, form, attachment, signature, or malformed cross-reference pattern. Add representative samples from independent sources with licensing and provenance recorded before closing QLT-04. Independent desktop-reader inspection remains necessary for visual-fidelity-sensitive operations.

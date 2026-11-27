# Browser Compatibility Matrix

## Automated CI coverage

| Browser project | Automated scope | What it establishes |
| --- | --- | --- |
| Chromium | Full Playwright end-to-end suite, including PDF tools and the 120-page performance regression | Main browser regression coverage |
| Firefox | Focused compatibility smoke suite | Keyboard skip navigation, persistent theme selection, local two-page PDF import, selectable text, and continuous-page navigation |
| Playwright WebKit | Same focused compatibility smoke suite | WebKit-engine smoke coverage; this is not actual Safari verification |

The Firefox and WebKit projects are limited to `e2e/browser-compatibility.spec.ts` so that the full PDF-tool suite is not triplicated on every CI run. The Chromium project continues to run every end-to-end spec.

## Manual platform verification

| Platform | Required manual checks | Status |
| --- | --- | --- |
| Desktop Chrome / Chromium | Full tool workflows, printing, keyboard-only operation, visual fidelity | Required |
| Desktop Firefox | PDF import, selectable text, scroll/navigation, search, zoom, print, theme persistence | Required |
| Safari on macOS | PDF import, selectable text, continuous scrolling, search, zoom, print, theme persistence | Required |
| Safari on iOS | File picker, touch scrolling, thumbnail controls, rotation, zoom, print/share behavior, theme persistence | Required |
| Chrome on Android | File picker, touch targets, rotation, zoom, scrolling, no horizontal overflow | Required |

Record exact browser and OS versions, device or viewport, fixture names, pass/fail, and issue links in the PR. CI smoke coverage is not sufficient to close the manual matrix, and Playwright WebKit must not be described as real Safari coverage.

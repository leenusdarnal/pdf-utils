# PDF Viewer Performance Baseline

## Repeatable browser fixture

The Playwright suite creates a synthetic 120-page PDF locally with `pdf-lib`. Each page uses a 612 × 792 point page box and one short selectable text line. The fixture is generated during the test and is not checked into the repository.

The test runs in Chromium at a 1365 × 900 viewport. It measures upload-to-first-page-render time, then scrolls to page 120 and measures the time until that distant page is rendered.

## Rendering and memory guardrails

- The viewer must mount all 120 page sections without eagerly rendering every page canvas.
- At both the first and final page positions, no more than six page canvases may have a non-zero rendered width.
- After scrolling to the final page, the first page canvas must be cleared to zero width.
- The test has a 15-second wait bound for the initial and distant page render. This is a failure timeout, not a performance target.

## Measurements

Each CI run prints one `[pdf-performance-baseline]` line containing fixture page count and byte size, upload-to-first-render milliseconds, rendered canvas count at the start, scroll-to-last-page render milliseconds, and rendered canvas count at the end.

Timing is environment-dependent. Compare runs on the same GitHub-hosted runner class and keep the fixture, viewport, browser project, and code path constant. The measurements are a trend baseline, not a claim about performance on every user's device.

## First CI baseline

Recorded from [GitHub Actions run 45932075817](https://github.com/leenusdarnal/pdf-utils/actions/runs/45932075817) on the `ubuntu-latest` Chromium job at a 1365 × 900 viewport:

| Measurement | Result |
| --- | ---: |
| Fixture | 120 pages, 27,051 bytes |
| Upload to first-page render | 1,096 ms |
| Active canvases at first page | 2 |
| Scroll to final-page render | 139 ms |
| Active canvases at final page | 2 |

This is the first recorded run, not a statistical performance guarantee. Use repeated runs on the same runner class to establish normal variance before setting tighter timing thresholds.

## Remaining verification

This synthetic regression does not replace tests with real, image-heavy, encrypted, malformed, or unusually large PDFs. Browser memory profiling, mobile-device measurements, and Firefox/Safari coverage remain open under QLT-02 and QLT-03.

import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function createCompatibilityPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Compatibility fixture page ${pageNumber}`, {
      x: 72,
      y: 720,
      size: 20,
      font
    });
  }

  return Buffer.from(await document.save());
}

async function visitHome(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('#file-input')).toHaveCount(1);
}

test('supports keyboard skip navigation and persistent theme selection', async ({ page, browserName }) => {
  await visitHome(page);

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  const themeButton = page.locator('header button[aria-pressed]');
  await expect(themeButton).toHaveCount(1);
  const initialTheme = await themeButton.getAttribute('aria-pressed');
  const nextTheme = initialTheme === 'true' ? 'false' : 'true';

  await themeButton.click();
  await expect(themeButton).toHaveAttribute('aria-pressed', nextTheme);
  await page.reload();
  await expect(page.locator('header button[aria-pressed]')).toHaveAttribute(
    'aria-pressed',
    nextTheme
  );

  console.log(`[browser-compatibility] engine=${browserName} skip_navigation=passed theme_persistence=passed`);
});

test('imports a local two-page PDF and navigates selectable page text', async ({ page, browserName }) => {
  await visitHome(page);
  const fixture = await createCompatibilityPdf();

  await page.locator('#file-input').setInputFiles({
    name: 'browser-compatibility.pdf',
    mimeType: 'application/pdf',
    buffer: fixture
  });

  await expect(page.locator('[aria-label="PDF viewer"]')).toBeVisible({ timeout: 20_000 });
  const firstPage = page.locator('[data-pdf-continuous-page="1"]');
  const secondPage = page.locator('[data-pdf-continuous-page="2"]');
  await expect(firstPage.locator('.textLayer')).toContainText('Compatibility fixture page 1', {
    timeout: 20_000
  });

  const viewport = page.getByRole('region', { name: 'Document page area' });
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect(secondPage).toBeInViewport();
  await expect(secondPage.locator('.textLayer')).toContainText('Compatibility fixture page 2', {
    timeout: 20_000
  });

  console.log(`[browser-compatibility] engine=${browserName} two_page_local_pdf=passed`);
});

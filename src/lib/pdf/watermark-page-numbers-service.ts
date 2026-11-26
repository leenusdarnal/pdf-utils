import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import {
  getPageNumberLabel,
  getTextOverlayPlacement,
  getVisualPageSize,
  sanitizePdfOverlayText,
  type PageNumberFormat,
  type PageNumberPosition
} from './watermark-page-numbers';

export const MAX_WATERMARK_PDF_BYTES = 150 * 1024 * 1024;
export const MAX_WATERMARK_PDF_PAGES = 500;

export interface WatermarkOptions {
  text: string;
  color: string;
  fontSize: number;
  opacity: number;
  angle: 0 | 45;
}
export interface PageNumberOptions {
  format: PageNumberFormat;
  position: PageNumberPosition;
  color: string;
  fontSize: number;
  margin: number;
}
export interface WatermarkPageNumbersOptions {
  pages: readonly number[];
  watermark?: WatermarkOptions;
  pageNumbers?: PageNumberOptions;
}
export interface WatermarkPageNumbersResult {
  bytes: Uint8Array;
  totalPages: number;
  changedPages: number;
  fileSize: number;
}

function validateColor(value: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error('Choose a six-digit hex color such as #777777.');
  }
}
function toRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}
function safeFontText(value: string, font: PDFFont): string {
  return Array.from(value, (character) => {
    try { font.encodeText(character); return character; } catch { return '?'; }
  }).join('');
}
function validateOptions(options: WatermarkPageNumbersOptions): void {
  if (!options.watermark && !options.pageNumbers) {
    throw new Error('Enable a watermark or page numbers before exporting.');
  }
  if (options.pages.length === 0) throw new Error('Select at least one page to update.');
  if (new Set(options.pages).size !== options.pages.length) throw new Error('A page can only be selected once.');

  if (options.watermark) {
    const text = sanitizePdfOverlayText(options.watermark.text);
    if (!text) throw new Error('Enter watermark text before exporting.');
    if (text.length > 120) throw new Error('Watermark text must be 120 characters or fewer.');
    validateColor(options.watermark.color);
    if (!Number.isFinite(options.watermark.fontSize) || options.watermark.fontSize < 8 || options.watermark.fontSize > 96) {
      throw new Error('Watermark font size must be between 8 and 96 points.');
    }
    if (!Number.isFinite(options.watermark.opacity) || options.watermark.opacity < 0.05 || options.watermark.opacity > 0.9) {
      throw new Error('Watermark opacity must be between 5% and 90%.');
    }
    if (options.watermark.angle !== 0 && options.watermark.angle !== 45) {
      throw new Error('Choose a horizontal or diagonal watermark.');
    }
  }
  if (options.pageNumbers) {
    validateColor(options.pageNumbers.color);
    if (!Number.isFinite(options.pageNumbers.fontSize) || options.pageNumbers.fontSize < 6 || options.pageNumbers.fontSize > 24) {
      throw new Error('Page-number font size must be between 6 and 24 points.');
    }
    if (!Number.isFinite(options.pageNumbers.margin) || options.pageNumbers.margin < 8 || options.pageNumbers.margin > 72) {
      throw new Error('Page-number margin must be between 8 and 72 points.');
    }
  }
}

function drawCenteredText(
  page: ReturnType<PDFDocument['getPage']>,
  font: PDFFont,
  text: string,
  color: ReturnType<typeof rgb>,
  opacity: number,
  fontSize: number,
  bounds: { x: number; y: number; width: number; height: number },
  pageRotation: number,
  center: { x: number; y: number },
  displayedAngle: number
): void {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const placement = getTextOverlayPlacement(bounds, pageRotation, center, textWidth, fontSize, displayedAngle);
  page.drawText(text, {
    x: placement.x,
    y: placement.y,
    size: fontSize,
    font,
    color,
    opacity,
    rotate: degrees(placement.rotation)
  });
}

function getPageNumberCenter(
  position: PageNumberPosition,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  textWidth: number,
  fontSize: number
): { x: number; y: number } {
  const horizontal = position.endsWith('-left')
    ? margin + textWidth / 2
    : position.endsWith('-right')
      ? pageWidth - margin - textWidth / 2
      : pageWidth / 2;
  const vertical = position.startsWith('top')
    ? pageHeight - margin - fontSize / 2
    : margin + fontSize / 2;
  return { x: horizontal, y: vertical };
}

export async function addWatermarkAndPageNumbers(
  source: Blob,
  options: WatermarkPageNumbersOptions,
  onProgress?: (completed: number, total: number, pageNumber: number) => void
): Promise<WatermarkPageNumbersResult> {
  if (source.size === 0) throw new Error('Choose a non-empty PDF file.');
  if (source.size > MAX_WATERMARK_PDF_BYTES) throw new Error('This PDF exceeds the 150 MB watermark/page-number limit.');
  validateOptions(options);

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(new Uint8Array(await source.arrayBuffer()));
  } catch {
    throw new Error('This PDF could not be opened. It may be damaged, encrypted, or unsupported.');
  }

  const pages = document.getPages();
  if (pages.length < 1) throw new Error('This PDF does not contain any pages.');
  if (pages.length > MAX_WATERMARK_PDF_PAGES) throw new Error('This tool supports up to 500 pages per PDF.');
  if (options.pages.some((value) => !Number.isInteger(value) || value < 1 || value > pages.length)) {
    throw new Error('One or more selected pages are outside the document.');
  }

  const regularFont = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  const watermarkText = options.watermark
    ? safeFontText(sanitizePdfOverlayText(options.watermark.text), boldFont)
    : '';
  const targetPages = new Set(options.pages);
  let changedPages = 0;

  for (let pageNumber = 1; pageNumber <= pages.length; pageNumber += 1) {
    if (!targetPages.has(pageNumber)) continue;
    const page = pages[pageNumber - 1];
    const bounds = page.getCropBox();
    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error('Page ' + pageNumber + ' has invalid visible dimensions.');
    }
    const rotation = page.getRotation().angle;
    const visualSize = getVisualPageSize(bounds, rotation);

    if (options.watermark && watermarkText) {
      const desiredSize = options.watermark.fontSize;
      const desiredWidth = boldFont.widthOfTextAtSize(watermarkText, desiredSize);
      const availableWidth = Math.hypot(visualSize.width, visualSize.height) * 0.72;
      const fontSize = Math.min(desiredSize, (desiredSize * availableWidth) / Math.max(1, desiredWidth));
      if (fontSize < 8) {
        throw new Error('Watermark text is too long to fit on page ' + pageNumber + '. Shorten it and try again.');
      }
      drawCenteredText(
        page, boldFont, watermarkText, toRgb(options.watermark.color), options.watermark.opacity,
        fontSize, bounds, rotation, { x: visualSize.width / 2, y: visualSize.height / 2 }, options.watermark.angle
      );
    }

    if (options.pageNumbers) {
      const text = safeFontText(
        getPageNumberLabel(pageNumber, pages.length, options.pageNumbers.format),
        regularFont
      );
      const size = options.pageNumbers.fontSize;
      const width = regularFont.widthOfTextAtSize(text, size);
      const center = getPageNumberCenter(
        options.pageNumbers.position, visualSize.width, visualSize.height,
        options.pageNumbers.margin, width, size
      );
      drawCenteredText(
        page, regularFont, text, toRgb(options.pageNumbers.color), 1,
        size, bounds, rotation, center, 0
      );
    }
    changedPages += 1;
    onProgress?.(changedPages, targetPages.size, pageNumber);
  }

  let bytes: Uint8Array;
  try { bytes = await document.save(); }
  catch { throw new Error('The updated PDF could not be saved. Try a smaller document.'); }
  return { bytes, totalPages: pages.length, changedPages, fileSize: bytes.byteLength };
}

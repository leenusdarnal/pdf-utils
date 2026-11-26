import { degrees, PDFDocument, StandardFonts, rgb, type PDFImage } from 'pdf-lib';

export type OverlayPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type PageNumberFormat = 'page-of-total' | 'slash-total' | 'number';

export interface TextWatermarkOptions {
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  rotation: number;
  position: OverlayPosition;
}

export interface ImageWatermarkOptions {
  image: Blob;
  opacity: number;
  scalePercent: number;
  position: OverlayPosition;
}

export interface PageNumberOptions {
  format: PageNumberFormat;
  startNumber: number;
  fontSize: number;
  color: string;
  position: OverlayPosition;
}

export interface WatermarkPageNumbersOptions {
  /** One-based source page numbers, normally produced by parsePageRange. */
  pages: readonly number[];
  marginMm: number;
  textWatermark?: TextWatermarkOptions;
  imageWatermark?: ImageWatermarkOptions;
  pageNumbers?: PageNumberOptions;
}

export interface PdfPageGeometry {
  pageCount: number;
  width: number;
  height: number;
  rotation: number;
}

export interface OverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayOrigin {
  x: number;
  y: number;
}

export const MAX_WATERMARK_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_WATERMARK_TEXT_LENGTH = 120;
const POINTS_PER_MM = 72 / 25.4;
const POSITIONS: readonly OverlayPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'center',
  'bottom-left',
  'bottom-center',
  'bottom-right'
];

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function validateColor(value: string, label: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(label + ' must be a six-digit hex color.');
  }
}

function toRgb(hex: string) {
  return rgb(
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255
  );
}

function validatePosition(position: OverlayPosition): void {
  if (!POSITIONS.includes(position)) throw new Error('Choose a supported overlay position.');
}

function validateOpacity(value: number, label: string): void {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    throw new Error(label + ' opacity must be between 0 and 100%.');
  }
}

/**
 * Return the bottom-left PDF coordinate for an overlay box.
 * The same calculation is used by the preview and by the PDF exporter.
 */
export function calculateOverlayBox(
  pageWidth: number,
  pageHeight: number,
  contentWidth: number,
  contentHeight: number,
  position: OverlayPosition,
  marginPoints: number
): OverlayBox {
  for (const [value, label] of [
    [pageWidth, 'Page width'],
    [pageHeight, 'Page height'],
    [contentWidth, 'Overlay width'],
    [contentHeight, 'Overlay height'],
    [marginPoints, 'Page margin']
  ] as const) {
    if (!isFiniteNumber(value) || value < 0) throw new Error(label + ' must be a non-negative number.');
  }
  if (pageWidth <= 0 || pageHeight <= 0 || contentWidth > pageWidth || contentHeight > pageHeight) {
    throw new Error('The overlay does not fit within the selected page size.');
  }
  validatePosition(position);

  const x = position.endsWith('left')
    ? marginPoints
    : position.endsWith('right')
      ? pageWidth - marginPoints - contentWidth
      : (pageWidth - contentWidth) / 2;
  const y = position.startsWith('top')
    ? pageHeight - marginPoints - contentHeight
    : position.startsWith('bottom')
      ? marginPoints
      : (pageHeight - contentHeight) / 2;

  return {
    x: Math.max(0, Math.min(pageWidth - contentWidth, x)),
    y: Math.max(0, Math.min(pageHeight - contentHeight, y)),
    width: contentWidth,
    height: contentHeight
  };
}

/** Keep rotated text centered on the selected overlay box. */
export function calculateRotatedTextOrigin(box: OverlayBox, rotation: number): OverlayOrigin {
  if (!isFiniteNumber(rotation)) throw new Error('Rotation must be a finite number.');
  const radians = rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return {
    x: centerX - (box.width / 2 * cosine - box.height / 2 * sine),
    y: centerY - (box.width / 2 * sine + box.height / 2 * cosine)
  };
}

export function formatPageNumber(
  pageNumber: number,
  totalPages: number,
  format: PageNumberFormat,
  startNumber = 1
): string {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
    !Number.isSafeInteger(totalPages) || totalPages < 1 ||
    !Number.isSafeInteger(startNumber) || startNumber < 1) {
    throw new Error('Page numbering values must be positive whole numbers.');
  }
  const current = pageNumber + startNumber - 1;
  const total = totalPages + startNumber - 1;
  if (format === 'number') return String(current);
  if (format === 'slash-total') return current + ' / ' + total;
  if (format === 'page-of-total') return 'Page ' + current + ' of ' + total;
  throw new Error('Choose a supported page-number format.');
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function embedWatermarkImage(document: PDFDocument, source: Blob): Promise<PDFImage> {
  if (source.size === 0 || source.size > MAX_WATERMARK_IMAGE_BYTES) {
    throw new Error('Choose a non-empty PNG or JPEG image smaller than 15 MB.');
  }

  const bytes = new Uint8Array(await source.arrayBuffer());
  try {
    if (hasPngSignature(bytes)) return await document.embedPng(bytes);
    if (hasJpegSignature(bytes)) return await document.embedJpg(bytes);
  } catch {
    throw new Error('The selected watermark image is damaged or cannot be decoded.');
  }
  throw new Error('Use a PNG or JPEG image for the watermark. WebP and other formats are not supported.');
}

function fitTextSize(font: { widthOfTextAtSize(text: string, size: number): number }, text: string, requestedSize: number, maxWidth: number): number {
  const available = Math.max(1, maxWidth);
  const measured = font.widthOfTextAtSize(text, requestedSize);
  const size = measured > available ? requestedSize * available / measured : requestedSize;
  if (size < 6) throw new Error('This watermark text is too long to fit on the selected page. Shorten the text or reduce its size.');
  return size;
}

function validateOptions(options: WatermarkPageNumbersOptions, pageCount: number): void {
  if (!Array.isArray(options.pages) || options.pages.length === 0) {
    throw new Error('Choose at least one page to modify.');
  }
  const seen = new Set<number>();
  for (const pageNumber of options.pages) {
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new Error('Selected page numbers must be between 1 and ' + pageCount + '.');
    }
    if (seen.has(pageNumber)) throw new Error('A page is selected more than once.');
    seen.add(pageNumber);
  }

  if (!isFiniteNumber(options.marginMm) || options.marginMm < 0 || options.marginMm > 100) {
    throw new Error('The page margin must be between 0 and 100 mm.');
  }

  const text = options.textWatermark;
  if (text) {
    if (!text.text.trim() || text.text.length > MAX_WATERMARK_TEXT_LENGTH) {
      throw new Error('Enter watermark text between 1 and ' + MAX_WATERMARK_TEXT_LENGTH + ' characters.');
    }
    if (!isFiniteNumber(text.fontSize) || text.fontSize < 6 || text.fontSize > 144) {
      throw new Error('Watermark text size must be between 6 and 144 points.');
    }
    if (!isFiniteNumber(text.rotation) || text.rotation < -180 || text.rotation > 180) {
      throw new Error('Watermark rotation must be between -180 and 180 degrees.');
    }
    validateColor(text.color, 'Watermark color');
    validateOpacity(text.opacity, 'Watermark');
    validatePosition(text.position);
  }

  const image = options.imageWatermark;
  if (image) {
    if (!isFiniteNumber(image.scalePercent) || image.scalePercent < 5 || image.scalePercent > 80) {
      throw new Error('Image watermark size must be between 5% and 80% of the page.');
    }
    validateOpacity(image.opacity, 'Image watermark');
    validatePosition(image.position);
  }

  const pageNumbers = options.pageNumbers;
  if (pageNumbers) {
    if (!isFiniteNumber(pageNumbers.fontSize) || pageNumbers.fontSize < 6 || pageNumbers.fontSize > 48) {
      throw new Error('Page-number size must be between 6 and 48 points.');
    }
    if (!Number.isSafeInteger(pageNumbers.startNumber) ||
      pageNumbers.startNumber < 1 || pageNumbers.startNumber > 999_999) {
      throw new Error('Page numbering must start at a whole number between 1 and 999,999.');
    }
    validateColor(pageNumbers.color, 'Page-number color');
    validatePosition(pageNumbers.position);
    formatPageNumber(1, pageCount, pageNumbers.format, pageNumbers.startNumber);
  }

  if (!text && !image && !pageNumbers) {
    throw new Error('Enable a text watermark, image watermark, or page numbering before exporting.');
  }
}

async function loadPdf(source: Blob): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(new Uint8Array(await source.arrayBuffer()));
  } catch {
    throw new Error('This PDF could not be opened. It may be damaged or password-protected.');
  }
}

export async function getPdfPageGeometry(
  source: Blob,
  pageNumber = 1
): Promise<PdfPageGeometry> {
  const document = await loadPdf(source);
  const pageCount = document.getPageCount();
  if (pageCount < 1) throw new Error('The PDF does not contain any pages.');
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
    throw new Error('The requested preview page does not exist.');
  }

  const page = document.getPage(pageNumber - 1);
  const size = page.getSize();
  const rotation = page.getRotation().angle;
  const rotated = Math.abs(rotation % 180) === 90;
  return {
    pageCount,
    width: rotated ? size.height : size.width,
    height: rotated ? size.width : size.height,
    rotation
  };
}

/** Apply the selected overlays to a new local PDF copy. The source is untouched. */
export async function watermarkAndNumberPdf(
  source: Blob,
  options: WatermarkPageNumbersOptions,
  onProgress?: (completed: number, total: number, pageNumber: number) => void
): Promise<Uint8Array> {
  const document = await loadPdf(source);
  const pageCount = document.getPageCount();
  if (pageCount < 1) throw new Error('The PDF does not contain any pages.');
  validateOptions(options, pageCount);

  const font = await document.embedFont(StandardFonts.Helvetica);
  const image = options.imageWatermark
    ? await embedWatermarkImage(document, options.imageWatermark.image)
    : null;
  const margin = options.marginMm * POINTS_PER_MM;

  for (let index = 0; index < options.pages.length; index += 1) {
    const pageNumber = options.pages[index];
    const page = document.getPage(pageNumber - 1);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    if (options.textWatermark) {
      const settings = options.textWatermark;
      const text = settings.text.trim().replace(/\s+/g, ' ');
      const availableWidth = Math.max(1, pageWidth - Math.min(margin, pageWidth / 2) * 2);
      const fontSize = fitTextSize(font, text, settings.fontSize, availableWidth);
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const textHeight = fontSize * 1.15;
      const radians = settings.rotation * Math.PI / 180;
      const rotatedWidth = Math.abs(textWidth * Math.cos(radians)) +
        Math.abs(textHeight * Math.sin(radians));
      const rotatedHeight = Math.abs(textWidth * Math.sin(radians)) +
        Math.abs(textHeight * Math.cos(radians));
      const rotatedBox = calculateOverlayBox(
        pageWidth,
        pageHeight,
        rotatedWidth,
        rotatedHeight,
        settings.position,
        margin
      );
      const origin = calculateRotatedTextOrigin(
        { x: rotatedBox.x, y: rotatedBox.y, width: textWidth, height: textHeight },
        settings.rotation
      );
      page.drawText(text, {
        x: origin.x,
        y: origin.y,
        size: fontSize,
        font,
        color: toRgb(settings.color),
        opacity: settings.opacity,
        rotate: degrees(settings.rotation)
      });
    }

    if (options.imageWatermark && image) {
      const settings = options.imageWatermark;
      const maxWidth = pageWidth * settings.scalePercent / 100;
      const maxHeight = pageHeight * settings.scalePercent / 100;
      const dimensions = image.scaleToFit(maxWidth, maxHeight);
      const box = calculateOverlayBox(
        pageWidth,
        pageHeight,
        dimensions.width,
        dimensions.height,
        settings.position,
        margin
      );
      page.drawImage(image, {
        x: box.x,
        y: box.y,
        width: dimensions.width,
        height: dimensions.height,
        opacity: settings.opacity
      });
    }

    if (options.pageNumbers) {
      const settings = options.pageNumbers;
      const label = formatPageNumber(
        pageNumber,
        pageCount,
        settings.format,
        settings.startNumber
      );
      const availableWidth = Math.max(1, pageWidth - Math.min(margin, pageWidth / 2) * 2);
      const fontSize = fitTextSize(font, label, settings.fontSize, availableWidth);
      const textWidth = font.widthOfTextAtSize(label, fontSize);
      const textHeight = fontSize * 1.15;
      const box = calculateOverlayBox(
        pageWidth,
        pageHeight,
        textWidth,
        textHeight,
        settings.position,
        margin
      );
      page.drawText(label, {
        x: box.x,
        y: box.y,
        size: fontSize,
        font,
        color: toRgb(settings.color),
        opacity: 1
      });
    }

    onProgress?.(index + 1, options.pages.length, pageNumber);
  }

  return document.save();
}

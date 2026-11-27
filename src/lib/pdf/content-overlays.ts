import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const MAX_CONTENT_OVERLAY_FILE_BYTES = 150 * 1024 * 1024;
export const MAX_CONTENT_OVERLAY_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_CONTENT_OVERLAY_PAGES = 500;
export const MAX_CONTENT_OVERLAY_TEXT_LENGTH = 1_000;

export type PdfContentOverlay =
  | {
      type: 'text';
      pageNumber: number;
      xPercent: number;
      yPercent: number;
      text: string;
      fontSize: number;
      color: string;
    }
  | {
      type: 'image';
      pageNumber: number;
      xPercent: number;
      yPercent: number;
      widthPercent: number;
      imageType: 'png' | 'jpeg';
      imageBytes: Uint8Array;
    };

export interface PdfContentOverlayResult {
  bytes: Uint8Array;
  pageCount: number;
  pageNumber: number;
  fileSize: number;
}

function validatePercent(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(label + ' must be between 0 and 100.');
  }
}

function parseColor(value: string) {
  if (!/^#[\\da-f]{6}$/i.test(value)) {
    throw new Error('Choose a six-digit hex color such as #c62828.');
  }
  const color = Number.parseInt(value.slice(1), 16);
  return rgb(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
}

function validateOverlay(overlay: PdfContentOverlay): void {
  if (!Number.isInteger(overlay.pageNumber) || overlay.pageNumber < 1) {
    throw new Error('Choose a valid page number.');
  }
  validatePercent(overlay.xPercent, 'Horizontal position');
  validatePercent(overlay.yPercent, 'Vertical position');

  if (overlay.type === 'text') {
    if (typeof overlay.text !== 'string' || overlay.text.trim().length === 0) {
      throw new Error('Enter the text to add to the page.');
    }
    if (overlay.text.length > MAX_CONTENT_OVERLAY_TEXT_LENGTH) {
      throw new Error('Overlay text must be 1,000 characters or fewer.');
    }
    if (!Number.isFinite(overlay.fontSize) || overlay.fontSize < 6 || overlay.fontSize > 96) {
      throw new Error('Text size must be between 6 and 96 points.');
    }
    parseColor(overlay.color);
    return;
  }

  validatePercent(overlay.widthPercent, 'Image width');
  if (overlay.widthPercent <= 0 || overlay.widthPercent > 100) {
    throw new Error('Image width must be greater than 0 and no more than 100% of the page.');
  }
  if (!(overlay.imageBytes instanceof Uint8Array) || overlay.imageBytes.byteLength === 0) {
    throw new Error('Choose a non-empty PNG or JPEG image.');
  }
  if (overlay.imageBytes.byteLength > MAX_CONTENT_OVERLAY_IMAGE_BYTES) {
    throw new Error('The selected image exceeds the 25 MB limit.');
  }
  if (overlay.imageType !== 'png' && overlay.imageType !== 'jpeg') {
    throw new Error('Only PNG and JPEG images can be added to a PDF.');
  }
}

export async function addPdfContentOverlay(
  source: Blob,
  overlay: PdfContentOverlay
): Promise<PdfContentOverlayResult> {
  if (!source || source.size === 0) throw new Error('Choose a non-empty PDF file.');
  if (source.size > MAX_CONTENT_OVERLAY_FILE_BYTES) {
    throw new Error('This PDF exceeds the 150 MB limit.');
  }
  validateOverlay(overlay);

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(new Uint8Array(await source.arrayBuffer()));
  } catch {
    throw new Error('This PDF could not be opened. It may be damaged, encrypted, or unsupported.');
  }

  const pages = document.getPages();
  if (pages.length < 1) throw new Error('This PDF does not contain any pages.');
  if (pages.length > MAX_CONTENT_OVERLAY_PAGES) {
    throw new Error('This tool supports up to 500 pages per PDF.');
  }
  if (overlay.pageNumber > pages.length) {
    throw new Error('The selected page is outside the document.');
  }

  const page = pages[overlay.pageNumber - 1];
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (rotation !== 0) {
    throw new Error('Rotate this page to 0° before adding an overlay. Rotated-page placement is not supported yet.');
  }

  const crop = page.getCropBox();
  if (crop.width <= 0 || crop.height <= 0) {
    throw new Error('The selected page has invalid visible dimensions.');
  }

  const x = crop.x + (overlay.xPercent / 100) * crop.width;
  const y = crop.y + (overlay.yPercent / 100) * crop.height;

  if (overlay.type === 'text') {
    const font = await document.embedFont(StandardFonts.Helvetica);
    const text = overlay.text.replace(/\\r\\n?/g, '\\n');
    const lines = text.split('\\n');
    try {
      for (const line of lines) font.encodeText(line);
    } catch {
      throw new Error('Text insertion currently supports standard Latin characters. Use a compatible font or simplify the text.');
    }


    const widestLine = Math.max(...lines.map((line) => font.widthOfTextAtSize(line, overlay.fontSize)));
    const blockHeight = overlay.fontSize * Math.max(1, lines.length) * 1.2;
    if (x + widestLine > crop.x + crop.width || y + blockHeight > crop.y + crop.height) {
      throw new Error('The text overlay extends beyond the visible page. Move it or reduce the text size.');
    }

    page.drawText(text, {
      x,
      y,
      size: overlay.fontSize,
      font,
      color: parseColor(overlay.color),
      lineHeight: overlay.fontSize * 1.2
    });
  } else {
    let image;
    try {
      image = overlay.imageType === 'png'
        ? await document.embedPng(overlay.imageBytes)
        : await document.embedJpg(overlay.imageBytes);
    } catch {
      throw new Error('The selected image could not be decoded. Choose a valid PNG or JPEG file.');
    }

    const width = (overlay.widthPercent / 100) * crop.width;
    const height = width * (image.height / image.width);
    if (x + width > crop.x + crop.width || y + height > crop.y + crop.height) {
      throw new Error('The image overlay extends beyond the visible page. Move it or reduce its width.');
    }

    page.drawImage(image, { x, y, width, height });
  }

  let bytes: Uint8Array;
  try {
    bytes = await document.save();
  } catch {
    throw new Error('The PDF could not be exported. Try a smaller image or another document.');
  }

  return {
    bytes,
    pageCount: pages.length,
    pageNumber: overlay.pageNumber,
    fileSize: bytes.byteLength
  };
}

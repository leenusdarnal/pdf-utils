import { PDFDocument } from 'pdf-lib';

export type ImagePdfPageSize = 'a4' | 'letter' | 'legal' | 'image';
export type ImagePdfOrientation = 'auto' | 'portrait' | 'landscape';
export type ImagePdfFit = 'contain' | 'stretch';
export type SupportedImageFormat = 'png' | 'jpeg' | 'webp';

export interface ImagesToPdfOptions {
  pageSize: ImagePdfPageSize;
  orientation: ImagePdfOrientation;
  marginMm: number;
  fit: ImagePdfFit;
}

export interface ImagePdfProgress {
  completed: number;
  total: number;
  fileName: string;
}

export interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

const POINTS_PER_MM = 72 / 25.4;
const PIXELS_PER_INCH = 96;
const PAGE_SIZE_POINTS: Record<Exclude<ImagePdfPageSize, 'image'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008]
};

export const MAX_IMAGE_COUNT = 100;
export const MAX_IMAGE_FILE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_SIDE = 20_000;
const MAX_IMAGE_PIXELS = 80_000_000;
const MAX_PAGE_SIDE_POINTS = 14_400;

export async function detectImageFormat(source: Blob): Promise<SupportedImageFormat | null> {
  const bytes = new Uint8Array(await source.slice(0, 12).arrayBuffer());
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return 'png';

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'webp';

  return null;
}

function validateMargin(marginMm: number): void {
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 50) {
    throw new Error('Choose a page margin between 0 and 50 mm.');
  }
}

export function resolveImagePdfPageSize(
  pageSize: ImagePdfPageSize,
  orientation: ImagePdfOrientation,
  imageWidth: number,
  imageHeight: number,
  marginMm: number
): { width: number; height: number } {
  validateMargin(marginMm);
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    throw new Error('The selected image has invalid dimensions.');
  }

  const marginPoints = marginMm * POINTS_PER_MM;
  let width: number;
  let height: number;

  if (pageSize === 'image') {
    width = imageWidth * (72 / PIXELS_PER_INCH) + marginPoints * 2;
    height = imageHeight * (72 / PIXELS_PER_INCH) + marginPoints * 2;
  } else {
    [width, height] = PAGE_SIZE_POINTS[pageSize];
    const shouldBeLandscape =
      orientation === 'landscape' ||
      (orientation === 'auto' && imageWidth > imageHeight);
    const shouldBePortrait =
      orientation === 'portrait' ||
      (orientation === 'auto' && imageWidth <= imageHeight);

    if (shouldBeLandscape && width < height) [width, height] = [height, width];
    if (shouldBePortrait && width > height) [width, height] = [height, width];
  }

  if (
    width > MAX_PAGE_SIDE_POINTS ||
    height > MAX_PAGE_SIDE_POINTS ||
    width <= marginPoints * 2 ||
    height <= marginPoints * 2
  ) {
    throw new Error('The resulting page size is outside the supported range.');
  }

  return { width, height };
}

export function calculateImagePlacement(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
  marginMm: number,
  fit: ImagePdfFit
): ImagePlacement {
  validateMargin(marginMm);
  const margin = marginMm * POINTS_PER_MM;
  const availableWidth = pageWidth - margin * 2;
  const availableHeight = pageHeight - margin * 2;

  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) {
    throw new Error('The image does not fit inside the selected page margins.');
  }

  if (fit === 'stretch') {
    return {
      x: margin,
      y: margin,
      width: availableWidth,
      height: availableHeight
    };
  }

  const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: margin + (availableWidth - width) / 2,
    y: margin + (availableHeight - height) / 2,
    width,
    height
  };
}

export function safePdfFileName(value: string): string {
  const base = value
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return (base || 'images-to-pdf') + '.pdf';
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not convert this WebP image.'));
    }, 'image/png');
  });
}

async function embedWebpAsPng(
  document: PDFDocument,
  file: File
): Promise<Awaited<ReturnType<PDFDocument['embedPng']>>> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode WebP images. Try converting the image to PNG first.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('The WebP image could not be decoded: ' + file.name);
  }

  const canvas = document.createElement('canvas');
  try {
    if (
      bitmap.width > MAX_IMAGE_SIDE ||
      bitmap.height > MAX_IMAGE_SIDE ||
      bitmap.width * bitmap.height > MAX_IMAGE_PIXELS
    ) {
      throw new Error('The image is too large to convert safely: ' + file.name);
    }

    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas image conversion is not available in this browser.');
    context.drawImage(bitmap, 0, 0);
    const pngBlob = await canvasToPng(canvas);
    return await document.embedPng(new Uint8Array(await pngBlob.arrayBuffer()));
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Create one PDF page per input image. Source files are read and embedded locally;
 * WebP images are decoded and converted to PNG in the browser before embedding.
 */
export async function convertImagesToPdf(
  files: readonly File[],
  options: ImagesToPdfOptions,
  onProgress?: (progress: ImagePdfProgress) => void
): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('Add at least one image before creating a PDF.');
  if (files.length > MAX_IMAGE_COUNT) {
    throw new Error('A PDF can contain at most ' + MAX_IMAGE_COUNT + ' images at a time.');
  }
  validateMargin(options.marginMm);

  const output = await PDFDocument.create();
  output.setTitle('Images converted to PDF');
  output.setProducer('PDF Utils');

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file.size === 0) throw new Error(file.name + ' is empty.');
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      throw new Error(file.name + ' is larger than the 40 MB per-image limit.');
    }

    const format = await detectImageFormat(file);
    if (!format) {
      throw new Error(file.name + ' is not a supported PNG, JPEG, or WebP image.');
    }

    let embeddedImage: Awaited<ReturnType<PDFDocument['embedPng']>>;
    try {
      if (format === 'webp') {
        embeddedImage = await embedWebpAsPng(output, file);
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        embeddedImage = format === 'png'
          ? await output.embedPng(bytes)
          : await output.embedJpg(bytes);
      }
    } catch (error) {
      if (error instanceof Error && error.message) throw error;
      throw new Error(file.name + ' could not be decoded as an image.');
    }

    const imageWidth = embeddedImage.width;
    const imageHeight = embeddedImage.height;
    if (
      imageWidth > MAX_IMAGE_SIDE ||
      imageHeight > MAX_IMAGE_SIDE ||
      imageWidth * imageHeight > MAX_IMAGE_PIXELS
    ) {
      throw new Error(file.name + ' has dimensions that exceed the supported image limit.');
    }

    const pageSize = resolveImagePdfPageSize(
      options.pageSize,
      options.orientation,
      imageWidth,
      imageHeight,
      options.marginMm
    );
    const placement = calculateImagePlacement(
      imageWidth,
      imageHeight,
      pageSize.width,
      pageSize.height,
      options.marginMm,
      options.fit
    );

    const page = output.addPage([pageSize.width, pageSize.height]);
    page.drawImage(embeddedImage, placement);
    onProgress?.({ completed: index + 1, total: files.length, fileName: file.name });
  }

  return output.save();
}

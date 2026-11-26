import { createPdfDocumentTask } from './pdfjs-client';

export interface ExtractedPdfImage {
  fileName: string;
  pageNumber: number;
  imageNumber: number;
  width: number;
  height: number;
  source: 'image-object' | 'inline-image';
  blob: Blob;
}

export interface EmbeddedImageProgress {
  completedPages: number;
  totalPages: number;
  foundImages: number;
  skippedImages: number;
  pageNumber: number;
}

export interface EmbeddedImageExtractionResult {
  images: ExtractedPdfImage[];
  pageCount: number;
  skippedImages: number;
}

interface PdfJsImageData {
  width?: number;
  height?: number;
  kind?: number;
  data?: ArrayLike<number> | ArrayBuffer;
  bitmap?: CanvasImageSource;
  [key: string]: unknown;
}

interface PdfJsObjectStore {
  has(id: string): boolean;
  get(
    id: string,
    callback?: (value: unknown) => void,
    errorCallback?: (reason: Error) => void
  ): unknown;
}

export const MAX_EMBEDDED_IMAGE_COUNT = 200;
export const MAX_EMBEDDED_IMAGE_FILE_BYTES = 150 * 1024 * 1024;
const MAX_IMAGE_SIDE = 20_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_TOTAL_IMAGE_PIXELS = 160_000_000;
const MAX_IMAGE_OBJECT_WAIT_MS = 15_000;

export function safeEmbeddedImageBaseName(value: string): string {
  return value
    .replace(/\.pdf$/i, '')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'document';
}

export function decodePdfImagePixels(
  source: Pick<PdfJsImageData, 'kind' | 'data'>,
  width: number,
  height: number
): Uint8ClampedArray {
  const pixelCount = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || pixelCount <= 0) {
    throw new Error('The PDF image has invalid pixel dimensions.');
  }
  const sourceData = source.data;
  if (!sourceData) {
    throw new Error('The PDF image has no decoded pixel data.');
  }

  const values = sourceData instanceof ArrayBuffer
    ? new Uint8Array(sourceData)
    : sourceData;
  const length = values.length;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  const kind = source.kind;

  if (kind === 3 || length === pixelCount * 4) {
    if (length < pixelCount * 4) throw new Error('The RGBA image data is incomplete.');
    for (let index = 0; index < pixelCount * 4; index += 1) {
      rgba[index] = Number(values[index]);
    }
  } else if (kind === 2 || length === pixelCount * 3) {
    if (length < pixelCount * 3) throw new Error('The RGB image data is incomplete.');
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const sourceOffset = pixel * 3;
      const targetOffset = pixel * 4;
      rgba[targetOffset] = Number(values[sourceOffset]);
      rgba[targetOffset + 1] = Number(values[sourceOffset + 1]);
      rgba[targetOffset + 2] = Number(values[sourceOffset + 2]);
      rgba[targetOffset + 3] = 255;
    }
  } else if (kind === 1 || length === pixelCount) {
    if (length < pixelCount) throw new Error('The grayscale image data is incomplete.');
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const gray = Number(values[pixel]);
      const targetOffset = pixel * 4;
      rgba[targetOffset] = gray;
      rgba[targetOffset + 1] = gray;
      rgba[targetOffset + 2] = gray;
      rgba[targetOffset + 3] = 255;
    }
  } else {
    throw new Error('The embedded image uses a pixel format that is not supported yet.');
  }

  return rgba;
}

function toImageData(
  source: PdfJsImageData,
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const rgba = decodePdfImagePixels(source, width, height);
  context.putImageData(new ImageData(rgba, width, height), 0, 0);
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not encode this embedded image as PNG.'));
      },
      'image/png'
    );
  });
}

async function imageObjectToPng(value: unknown): Promise<{ blob: Blob; width: number; height: number }> {
  if (!value || typeof value !== 'object') {
    throw new Error('The PDF image object could not be decoded.');
  }

  const source = value as PdfJsImageData;
  const width = Number(source.width);
  const height = Number(source.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('The image dimensions are outside the supported extraction limit.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas image conversion is not available in this browser.');

    if (source.bitmap) {
      context.drawImage(source.bitmap, 0, 0, width, height);
    } else if (
      typeof ImageBitmap !== 'undefined' &&
      value instanceof ImageBitmap
    ) {
      context.drawImage(value, 0, 0, width, height);
    } else if (
      typeof HTMLCanvasElement !== 'undefined' &&
      value instanceof HTMLCanvasElement
    ) {
      context.drawImage(value, 0, 0, width, height);
    } else {
      toImageData(source, context, width, height);
    }

    return { blob: await canvasToPng(canvas), width, height };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function resolvePdfImageObject(
  page: { objs: unknown; commonObjs: unknown },
  objectId: string
): Promise<unknown> {
  const pageStore = page.objs as PdfJsObjectStore;
  const commonStore = page.commonObjs as PdfJsObjectStore;
  const useCommonStore = objectId.startsWith('g_d') || commonStore.has(objectId);
  const store = useCommonStore ? commonStore : pageStore;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('The PDF image object did not become available in time.'));
    }, MAX_IMAGE_OBJECT_WAIT_MS);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      callback();
    };

    try {
      store.get(
        objectId,
        (image) => finish(() => resolve(image)),
        (reason) => finish(() => reject(reason))
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

/**
 * Extract decoded image resources from PDF.js image-paint operators.
 * This extracts image objects, not page screenshots; images are exported as
 * PNG because PDF.js exposes decoded pixels for these operators.
 */
export async function extractEmbeddedImages(
  source: File | Blob,
  onProgress?: (progress: EmbeddedImageProgress) => void
): Promise<EmbeddedImageExtractionResult> {
  if (source.size === 0) throw new Error('Choose a non-empty PDF file.');
  if (source.size > MAX_EMBEDDED_IMAGE_FILE_BYTES) {
    throw new Error('This PDF is larger than the 150 MB extraction limit.');
  }

  const pdfjs = await import('pdfjs-dist');
  const loadingTask = await createPdfDocumentTask(source);
  const images: ExtractedPdfImage[] = [];
  const seenObjectIds = new Set<string>();
  const documentName = safeEmbeddedImageBaseName(
    'name' in source && typeof source.name === 'string' ? source.name : 'document.pdf'
  );
  let pageCount = 0;
  let skippedImages = 0;
  let totalImagePixels = 0;

  try {
    const pdf = await loadingTask.promise;
    pageCount = pdf.numPages;
    if (pageCount < 1) throw new Error('The PDF does not contain any pages.');

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      let pageImageIndex = 0;
      try {
        const operatorList = await page.getOperatorList();
        for (let index = 0; index < operatorList.fnArray.length; index += 1) {
          const operation = operatorList.fnArray[index];
          const args = operatorList.argsArray[index] as unknown[] | undefined;
          let sourceObject: unknown;
          let sourceType: ExtractedPdfImage['source'];
          let objectId: string | null = null;

          if (
            operation === pdfjs.OPS.paintInlineImageXObject ||
            operation === pdfjs.OPS.paintInlineImageXObjectGroup
          ) {
            sourceObject = args?.[0];
            sourceType = 'inline-image';
          } else if (
            operation === pdfjs.OPS.paintImageXObject ||
            operation === pdfjs.OPS.paintImageXObjectRepeat
          ) {
            objectId = typeof args?.[0] === 'string' ? args[0] : null;
            if (!objectId) {
              skippedImages += 1;
              continue;
            }
            if (seenObjectIds.has(objectId)) continue;
            seenObjectIds.add(objectId);
            sourceType = 'image-object';
            try {
              sourceObject = await resolvePdfImageObject(page, objectId);
            } catch {
              skippedImages += 1;
              continue;
            }
          } else {
            const isImageMaskOperation =
              operation === pdfjs.OPS.paintImageMaskXObject ||
              operation === pdfjs.OPS.paintImageMaskXObjectRepeat ||
              operation === pdfjs.OPS.paintImageMaskXObjectGroup;
            if (isImageMaskOperation) skippedImages += 1;
            continue;
          }

          if (images.length >= MAX_EMBEDDED_IMAGE_COUNT) {
            skippedImages += 1;
            continue;
          }

          try {
            const extracted = await imageObjectToPng(sourceObject);
            const pixelCount = extracted.width * extracted.height;
            if (totalImagePixels + pixelCount > MAX_TOTAL_IMAGE_PIXELS) {
              skippedImages += 1;
              continue;
            }
            totalImagePixels += pixelCount;
            pageImageIndex += 1;
            const imageNumber = images.length + 1;
            const paddedImage = String(imageNumber).padStart(3, '0');
            const paddedPage = String(pageNumber).padStart(String(pageCount).length, '0');
            images.push({
              fileName: documentName + '-image-' + paddedImage + '-page-' + paddedPage + '.png',
              pageNumber,
              imageNumber,
              width: extracted.width,
              height: extracted.height,
              source: sourceType,
              blob: extracted.blob
            });
          } catch {
            skippedImages += 1;
          }
        }
      } finally {
        page.cleanup();
      }

      onProgress?.({
        completedPages: pageNumber,
        totalPages: pageCount,
        foundImages: images.length,
        skippedImages,
        pageNumber
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error('The PDF could not be inspected. It may be damaged or password-protected.');
  } finally {
    await loadingTask.destroy();
  }

  return { images, pageCount, skippedImages };
}

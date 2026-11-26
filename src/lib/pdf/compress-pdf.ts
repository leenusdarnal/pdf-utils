import { PDFDocument } from 'pdf-lib';
import type { PDFPageProxy } from 'pdfjs-dist';
import { createPdfDocumentTask } from './pdfjs-client';

export type CompressionPreset = 'screen' | 'balanced' | 'print';

export interface CompressionSettings {
  dpi: number;
  quality: number;
}

export interface CompressionProgress {
  completed: number;
  total: number;
  attempt: number;
  maxAttempts: number;
  dpi: number;
}

export interface PdfCompressionResult {
  bytes: Uint8Array;
  originalSizeBytes: number;
  outputSizeBytes: number;
  pageCount: number;
  settings: CompressionSettings;
  attempts: number;
  previewBlob: Blob;
  targetSizeBytes: number | null;
  targetReached: boolean | null;
}

export interface CompressionPresetInfo {
  label: string;
  description: string;
  dpi: number;
  quality: number;
}

export const COMPRESSION_PRESETS: Record<CompressionPreset, CompressionPresetInfo> = {
  screen: {
    label: 'Screen',
    description: 'Smaller files for on-screen reading and sharing.',
    dpi: 96,
    quality: 0.64
  },
  balanced: {
    label: 'Balanced',
    description: 'A practical balance of readability and file size.',
    dpi: 144,
    quality: 0.78
  },
  print: {
    label: 'Print',
    description: 'Higher resolution for clearer printed pages.',
    dpi: 216,
    quality: 0.88
  }
};

export const MAX_COMPRESS_INPUT_BYTES = 150 * 1024 * 1024;
export const MAX_COMPRESS_PAGE_COUNT = 500;
const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_PIXELS = 80_000_000;

function validateTargetSize(targetSizeBytes: number | undefined): number | null {
  if (targetSizeBytes === undefined) return null;
  if (
    !Number.isFinite(targetSizeBytes) ||
    targetSizeBytes < 100 * 1024 ||
    targetSizeBytes > 500 * 1024 * 1024
  ) {
    throw new Error('Choose a target size between 0.1 MB and 500 MB.');
  }
  return Math.round(targetSizeBytes);
}

function getSafeScale(width: number, height: number, dpi: number): number {
  const requestedScale = dpi / 72;
  const sideScale = Math.min(MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height);
  const pixelScale = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  const scale = Math.min(requestedScale, sideScale, pixelScale);

  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('A page in this PDF has dimensions that cannot be rendered safely.');
  }
  return scale;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not encode the compressed page image.'));
      },
      'image/jpeg',
      Math.min(0.95, Math.max(0.35, quality))
    );
  });
}

async function renderPageToJpeg(
  page: PDFPageProxy,
  settings: CompressionSettings
): Promise<{ blob: Blob; width: number; height: number }> {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = getSafeScale(baseViewport.width, baseViewport.height, settings.dpi);
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  try {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas rendering is not available in this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    await page.render({ canvas, viewport }).promise;
    const blob = await canvasToJpeg(canvas, settings.quality);
    return {
      blob,
      width: baseViewport.width,
      height: baseViewport.height
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }
}

export function getCompressionAttempts(
  preset: CompressionPreset,
  targetSizeBytes?: number
): CompressionSettings[] {
  const target = validateTargetSize(targetSizeBytes);
  return createCompressionAttempts(COMPRESSION_PRESETS[preset], target !== null);
}

function createCompressionAttempts(initial: CompressionSettings, hasTarget: boolean): CompressionSettings[] {
  if (!hasTarget) return [initial];
  const attempts: CompressionSettings[] = [initial];
  for (let index = 1; index <= 5; index += 1) {
    const previous = attempts[index - 1];
    const next: CompressionSettings = {
      dpi: Math.max(60, Math.round(previous.dpi * 0.84)),
      quality: Math.max(0.4, Number((previous.quality - 0.075).toFixed(3)))
    };
    if (
      next.dpi === previous.dpi &&
      next.quality === previous.quality
    ) break;
    attempts.push(next);
  }
  return attempts;
}

/**
 * Render a reduced first-page JPEG for a quality preview.
 * Rendering is local and does not modify the source PDF.
 */
export async function previewPdfCompression(
  source: Blob,
  preset: CompressionPreset
): Promise<Blob> {
  if (source.size === 0) throw new Error('Choose a non-empty PDF file.');
  if (source.size > MAX_COMPRESS_INPUT_BYTES) {
    throw new Error('This PDF is larger than the 150 MB processing limit.');
  }

  const loadingTask = await createPdfDocumentTask(source);
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1) throw new Error('The PDF does not contain any pages.');
    if (pdf.numPages > MAX_COMPRESS_PAGE_COUNT) {
      throw new Error('This PDF contains more than ' + MAX_COMPRESS_PAGE_COUNT + ' pages.');
    }
    const page = await pdf.getPage(1);
    const rendered = await renderPageToJpeg(page, COMPRESSION_PRESETS[preset]);
    return rendered.blob;
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error('The PDF could not be previewed. It may be damaged or password-protected.');
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Create a new image-based PDF copy with sequential, bounded canvas rendering.
 * This is intentionally lossy: text, links, forms, signatures, and vector content
 * become page pixels. The input file is never modified or uploaded.
 */
export async function compressPdf(
  source: File | Blob,
  preset: CompressionPreset,
  targetSizeBytes?: number,
  onProgress?: (progress: CompressionProgress) => void
): Promise<PdfCompressionResult> {
  if (source.size === 0) throw new Error('Choose a non-empty PDF file.');
  if (source.size > MAX_COMPRESS_INPUT_BYTES) {
    throw new Error('This PDF is larger than the 150 MB processing limit.');
  }
  const target = validateTargetSize(targetSizeBytes);
  const initialSettings = COMPRESSION_PRESETS[preset];
  const candidateSettings = getCompressionAttempts(preset, targetSizeBytes);
  let bestBytes: Uint8Array | null = null;
  let bestPreviewBlob: Blob | null = null;
  let bestSettings: CompressionSettings = initialSettings;
  let pageCount = 0;
  let attempts = 0;

  for (let index = 0; index < candidateSettings.length; index += 1) {
    const settings = candidateSettings[index];
    const loadingTask = await createPdfDocumentTask(source);
    let bytes: Uint8Array;
    let attemptPreviewBlob: Blob | null = null;
    try {
      const pdf = await loadingTask.promise;
      pageCount = pdf.numPages;
      if (pageCount < 1) throw new Error('The PDF does not contain any pages.');
      if (pageCount > MAX_COMPRESS_PAGE_COUNT) {
        throw new Error('This PDF contains more than ' + MAX_COMPRESS_PAGE_COUNT + ' pages.');
      }

      const output = await PDFDocument.create();
      output.setTitle('Compressed PDF copy');
      output.setProducer('PDF Utils');
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex + 1);
        const rendered = await renderPageToJpeg(page, settings);
        if (pageIndex === 0) attemptPreviewBlob = rendered.blob;
        const image = await output.embedJpg(new Uint8Array(await rendered.blob.arrayBuffer()));
        const outputPage = output.addPage([rendered.width, rendered.height]);
        outputPage.drawImage(image, {
          x: 0,
          y: 0,
          width: rendered.width,
          height: rendered.height
        });
        onProgress?.({
          completed: pageIndex + 1,
          total: pageCount,
          attempt: index + 1,
          maxAttempts: candidateSettings.length,
          dpi: settings.dpi
        });
      }
      bytes = await output.save();
    } catch (error) {
      if (error instanceof Error && error.message) throw error;
      throw new Error('The PDF could not be compressed. It may be damaged or password-protected.');
    } finally {
      await loadingTask.destroy();
    }

    attempts = index + 1;
    if (bestBytes === null || bytes.length < bestBytes.length) {
      bestBytes = bytes;
      bestPreviewBlob = attemptPreviewBlob;
      bestSettings = settings;
    }

    if (target !== null && bytes.length <= target) {
      bestBytes = bytes;
      bestPreviewBlob = attemptPreviewBlob;
      bestSettings = settings;
      break;
    }
  }

  if (!bestBytes || !bestPreviewBlob) throw new Error('The compressed PDF could not be created.');
  return {
    bytes: bestBytes,
    originalSizeBytes: source.size,
    outputSizeBytes: bestBytes.length,
    pageCount,
    settings: bestSettings,
    attempts,
    previewBlob: bestPreviewBlob,
    targetSizeBytes: target,
    targetReached: target === null ? null : bestBytes.length <= target
  };
}

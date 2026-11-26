import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFPage, PDFFont } from 'pdf-lib';
import {
  assertValidAnnotation,
  type NormalizedPoint,
  type PdfAnnotation
} from '$lib/annotations/annotations';

export const MAX_ANNOTATION_EXPORT_INPUT_BYTES = 150 * 1024 * 1024;
export const MAX_ANNOTATION_EXPORT_PAGES = 500;
export const MAX_ANNOTATIONS_PER_EXPORT = 5_000;
export const MAX_ANNOTATION_POINTS_PER_EXPORT = 500_000;
export const MAX_NOTE_TEXT_LENGTH = 10_000;

interface PageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function parseColor(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function toPdfPoint(point: NormalizedPoint, bounds: PageBounds) {
  return {
    x: bounds.x + point.x * bounds.width,
    y: bounds.y + (1 - point.y) * bounds.height
  };
}

function getStrokeWidth(fraction: number, bounds: PageBounds): number {
  return Math.max(0.5, fraction * Math.min(bounds.width, bounds.height));
}

function safeFontText(value: string, font: PDFFont): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      Array.from(line, (character) => {
        try {
          font.encodeText(character);
          return character;
        } catch {
          return '?';
        }
      }).join('')
    )
    .join('\n');
}

function wrapText(value: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const output: string[] = [];
  const paragraphs = value.replace(/\r\n?/g, '\n').split('\n');

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      output.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) {
        output.push(line);
        line = '';
      }

      let chunk = '';
      for (const character of Array.from(word)) {
        const next = chunk + character;
        if (chunk && font.widthOfTextAtSize(next, fontSize) > maxWidth) {
          output.push(chunk);
          chunk = character;
        } else {
          chunk = next;
        }
      }
      line = chunk;
    }
    if (line) output.push(line);
  }

  return output.length ? output : [''];
}

function drawHighlight(page: PDFPage, annotation: Extract<PdfAnnotation, { type: 'highlight' }>, bounds: PageBounds) {
  const color = parseColor(annotation.color);
  for (const rect of annotation.rects) {
    page.drawRectangle({
      x: bounds.x + rect.x * bounds.width,
      y: bounds.y + (1 - rect.y - rect.height) * bounds.height,
      width: rect.width * bounds.width,
      height: rect.height * bounds.height,
      color,
      opacity: annotation.opacity
    });
  }
}

function drawFreehand(page: PDFPage, annotation: Extract<PdfAnnotation, { type: 'freehand' }>, bounds: PageBounds) {
  const color = parseColor(annotation.color);
  const points = annotation.points.map((point) => toPdfPoint(point, bounds));
  const thickness = getStrokeWidth(annotation.strokeWidth, bounds);

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    page.drawLine({ start, end, color, thickness, opacity: annotation.opacity });
  }

  // Small circles smooth joins and line ends without rasterizing the page.
  for (const point of points) {
    page.drawCircle({
      x: point.x,
      y: point.y,
      size: thickness,
      color,
      opacity: annotation.opacity
    });
  }
}

function drawRectangle(page: PDFPage, annotation: Extract<PdfAnnotation, { type: 'rectangle' }>, bounds: PageBounds) {
  const color = parseColor(annotation.color);
  page.drawRectangle({
    x: bounds.x + annotation.rect.x * bounds.width,
    y: bounds.y + (1 - annotation.rect.y - annotation.rect.height) * bounds.height,
    width: annotation.rect.width * bounds.width,
    height: annotation.rect.height * bounds.height,
    color,
    opacity: annotation.fillOpacity,
    borderColor: color,
    borderOpacity: annotation.opacity,
    borderWidth: getStrokeWidth(annotation.strokeWidth, bounds)
  });
}

function drawArrow(page: PDFPage, annotation: Extract<PdfAnnotation, { type: 'arrow' }>, bounds: PageBounds) {
  const color = parseColor(annotation.color);
  const start = toPdfPoint(annotation.start, bounds);
  const end = toPdfPoint(annotation.end, bounds);
  const thickness = getStrokeWidth(annotation.strokeWidth, bounds);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  page.drawLine({ start, end, color, thickness, opacity: annotation.opacity });
  if (length < 0.01) return;

  const ux = dx / length;
  const uy = dy / length;
  const headLength = Math.min(12, Math.max(5, thickness * 3));
  const halfWidth = headLength * 0.45;
  const baseX = end.x - ux * headLength;
  const baseY = end.y - uy * headLength;
  const left = { x: baseX - uy * halfWidth, y: baseY + ux * halfWidth };
  const right = { x: baseX + uy * halfWidth, y: baseY - ux * halfWidth };
  page.drawLine({ start: end, end: left, color, thickness, opacity: annotation.opacity });
  page.drawLine({ start: end, end: right, color, thickness, opacity: annotation.opacity });
}

function drawTextNote(page: PDFPage, annotation: Extract<PdfAnnotation, { type: 'text-note' }>, bounds: PageBounds, font: PDFFont) {
  const text = annotation.text.trim();
  if (!text) return;

  const fontSize = 9;
  const lineHeight = 12;
  const padding = 6;
  const maximumWidth = Math.min(220, Math.max(24, bounds.width - 16));
  const maximumLines = Math.max(1, Math.floor((bounds.height - 32) / lineHeight));
  const normalizedText = safeFontText(text, font);
  const lines = wrapText(normalizedText, font, fontSize, maximumWidth - padding * 2);
  const visibleLines = lines.slice(0, maximumLines);
  if (lines.length > maximumLines && visibleLines.length) {
    const last = visibleLines.length - 1;
    visibleLines[last] = visibleLines[last].replace(/\s+$/, '') + '...';
  }

  const boxWidth = maximumWidth;
  const boxHeight = visibleLines.length * lineHeight + padding * 2;
  const anchor = toPdfPoint(annotation.anchor, bounds);
  const minimumX = bounds.x + 8;
  const maximumX = bounds.x + bounds.width - boxWidth - 8;
  const boxX = Math.max(minimumX, Math.min(maximumX, anchor.x + 11));
  const minimumY = bounds.y + 8;
  const maximumY = bounds.y + bounds.height - boxHeight - 8;
  const boxY = Math.max(minimumY, Math.min(maximumY, anchor.y - boxHeight - 10));
  const color = parseColor(annotation.color);

  page.drawCircle({
    x: anchor.x,
    y: anchor.y,
    size: 14,
    color,
    opacity: annotation.opacity,
    borderColor: rgb(1, 1, 1),
    borderWidth: 1
  });
  page.drawText('N', {
    x: anchor.x - font.widthOfTextAtSize('N', 7) / 2,
    y: anchor.y - 2.5,
    size: 7,
    font,
    color: rgb(1, 1, 1)
  });

  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
    color: rgb(1, 0.99, 0.88),
    opacity: 0.97,
    borderColor: color,
    borderOpacity: annotation.opacity,
    borderWidth: 0.75
  });

  let textY = boxY + boxHeight - padding - fontSize;
  for (const line of visibleLines) {
    page.drawText(line, {
      x: boxX + padding,
      y: textY,
      size: fontSize,
      font,
      color: rgb(0.16, 0.18, 0.23),
      opacity: annotation.opacity
    });
    textY -= lineHeight;
  }
}

function validateExport(annotations: readonly PdfAnnotation[]): void {
  if (annotations.length === 0) throw new Error('Add at least one annotation before exporting.');
  if (annotations.length > MAX_ANNOTATIONS_PER_EXPORT) {
    throw new Error('This document contains too many annotations to export safely.');
  }

  let pointCount = 0;
  for (const annotation of annotations) {
    assertValidAnnotation(annotation);
    if (annotation.type === 'text-note' && annotation.text.length > MAX_NOTE_TEXT_LENGTH) {
      throw new Error('A text note is too long to export. Shorten it and try again.');
    }
    if (annotation.type === 'freehand') pointCount += annotation.points.length;
    else if (annotation.type === 'highlight') pointCount += annotation.rects.length * 4;
    else if (annotation.type === 'arrow') pointCount += 2;
    else if (annotation.type === 'rectangle') pointCount += 4;

    if (pointCount > MAX_ANNOTATION_POINTS_PER_EXPORT) {
      throw new Error('The annotations contain too much drawing data to export safely.');
    }
  }
}

/**
 * Add vector/text annotation overlays to a fresh copy of the source PDF.
 * Page content is not rasterized and the input Blob is never changed.
 *
 * Coordinates use the PDF crop box so annotations remain aligned with the
 * visible, unrotated page bounds used by the viewer, including pages whose
 * crop box has a non-zero origin or whose display rotation is set.
 */
export async function exportAnnotatedPdf(
  source: Blob,
  annotations: readonly PdfAnnotation[]
): Promise<Uint8Array> {
  if (source.size === 0) throw new Error('Choose a non-empty PDF file.');
  if (source.size > MAX_ANNOTATION_EXPORT_INPUT_BYTES) {
    throw new Error('This PDF is larger than the 150 MB annotation export limit.');
  }
  validateExport(annotations);

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(new Uint8Array(await source.arrayBuffer()));
  } catch {
    throw new Error('This PDF could not be opened for annotation export. It may be damaged, encrypted, or unsupported.');
  }

  const pages = document.getPages();
  if (pages.length < 1) throw new Error('The PDF does not contain any pages.');
  if (pages.length > MAX_ANNOTATION_EXPORT_PAGES) {
    throw new Error('This PDF contains more than 500 pages and cannot be exported safely.');
  }

  const font = await document.embedFont(StandardFonts.Helvetica);
  const annotationsByPage = new Map<number, PdfAnnotation[]>();
  for (const annotation of annotations) {
    if (annotation.pageNumber > pages.length) {
      throw new Error('An annotation refers to a page that does not exist in this PDF.');
    }
    const items = annotationsByPage.get(annotation.pageNumber) ?? [];
    items.push(annotation);
    annotationsByPage.set(annotation.pageNumber, items);
  }

  for (const [pageNumber, pageAnnotations] of annotationsByPage) {
    const page = pages[pageNumber - 1];
    const bounds = page.getCropBox();
    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error('Page ' + pageNumber + ' has invalid visible dimensions.');
    }

    for (const annotation of pageAnnotations) {
      switch (annotation.type) {
        case 'highlight':
          drawHighlight(page, annotation, bounds);
          break;
        case 'text-note':
          drawTextNote(page, annotation, bounds, font);
          break;
        case 'freehand':
          drawFreehand(page, annotation, bounds);
          break;
        case 'rectangle':
          drawRectangle(page, annotation, bounds);
          break;
        case 'arrow':
          drawArrow(page, annotation, bounds);
          break;
      }
    }
  }

  try {
    return await document.save();
  } catch {
    throw new Error('The annotated PDF could not be written. Try a smaller document.');
  }
}

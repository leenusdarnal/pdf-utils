/**
 * Typed, page-relative annotation data and bounded undo/redo history.
 *
 * Geometry uses normalized coordinates (0..1) measured from the top-left
 * corner of the unrotated page's visible bounds. x grows right and y grows
 * down. Rendering code is responsible for applying PDF.js viewport transforms
 * for page rotation, zoom, and device pixel ratio.
 */

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfAnnotationBase {
  id: string;
  pageNumber: number;
  createdAt: number;
  updatedAt: number;
  /** Six-digit CSS hex color (for example, #f5c542). */
  color: string;
  /** Overall annotation opacity, from 0 (transparent) to 1 (opaque). */
  opacity: number;
}

export interface PdfHighlightAnnotation extends PdfAnnotationBase {
  type: 'highlight';
  /** Text selections can span lines, so a highlight may contain multiple rectangles. */
  rects: NormalizedRect[];
}

export interface PdfTextNoteAnnotation extends PdfAnnotationBase {
  type: 'text-note';
  anchor: NormalizedPoint;
  text: string;
}

export interface PdfFreehandAnnotation extends PdfAnnotationBase {
  type: 'freehand';
  points: NormalizedPoint[];
  /** Stroke width as a fraction of the page's shorter side. */
  strokeWidth: number;
}

export interface PdfRectangleAnnotation extends PdfAnnotationBase {
  type: 'rectangle';
  rect: NormalizedRect;
  strokeWidth: number;
  fillOpacity: number;
}

export interface PdfArrowAnnotation extends PdfAnnotationBase {
  type: 'arrow';
  start: NormalizedPoint;
  end: NormalizedPoint;
  strokeWidth: number;
}

export type PdfAnnotation =
  | PdfHighlightAnnotation
  | PdfTextNoteAnnotation
  | PdfFreehandAnnotation
  | PdfRectangleAnnotation
  | PdfArrowAnnotation;

export const DEFAULT_ANNOTATION_HISTORY_LIMIT = 100;
export const MAX_FREEHAND_POINTS = 10_000;

const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertFiniteRange(value: unknown, name: string, min: number, max: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number between ${min} and ${max}`);
  }
}

function assertPoint(value: unknown, name: string): asserts value is NormalizedPoint {
  if (!isRecord(value)) throw new Error(`${name} must be a point`);
  assertFiniteRange(value.x, `${name}.x`, 0, 1);
  assertFiniteRange(value.y, `${name}.y`, 0, 1);
}

function assertRect(value: unknown, name: string): asserts value is NormalizedRect {
  if (!isRecord(value)) throw new Error(`${name} must be a rectangle`);

  assertFiniteRange(value.x, `${name}.x`, 0, 1);
  assertFiniteRange(value.y, `${name}.y`, 0, 1);

  if (typeof value.width !== 'number' || !Number.isFinite(value.width) || value.width <= 0) {
    throw new Error(`${name}.width must be a positive finite number`);
  }
  if (typeof value.height !== 'number' || !Number.isFinite(value.height) || value.height <= 0) {
    throw new Error(`${name}.height must be a positive finite number`);
  }
  if (value.x + value.width > 1 || value.y + value.height > 1) {
    throw new Error(`${name} must stay within the page bounds`);
  }
}

function assertBase(value: Record<string, unknown>): void {
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    throw new Error('Annotation id must be a non-empty string');
  }
  if (
    typeof value.pageNumber !== 'number' ||
    !Number.isInteger(value.pageNumber) ||
    value.pageNumber < 1
  ) {
    throw new Error('Annotation pageNumber must be a positive integer');
  }
  if (
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0
  ) {
    throw new Error('Annotation createdAt must be a non-negative finite timestamp');
  }
  if (
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < value.createdAt
  ) {
    throw new Error('Annotation updatedAt must be finite and no earlier than createdAt');
  }
  if (typeof value.color !== 'string' || !HEX_COLOR_PATTERN.test(value.color)) {
    throw new Error('Annotation color must be a six-digit CSS hex color');
  }
  assertFiniteRange(value.opacity, 'Annotation opacity', 0, 1);
}

function assertStrokeWidth(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error('Annotation strokeWidth must be greater than 0 and no more than 1');
  }
}

/**
 * Validates the runtime shape of an annotation, including imported or persisted
 * data. Throws a descriptive error when the value is invalid.
 */
export function assertValidAnnotation(value: unknown): asserts value is PdfAnnotation {
  if (!isRecord(value)) throw new Error('Annotation must be an object');
  assertBase(value);

  switch (value.type) {
    case 'highlight': {
      if (!Array.isArray(value.rects) || value.rects.length === 0) {
        throw new Error('A highlight must contain at least one rectangle');
      }
      value.rects.forEach((rect, index) => assertRect(rect, `highlight.rects[${index}]`));
      return;
    }
    case 'text-note':
      assertPoint(value.anchor, 'text-note.anchor');
      if (typeof value.text !== 'string') {
        throw new Error('Text note content must be a string');
      }
      return;
    case 'freehand':
      if (
        !Array.isArray(value.points) ||
        value.points.length < 2 ||
        value.points.length > MAX_FREEHAND_POINTS
      ) {
        throw new Error(`A freehand annotation must contain 2 to ${MAX_FREEHAND_POINTS} points`);
      }
      value.points.forEach((point, index) => assertPoint(point, `freehand.points[${index}]`));
      assertStrokeWidth(value.strokeWidth);
      return;
    case 'rectangle':
      assertRect(value.rect, 'rectangle.rect');
      assertStrokeWidth(value.strokeWidth);
      assertFiniteRange(value.fillOpacity, 'rectangle.fillOpacity', 0, 1);
      return;
    case 'arrow':
      assertPoint(value.start, 'arrow.start');
      assertPoint(value.end, 'arrow.end');
      assertStrokeWidth(value.strokeWidth);
      return;
    default:
      throw new Error('Unsupported annotation type');
  }
}

export function isPdfAnnotation(value: unknown): value is PdfAnnotation {
  try {
    assertValidAnnotation(value);
    return true;
  } catch {
    return false;
  }
}

function cloneAnnotation(annotation: PdfAnnotation): PdfAnnotation {
  switch (annotation.type) {
    case 'highlight':
      return { ...annotation, rects: annotation.rects.map((rect) => ({ ...rect })) };
    case 'text-note':
      return { ...annotation, anchor: { ...annotation.anchor } };
    case 'freehand':
      return { ...annotation, points: annotation.points.map((point) => ({ ...point })) };
    case 'rectangle':
      return { ...annotation, rect: { ...annotation.rect } };
    case 'arrow':
      return {
        ...annotation,
        start: { ...annotation.start },
        end: { ...annotation.end }
      };
  }
}

function cloneAnnotations(annotations: readonly PdfAnnotation[]): PdfAnnotation[] {
  return annotations.map(cloneAnnotation);
}

function assertUniqueIds(annotations: readonly PdfAnnotation[]): void {
  const ids = new Set<string>();
  for (const annotation of annotations) {
    assertValidAnnotation(annotation);
    if (ids.has(annotation.id)) throw new Error(`Duplicate annotation id: ${annotation.id}`);
    ids.add(annotation.id);
  }
}

/**
 * In-memory history for annotation edits. Each committed change is an
 * immutable snapshot; values returned to callers are defensive copies.
 * History is bounded to avoid retaining an unbounded number of document edits.
 */
export class AnnotationHistory {
  private past: PdfAnnotation[][] = [];
  private future: PdfAnnotation[][] = [];
  private current: PdfAnnotation[];
  private readonly historyLimit: number;

  constructor(
    initialAnnotations: readonly PdfAnnotation[] = [],
    historyLimit = DEFAULT_ANNOTATION_HISTORY_LIMIT
  ) {
    if (!Number.isInteger(historyLimit) || historyLimit < 1) {
      throw new Error('History limit must be a positive integer');
    }
    assertUniqueIds(initialAnnotations);
    this.current = cloneAnnotations(initialAnnotations);
    this.historyLimit = historyLimit;
  }

  get annotations(): readonly PdfAnnotation[] {
    return cloneAnnotations(this.current);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  add(annotation: PdfAnnotation): void {
    assertValidAnnotation(annotation);
    if (this.current.some((item) => item.id === annotation.id)) {
      throw new Error(`Duplicate annotation id: ${annotation.id}`);
    }
    this.commit([...this.current, cloneAnnotation(annotation)]);
  }

  update(annotation: PdfAnnotation): void {
    assertValidAnnotation(annotation);
    const index = this.current.findIndex((item) => item.id === annotation.id);
    if (index === -1) throw new Error(`Annotation not found: ${annotation.id}`);

    const next = cloneAnnotations(this.current);
    next[index] = cloneAnnotation(annotation);
    this.commit(next);
  }

  remove(id: string): boolean {
    const next = this.current.filter((annotation) => annotation.id !== id);
    if (next.length === this.current.length) return false;
    this.commit(next);
    return true;
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;

    this.future.unshift(cloneAnnotations(this.current));
    this.current = previous;
    return true;
  }

  redo(): boolean {
    const next = this.future.shift();
    if (!next) return false;

    this.pushPast(this.current);
    this.current = next;
    return true;
  }

  private commit(next: PdfAnnotation[]): void {
    assertUniqueIds(next);
    this.pushPast(this.current);
    this.current = cloneAnnotations(next);
    this.future = [];
  }

  private pushPast(snapshot: readonly PdfAnnotation[]): void {
    this.past.push(cloneAnnotations(snapshot));
    if (this.past.length > this.historyLimit) this.past.shift();
  }
}

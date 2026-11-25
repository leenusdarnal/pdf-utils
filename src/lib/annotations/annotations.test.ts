import { describe, expect, it } from 'vitest';
import {
  AnnotationHistory,
  assertValidAnnotation,
  isPdfAnnotation,
  type PdfAnnotation,
  type PdfTextNoteAnnotation
} from './annotations';

function createNote(overrides: Partial<PdfTextNoteAnnotation> = {}): PdfTextNoteAnnotation {
  return {
    type: 'text-note',
    id: 'note-1',
    pageNumber: 1,
    createdAt: 100,
    updatedAt: 100,
    color: '#f5c542',
    opacity: 1,
    anchor: { x: 0.25, y: 0.4 },
    text: 'Review this paragraph',
    ...overrides
  };
}

function createHighlight(): PdfAnnotation {
  return {
    type: 'highlight',
    id: 'highlight-1',
    pageNumber: 2,
    createdAt: 100,
    updatedAt: 100,
    color: '#f5c542',
    opacity: 0.35,
    rects: [
      { x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
      { x: 0.1, y: 0.25, width: 0.22, height: 0.04 }
    ]
  };
}

describe('annotation schema', () => {
  it('accepts all supported annotation shapes with normalized page geometry', () => {
    const annotations: PdfAnnotation[] = [
      createHighlight(),
      createNote(),
      {
        type: 'freehand',
        id: 'freehand-1',
        pageNumber: 1,
        createdAt: 100,
        updatedAt: 100,
        color: '#2463eb',
        opacity: 0.9,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.4 },
          { x: 0.9, y: 0.8 }
        ],
        strokeWidth: 0.004
      },
      {
        type: 'rectangle',
        id: 'rectangle-1',
        pageNumber: 3,
        createdAt: 100,
        updatedAt: 110,
        color: '#d94841',
        opacity: 1,
        rect: { x: 0.2, y: 0.2, width: 0.5, height: 0.3 },
        strokeWidth: 0.003,
        fillOpacity: 0.08
      },
      {
        type: 'arrow',
        id: 'arrow-1',
        pageNumber: 4,
        createdAt: 100,
        updatedAt: 100,
        color: '#2463eb',
        opacity: 1,
        start: { x: 0.1, y: 0.8 },
        end: { x: 0.8, y: 0.2 },
        strokeWidth: 0.004
      }
    ];

    for (const annotation of annotations) {
      expect(() => assertValidAnnotation(annotation)).not.toThrow();
      expect(isPdfAnnotation(annotation)).toBe(true);
    }
  });

  it('rejects geometry that falls outside the normalized page bounds', () => {
    expect(isPdfAnnotation(createNote({ anchor: { x: 1.01, y: 0.5 } }))).toBe(false);
    expect(() =>
      assertValidAnnotation({
        ...createHighlight(),
        rects: [{ x: 0.8, y: 0.2, width: 0.3, height: 0.1 }]
      })
    ).toThrow(/stay within the page bounds/);
  });

  it('rejects invalid page numbers, timestamps, colors, and empty IDs', () => {
    expect(isPdfAnnotation(createNote({ pageNumber: 0 }))).toBe(false);
    expect(isPdfAnnotation(createNote({ updatedAt: 99 }))).toBe(false);
    expect(isPdfAnnotation(createNote({ color: 'red' }))).toBe(false);
    expect(isPdfAnnotation(createNote({ id: '  ' }))).toBe(false);
  });

  it('requires enough points to describe freehand strokes', () => {
    const freehand: PdfAnnotation = {
      type: 'freehand',
      id: 'freehand-invalid',
      pageNumber: 1,
      createdAt: 100,
      updatedAt: 100,
      color: '#2463eb',
      opacity: 1,
      points: [{ x: 0.1, y: 0.1 }],
      strokeWidth: 0.004
    };

    expect(isPdfAnnotation(freehand)).toBe(false);
  });
});

describe('AnnotationHistory', () => {
  it('adds, updates, removes, and restores annotations through undo and redo', () => {
    const history = new AnnotationHistory();
    const initialNote = createNote();

    history.add(initialNote);
    expect(history.annotations).toEqual([initialNote]);
    expect(history.canUndo).toBe(true);

    const updatedNote = createNote({ text: 'Updated note', updatedAt: 120 });
    history.update(updatedNote);
    expect(history.annotations[0]).toMatchObject({ text: 'Updated note' });

    expect(history.remove(initialNote.id)).toBe(true);
    expect(history.annotations).toEqual([]);

    expect(history.undo()).toBe(true);
    expect(history.annotations[0]).toMatchObject({ text: 'Updated note' });

    expect(history.undo()).toBe(true);
    expect(history.annotations).toEqual([initialNote]);

    expect(history.undo()).toBe(true);
    expect(history.annotations).toEqual([]);

    expect(history.undo()).toBe(false);
    expect(history.canUndo).toBe(false);

    expect(history.redo()).toBe(true);
    expect(history.annotations).toEqual([initialNote]);
    expect(history.canRedo).toBe(true);
  });

  it('clears the redo branch after a new edit', () => {
    const history = new AnnotationHistory([createNote()]);
    history.update(createNote({ text: 'Second version', updatedAt: 110 }));
    expect(history.undo()).toBe(true);
    expect(history.canRedo).toBe(true);

    history.add(createHighlight());
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBe(false);
    expect(history.annotations.map((annotation) => annotation.id)).toEqual([
      'note-1',
      'highlight-1'
    ]);
  });

  it('returns defensive copies so callers cannot mutate stored history', () => {
    const history = new AnnotationHistory([createNote()]);
    const snapshot = history.annotations as PdfAnnotation[];
    const note = snapshot[0] as PdfTextNoteAnnotation;
    note.text = 'Mutated outside history';
    note.anchor.x = 0.99;

    expect(history.annotations[0]).toMatchObject({
      text: 'Review this paragraph',
      anchor: { x: 0.25, y: 0.4 }
    });
  });

  it('rejects duplicate IDs and updates for unknown annotations', () => {
    const history = new AnnotationHistory([createNote()]);
    expect(() => history.add(createNote())).toThrow(/Duplicate annotation id/);
    expect(() => history.update(createNote({ id: 'missing' }))).toThrow(/not found/);
    expect(history.remove('missing')).toBe(false);
  });

  it('bounds the undo stack to the configured history limit', () => {
    const history = new AnnotationHistory([], 2);
    history.add(createNote({ text: 'Version 1' }));
    history.update(createNote({ text: 'Version 2', updatedAt: 110 }));
    history.update(createNote({ text: 'Version 3', updatedAt: 120 }));

    expect(history.undo()).toBe(true);
    expect(history.annotations[0]).toMatchObject({ text: 'Version 2' });
    expect(history.undo()).toBe(true);
    expect(history.annotations).toEqual([]);
    expect(history.undo()).toBe(false);
  });

  it('rejects an invalid history limit or invalid initial snapshot', () => {
    expect(() => new AnnotationHistory([], 0)).toThrow(/positive integer/);
    expect(() => new AnnotationHistory([createNote(), createNote()])).toThrow(
      /Duplicate annotation id/
    );
  });
});

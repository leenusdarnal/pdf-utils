import { describe, expect, it } from 'vitest';
import type { PdfAnnotation, PdfTextNoteAnnotation } from './annotations';
import { fingerprintPdf, validateDraftAnnotations } from './annotation-drafts';

function createNote(overrides: Partial<PdfTextNoteAnnotation> = {}): PdfTextNoteAnnotation {
  return {
    type: 'text-note',
    id: 'note-1',
    pageNumber: 1,
    createdAt: 100,
    updatedAt: 100,
    color: '#2463eb',
    opacity: 1,
    anchor: { x: 0.25, y: 0.4 },
    text: 'Review this paragraph',
    ...overrides
  };
}

describe('annotation draft identity', () => {
  it('creates the same fingerprint for identical file bytes', async () => {
    const bytes = new Uint8Array(300_000);
    bytes[0] = 37;
    bytes[bytes.length - 1] = 91;
    const first = new Blob([bytes]);
    const second = new Blob([new Uint8Array(bytes)]);

    await expect(fingerprintPdf(first)).resolves.toBe(await fingerprintPdf(second));
  });

  it('creates different fingerprints when the PDF bytes differ', async () => {
    const first = new Blob([new Uint8Array([1, 2, 3, 4])]);
    const second = new Blob([new Uint8Array([1, 2, 3, 5])]);

    await expect(fingerprintPdf(first)).resolves.not.toBe(await fingerprintPdf(second));
  });

  it('handles empty content and includes its size in the identity', async () => {
    const empty = await fingerprintPdf(new Blob([]));
    const nonEmpty = await fingerprintPdf(new Blob([new Uint8Array([0])]));

    expect(empty).not.toBe(nonEmpty);
    expect(empty).toMatch(/^v1-/);
  });
});

describe('validateDraftAnnotations', () => {
  it('accepts and returns a detached copy of supported annotation data', () => {
    const note = createNote();
    const result = validateDraftAnnotations([note]);

    expect(result).toEqual([note]);
    expect(result[0]).not.toBe(note);
    (result[0] as PdfTextNoteAnnotation).text = 'Changed by caller';
    expect(note.text).toBe('Review this paragraph');
  });

  it('rejects invalid entries and duplicate annotation IDs', () => {
    expect(() => validateDraftAnnotations([{ ...createNote(), color: 'red' }])).toThrow(
      'six-digit CSS hex color'
    );
    expect(() => validateDraftAnnotations([createNote(), createNote()])).toThrow(
      'duplicate IDs'
    );
  });

  it('enforces aggregate freehand point limits and stored draft size', () => {
    const points = Array.from({ length: 10_000 }, (_, index) => ({
      x: (index % 100) / 100,
      y: Math.floor(index / 100) / 100
    }));
    const drawings: PdfAnnotation[] = Array.from({ length: 10 }, (_, index) => ({
      type: 'freehand',
      id: 'drawing-' + index,
      pageNumber: 1,
      createdAt: 100,
      updatedAt: 100,
      color: '#2463eb',
      opacity: 1,
      points,
      strokeWidth: 0.004
    }));

    expect(() => validateDraftAnnotations(drawings)).toThrow(
      'too much drawing data'
    );
  });

  it('rejects non-array draft data', () => {
    expect(() => validateDraftAnnotations(null)).toThrow('not a valid list');
  });
});

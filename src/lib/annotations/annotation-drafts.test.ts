import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_DRAFT_LIMITS,
  createAnnotationDraftKey,
  isValidAnnotationDraft,
  type AnnotationDraft
} from './annotation-drafts';

function createDraft(overrides: Partial<AnnotationDraft> = {}): AnnotationDraft {
  return {
    key: 'pdf-utils:annotation-draft:v1:test-key',
    fileName: 'report.pdf',
    fileSize: 12_345,
    fileLastModified: 1_700_000_000_000,
    updatedAt: Date.now(),
    annotations: [
      {
        type: 'text-note',
        id: 'note-1',
        pageNumber: 1,
        createdAt: 100,
        updatedAt: 100,
        color: '#2463eb',
        opacity: 1,
        anchor: { x: 0.25, y: 0.4 },
        text: 'Review this paragraph'
      }
    ],
    ...overrides
  };
}

describe('annotation draft validation', () => {
  it('accepts a bounded draft containing supported annotations', () => {
    expect(isValidAnnotationDraft(createDraft())).toBe(true);
  });

  it('rejects unsupported annotation shapes and excessive annotation counts', () => {
    expect(isValidAnnotationDraft(createDraft({
      annotations: [{ type: 'unknown' } as never]
    }))).toBe(false);
    expect(isValidAnnotationDraft(createDraft({
      annotations: Array.from({ length: ANNOTATION_DRAFT_LIMITS.maxAnnotations + 1 }, (_, index) => ({
        type: 'text-note' as const,
        id: 'note-' + index,
        pageNumber: 1,
        createdAt: 100,
        updatedAt: 100,
        color: '#2463eb',
        opacity: 1,
        anchor: { x: 0.25, y: 0.4 },
        text: 'Note'
      }))
    }))).toBe(false);
  });

  it('rejects oversized note text and malformed document metadata', () => {
    const oversized = 'x'.repeat(ANNOTATION_DRAFT_LIMITS.maxNoteCharacters + 1);
    const valid = createDraft();
    const note = valid.annotations[0];
    if (note.type !== 'text-note') throw new Error('Test fixture must be a text note');

    expect(isValidAnnotationDraft(createDraft({
      annotations: [{ ...note, text: oversized }]
    }))).toBe(false);
    expect(isValidAnnotationDraft(createDraft({ fileSize: -1 }))).toBe(false);
    expect(isValidAnnotationDraft(createDraft({ key: '' }))).toBe(false);
  });
});

describe('createAnnotationDraftKey', () => {
  it('creates a repeatable key for the same file and metadata', async () => {
    const bytes = Buffer.alloc(120_000, 0x31);
    const first = new File([bytes], 'report.pdf', { lastModified: 1_700_000_000_000 });
    const second = new File([bytes], 'report.pdf', { lastModified: 1_700_000_000_000 });

    await expect(createAnnotationDraftKey(first)).resolves.toBe(
      await createAnnotationDraftKey(second)
    );
  });

  it('changes the key when the sampled content or file identity changes', async () => {
    const originalBytes = Buffer.alloc(120_000, 0x31);
    const changedBytes = Buffer.from(originalBytes);
    changedBytes[60_000] = 0x32;

    const original = new File([originalBytes], 'report.pdf', { lastModified: 1_700_000_000_000 });
    const changedContent = new File([changedBytes], 'report.pdf', { lastModified: 1_700_000_000_000 });
    const renamed = new File([originalBytes], 'renamed.pdf', { lastModified: 1_700_000_000_000 });

    const originalKey = await createAnnotationDraftKey(original);
    expect(await createAnnotationDraftKey(changedContent)).not.toBe(originalKey);
    expect(await createAnnotationDraftKey(renamed)).not.toBe(originalKey);
  });
});

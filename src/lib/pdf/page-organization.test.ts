import { describe, expect, it } from 'vitest';
import {
  deletePages,
  duplicatePages,
  movePage,
  rotatePages,
  type OrganizablePage
} from './page-organization';

const samplePages: OrganizablePage[] = [
  { id: 'page-1', sourcePageIndex: 0, rotationDelta: 0 },
  { id: 'page-2', sourcePageIndex: 1, rotationDelta: 0 },
  { id: 'page-3', sourcePageIndex: 2, rotationDelta: 0 }
];

describe('PDF page organization', () => {
  it('moves a page to the target page position without mutating the input', () => {
    const result = movePage(samplePages, 'page-1', 'page-3');

    expect(result.map((page) => page.id)).toEqual(['page-2', 'page-3', 'page-1']);
    expect(samplePages.map((page) => page.id)).toEqual(['page-1', 'page-2', 'page-3']);
  });

  it('leaves the list unchanged when a page cannot be moved', () => {
    expect(movePage(samplePages, 'missing', 'page-2')).toBe(samplePages);
    expect(movePage(samplePages, 'page-2', 'page-2')).toBe(samplePages);
  });

  it('rotates only selected pages in 90-degree increments', () => {
    const firstRotation = rotatePages(samplePages, ['page-1', 'page-3']);
    const secondRotation = rotatePages(firstRotation, ['page-1']);

    expect(firstRotation.map((page) => page.rotationDelta)).toEqual([90, 0, 90]);
    expect(secondRotation.map((page) => page.rotationDelta)).toEqual([180, 0, 90]);
    expect(samplePages.map((page) => page.rotationDelta)).toEqual([0, 0, 0]);
  });

  it('duplicates selected pages immediately after their originals', () => {
    let nextId = 0;
    const result = duplicatePages(samplePages, ['page-1', 'page-3'], () => 'copy-' + ++nextId);

    expect(result.map((page) => page.id)).toEqual([
      'page-1',
      'copy-1',
      'page-2',
      'page-3',
      'copy-2'
    ]);
    expect(result[1].sourcePageIndex).toBe(0);
    expect(result[4].sourcePageIndex).toBe(2);
  });

  it('removes selected pages without affecting the source array', () => {
    const result = deletePages(samplePages, ['page-2']);

    expect(result.map((page) => page.id)).toEqual(['page-1', 'page-3']);
    expect(samplePages).toHaveLength(3);
  });

  it('returns the original list when no pages are selected for deletion', () => {
    expect(deletePages(samplePages, [])).toBe(samplePages);
  });
});

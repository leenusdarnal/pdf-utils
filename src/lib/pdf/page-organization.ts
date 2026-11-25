export interface OrganizablePage {
  id: string;
  sourcePageIndex: number;
  rotationDelta: number;
}

/** Move a page to the target page's current position without mutating the input. */
export function movePage(
  pages: OrganizablePage[],
  sourceId: string,
  targetId: string
): OrganizablePage[] {
  const sourceIndex = pages.findIndex((page) => page.id === sourceId);
  const targetIndex = pages.findIndex((page) => page.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return pages;

  const next = [...pages];
  const [movedPage] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, movedPage);
  return next;
}

/** Rotate every selected page clockwise by one quarter turn. */
export function rotatePages(
  pages: OrganizablePage[],
  selectedIds: string[]
): OrganizablePage[] {
  const selected = new Set(selectedIds);
  if (selected.size === 0) return pages;

  return pages.map((page) =>
    selected.has(page.id)
      ? { ...page, rotationDelta: (page.rotationDelta + 90) % 360 }
      : page
  );
}

/** Insert a copy immediately after each selected page, preserving current order. */
export function duplicatePages(
  pages: OrganizablePage[],
  selectedIds: string[],
  createId: () => string
): OrganizablePage[] {
  const selected = new Set(selectedIds);
  if (selected.size === 0) return pages;

  return pages.flatMap((page) =>
    selected.has(page.id)
      ? [page, { ...page, id: createId() }]
      : [page]
  );
}

/** Return a new list without any selected pages. */
export function deletePages(
  pages: OrganizablePage[],
  selectedIds: string[]
): OrganizablePage[] {
  const selected = new Set(selectedIds);
  if (selected.size === 0) return pages;
  return pages.filter((page) => !selected.has(page.id));
}

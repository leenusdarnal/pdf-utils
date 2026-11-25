const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
const PDF_HEADER_SCAN_LIMIT = 1_024;

export function clampPageNumber(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || !Number.isFinite(totalPages) || totalPages < 1) {
    return 1;
  }

  const lastPage = Math.floor(totalPages);
  return Math.min(lastPage, Math.max(1, Math.floor(page)));
}

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(3, Math.max(0.5, scale));
}

export async function hasPdfHeader(file: Blob): Promise<boolean> {
  if (file.size < PDF_HEADER.length) return false;

  const headerBytes = new Uint8Array(
    await file.slice(0, Math.min(file.size, PDF_HEADER_SCAN_LIMIT)).arrayBuffer()
  );

  for (let offset = 0; offset <= headerBytes.length - PDF_HEADER.length; offset += 1) {
    if (PDF_HEADER.every((byte, index) => headerBytes[offset + index] === byte)) {
      return true;
    }
  }

  return false;
}

export interface VisiblePageRange {
  startPage: number;
  endPage: number;
}

/**
 * Calculates a bounded page window for a virtualized thumbnail list.
 * Pages outside this range do not need a mounted canvas or DOM node.
 */
export function getVisiblePageRange(
  totalPages: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = 124,
  overscan = 3
): VisiblePageRange {
  if (!Number.isFinite(totalPages) || totalPages < 1) {
    return { startPage: 0, endPage: 0 };
  }

  const pageCount = Math.floor(totalPages);
  const safeScrollTop = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const safeViewportHeight = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const safeRowHeight = Math.max(1, Number.isFinite(rowHeight) ? rowHeight : 1);
  const safeOverscan = Math.max(0, Math.floor(Number.isFinite(overscan) ? overscan : 0));

  const startPage = Math.max(1, Math.floor(safeScrollTop / safeRowHeight) + 1 - safeOverscan);
  const endPage = Math.min(
    pageCount,
    Math.max(startPage, Math.ceil((safeScrollTop + safeViewportHeight) / safeRowHeight) + safeOverscan)
  );

  return { startPage, endPage };
}

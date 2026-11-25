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